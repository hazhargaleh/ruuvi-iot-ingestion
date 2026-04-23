import { describe, it, expect } from 'vitest';

// Logic extracted from mqttService to test the timestamp offset
function computeTimestamp(ts: number | undefined, gwts: number | undefined, offsetSeconds: number): number {
  return (Number(ts ?? gwts) + offsetSeconds) * 1000;
}

describe('timestamp offset correction', () => {
  it('should use ts when available', () => {
    const result = computeTimestamp(1776174885, 1776174890, 0);
    expect(result).toBe(1776174885000);
  });

  it('should fall back to gwts when ts is undefined', () => {
    const result = computeTimestamp(undefined, 1776174890, 0);
    expect(result).toBe(1776174890000);
  });

  it('should apply positive offset (gateway behind UTC)', () => {
    // CEST = UTC+2 → gateway sends local time → offset = +7200
    const gatewayTs = 1776174885; // what the gateway sends (local time as unix)
    const result = computeTimestamp(gatewayTs, undefined, 7200);
    expect(result).toBe((1776174885 + 7200) * 1000);
  });

  it('should apply zero offset (gateway in UTC)', () => {
    const result = computeTimestamp(1776174885, undefined, 0);
    expect(result).toBe(1776174885000);
  });

  it('should apply negative offset (gateway ahead of UTC)', () => {
    const result = computeTimestamp(1776174885, undefined, -3600);
    expect(result).toBe((1776174885 - 3600) * 1000);
  });

  it('should convert to milliseconds', () => {
    const result = computeTimestamp(1000, undefined, 0);
    expect(result).toBe(1000000); // 1000 seconds × 1000 = 1 000 000 ms
  });
});
