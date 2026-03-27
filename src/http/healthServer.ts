import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/env.js';
import { register, collectDefaultMetrics } from 'prom-client';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger/logger.js';
import { GatewayConfigurationSchema } from '../ruuvi/gatewayConfigurationSchema.js';

const GW_CONFIG_DIR = path.resolve('config/gw_cfg');

function normalizeMac(mac?: string): string | undefined {
  if (!mac) return undefined;
  return mac.toUpperCase().replace(/[^A-F0-9]/g, '');
}

function safeJsonParse(raw: string) {
  try { return JSON.parse(raw); } catch { return null; }
}

function validateGwCfgAuth(authHeader: string): boolean {
  if (!authHeader) return false;
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7) === config.gwCfg.bearerToken;
  }
  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
    const [user, pass] = decoded.split(':');
    return user === config.gwCfg.user && pass === config.gwCfg.password;
  }
  return false;
}

async function handleGwCfg(req: FastifyRequest, reply: FastifyReply) {
  if (!validateGwCfgAuth(req.headers['authorization'] ?? '')) {
    reply.header('WWW-Authenticate', 'Basic realm="Ruuvi Gateway Config"');
    return reply.code(401).send({ error: 'Unauthorized' });
  }

  // MAC resolution — from the header or from the name of the requested file
  const headerMac = normalizeMac((req.headers['ruuvi_gw_mac'] as string) || (req.headers['ruuvi-gw-mac'] as string));

  // Extract the MAC from the URL if the gateway is /ruuvi-gw-cfg/F32DEFE72E78.json
  const urlSegment = (req.params as Record<string, string>)['*'] ?? '';
  const urlMac = normalizeMac(urlSegment.replace('.json', '').replace('gw_cfg', ''));

  const mac = headerMac ?? urlMac;

  logger.info({ mac, headerMac, urlMac, url: req.url }, 'GW cfg request');

  // File resolution: name → MAC → fallback
  let cfgPath = path.join(GW_CONFIG_DIR, 'gw_cfg.json');

  if (mac) {
    const gatewayName = config.gatewayNames[mac];

    if (gatewayName) {
      const namePath = path.join(GW_CONFIG_DIR, `${gatewayName.replace(/\s+/g, '-').toLowerCase()}.json`);
      if (fs.existsSync(namePath)) {
        cfgPath = namePath;
        logger.info({ mac, cfgPath }, 'Config resolved by name');
      }
    }

    if (cfgPath === path.join(GW_CONFIG_DIR, 'gw_cfg.json')) {
      const macPath = path.join(GW_CONFIG_DIR, `${mac}.json`);
      if (fs.existsSync(macPath)) {
        cfgPath = macPath;
        logger.info({ mac, cfgPath }, 'Config resolved by MAC');
      }
    }
  }

  if (!fs.existsSync(cfgPath)) {
    logger.error({ cfgPath }, 'Config file not found');
    return reply.code(404).send({ error: 'Config not found' });
  }

  const raw = fs.readFileSync(cfgPath, 'utf-8');
  const parsed = safeJsonParse(raw);

  if (!parsed) {
    logger.error({ cfgPath }, 'Invalid JSON in config file');
    return reply.code(500).send({ error: 'Invalid JSON' });
  }

  const validation = GatewayConfigurationSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({ cfgPath, errors: validation.error.errors }, 'Schema validation failed');
    return reply.code(500).send({ error: 'Invalid config schema' });
  }

  reply.header('Content-Type', 'application/json');
  return reply.send(raw);
}

export async function startHttpServer() {
  const fastify = Fastify();

  await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url?.startsWith('/ruuvi-gw-cfg')) return;
    if (req.headers['x-api-key'] !== config.httpApiKey) {
      reply.code(401).send();
    }
  });

  collectDefaultMetrics();

  fastify.get('/health', async () => ({ status: 'ok' }));

  fastify.get('/metrics', async (_, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });

  // Both routes point to the same handler
  fastify.get('/ruuvi-gw-cfg', handleGwCfg);
  fastify.get('/ruuvi-gw-cfg/*', handleGwCfg);

  await fastify.listen({ port: config.httpPort, host: '0.0.0.0' });
  logger.info(`HTTP server listening on :${config.httpPort}`);
}