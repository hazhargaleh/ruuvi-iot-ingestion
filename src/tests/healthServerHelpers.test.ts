import { describe, it, expect } from 'vitest';
import path from 'path';

// Reimplementation of healthServer's pure helpers to test them without starting Fastify
function normalizeMac(mac?: string): string | undefined {
  if (!mac) return undefined;
  return mac.toUpperCase().replace(/[^A-F0-9]/g, '');
}

function resolveCfgPath(gwConfigDir: string, fileBase: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(fileBase)) return null;
  const resolved = path.resolve(gwConfigDir, `${fileBase}.json`);
  const rootWithSep = gwConfigDir.endsWith(path.sep) ? gwConfigDir : `${gwConfigDir}${path.sep}`;
  if (!resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

function normalizeMacMap(macMap: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [mac, name] of Object.entries(macMap)) {
    const key = normalizeMac(mac);
    if (!key) continue;
    normalized[key] = name;
  }
  return normalized;
}

const GW_CONFIG_DIR = '/app/config/gw_cfg';

describe('normalizeMac', () => {
  it('should strip colons and uppercase', () => {
    expect(normalizeMac('f3:2d:ef:e7:2e:78')).toBe('F32DEFE72E78');
  });

  it('should handle already normalized MAC', () => {
    expect(normalizeMac('F32DEFE72E78')).toBe('F32DEFE72E78');
  });

  it('should handle MAC with dashes', () => {
    expect(normalizeMac('F3-2D-EF-E7-2E-78')).toBe('F32DEFE72E78');
  });

  it('should return undefined for undefined input', () => {
    expect(normalizeMac(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(normalizeMac('')).toBeUndefined();
  });
});

describe('resolveCfgPath', () => {
  it('should return a valid path for safe filename', () => {
    const result = resolveCfgPath(GW_CONFIG_DIR, 'station-1');
    expect(result).toBe(`${GW_CONFIG_DIR}/station-1.json`);
  });

  it('should return null for path traversal attempt', () => {
    expect(resolveCfgPath(GW_CONFIG_DIR, '../etc/passwd')).toBeNull();
  });

  it('should return null for filename with special characters', () => {
    expect(resolveCfgPath(GW_CONFIG_DIR, 'file;rm -rf')).toBeNull();
  });

  it('should return null for empty filename', () => {
    expect(resolveCfgPath(GW_CONFIG_DIR, '')).toBeNull();
  });

  it('should accept alphanumeric filenames', () => {
    expect(resolveCfgPath(GW_CONFIG_DIR, 'F32DEFE72E78')).toBe(`${GW_CONFIG_DIR}/F32DEFE72E78.json`);
  });

  it('should accept filenames with hyphens and underscores', () => {
    expect(resolveCfgPath(GW_CONFIG_DIR, 'my-gateway_1')).not.toBeNull();
  });
});

describe('normalizeMacMap', () => {
  it('should normalize MAC keys', () => {
    const result = normalizeMacMap({ 'F3:2D:EF:E7:2E:78': 'Station 1' });
    expect(result['F32DEFE72E78']).toBe('Station 1');
  });

  it('should handle multiple entries', () => {
    const result = normalizeMacMap({
      'F3:2D:EF:E7:2E:78': 'Station 1',
      'C8:25:2D:8E:9C:2C': 'Station 2',
    });
    expect(result['F32DEFE72E78']).toBe('Station 1');
    expect(result['C8252D8E9C2C']).toBe('Station 2');
  });

  it('should return empty object for empty input', () => {
    expect(normalizeMacMap({})).toEqual({});
  });
});
