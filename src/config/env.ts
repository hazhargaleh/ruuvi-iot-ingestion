import fs from "fs";
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config({ path: "config/.env" });
function normalizeMac(mac?: string): string | undefined {
  if (!mac) return undefined;
  return mac.toUpperCase().replace(/[^A-F0-9]/g, '');
}
function parseMacMap(envVar: string | undefined): Record<string, string> {
  if (!envVar) return {};
  try {
    const parsed = JSON.parse(envVar);
    if (typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const normalized: Record<string, string> = {};
    for (const [mac, name] of Object.entries(parsed)) {
      const key = normalizeMac(mac);
      if (!key) continue;
      if (typeof name === 'string') {
        normalized[key] = name;
      }
    }

    return normalized;
  } catch {
    console.warn(`[config] Failed to parse MAC map: ${envVar}`);
    return {};
  }
}

const configSchema = z.object({
  gwCfg: z.object({
    user: z.string().optional(),
    password: z.string().optional(),
    bearerToken: z.string().optional(),
  }),
  mqtt: z.object({
    protocol: z.string(),
    host: z.string(),
    port: z.number(),
    topic: z.string(),
    username: z.string().optional(),
    password: z.string().optional(),
    ca: z.instanceof(Buffer).optional(),
    cert: z.instanceof(Buffer).optional(),
    key: z.instanceof(Buffer).optional(),
    rejectUnauthorized: z.boolean(),
  }),
  storageBackend: z.enum(['influxdb', 'mariadb', 'both']),
  influx: z.object({
    url: z.string().url(),
    org: z.string().min(1),
    bucket: z.string().min(1),
    token: z.string().min(1),
  }),
  maria: z.object({
    host: z.string(),
    port: z.number(),
    user: z.string(),
    password: z.string(),
    database: z.string(),
  }),
  mariaRetention: z.object({
    enabled: z.boolean(),
    retentionDays: z.number(),
    downsampleEnabled: z.boolean(),
    downsampleRetentionDays: z.number(),
    downsampleDeleteRaw: z.boolean(),
    maintenanceIntervalHours: z.number(),
  }),
  mariaBufferSize: z.number(),
  bufferSize: z.number(),
  flushInterval: z.number(),
  httpPort: z.number(),
  companyCode: z.number(),
  httpApiKey: z.string().min(1),
  gatewayNames: z.record(z.string()),
  tagNames: z.record(z.string()),
});

export const config = configSchema.parse({
  gwCfg: {
    user: process.env.GW_CFG_USER ?? 'ruuvi-cfg',
    password: process.env.GW_CFG_PASSWORD ?? '',
    bearerToken: process.env.GW_CFG_PASSWORD ?? '',
  },
  mqtt: {
    protocol: process.env.MQTT_PROTOCOL ?? 'mqtt',
    host: process.env.MQTT_HOST ?? 'localhost',
    port: Number(process.env.MQTT_PORT ?? 1883),
    topic: process.env.MQTT_TOPIC ?? 'ruuvi/#',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    ca: process.env.MQTT_CA ? fs.readFileSync(process.env.MQTT_CA) : undefined,
    cert: process.env.MQTT_CERT ? fs.readFileSync(process.env.MQTT_CERT) : undefined,
    key: process.env.MQTT_KEY ? fs.readFileSync(process.env.MQTT_KEY) : undefined,
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === 'true',
  },
  storageBackend: (process.env.STORAGE_BACKEND ?? 'both') as 'influxdb' | 'mariadb' | 'both',
  influx: {
    url: process.env.INFLUX_URL!,
    org: process.env.INFLUX_ORG!,
    bucket: process.env.INFLUX_BUCKET!,
    token: process.env.INFLUX_TOKEN!,
  },
  maria: {
    host: process.env.MARIA_HOST ?? 'localhost',
    port: Number(process.env.MARIA_PORT ?? 3306),
    user: process.env.MARIA_USER ?? 'ruuvi',
    password: process.env.MARIA_PASSWORD ?? '',
    database: process.env.MARIA_DATABASE ?? 'ruuvi',
  },
  mariaRetention: {
    enabled: process.env.MARIA_RETENTION_ENABLED === 'true',
    retentionDays: Number(process.env.MARIA_RETENTION_DAYS ?? 30),
    downsampleEnabled: process.env.MARIA_DOWNSAMPLE_ENABLED === 'true',
    downsampleRetentionDays: Number(process.env.MARIA_DOWNSAMPLE_RETENTION_DAYS ?? 365),
    downsampleDeleteRaw: process.env.MARIA_DOWNSAMPLE_DELETE_RAW === 'true',
    maintenanceIntervalHours: Number(process.env.MARIA_MAINTENANCE_INTERVAL_HOURS ?? 6),
  },
  mariaBufferSize: Number(process.env.MARIA_BUFFER_SIZE ?? 100),
  bufferSize: Number(process.env.BUFFER_SIZE ?? 500),
  flushInterval: Number(process.env.FLUSH_INTERVAL ?? 5000),
  httpPort: Number(process.env.HTTP_PORT ?? 3002),
  companyCode: Number(process.env.COMPANY_CODE ?? 1177),
  httpApiKey: process.env.HTTP_API_KEY!,
  gatewayNames: parseMacMap(process.env.GATEWAY_NAMES),
  tagNames: parseMacMap(process.env.TAG_NAMES),
});
