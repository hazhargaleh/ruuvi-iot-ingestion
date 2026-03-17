import { InfluxDB, Point } from "@influxdata/influxdb-client";
import { config } from "../config/env.js";
import { logger } from "../logger/logger.js";
import { RuuviData } from "../ruuvi/ruuviData.js";
const influx = new InfluxDB({ url: config.influx.url, token: config.influx.token });
const writeApi = influx.getWriteApi(config.influx.org, config.influx.bucket, 'ms');
function toPoint(data: RuuviData): Point {
  const point = new Point("ruuvi")
    .tag("device", data.deviceId)
    .tag("device_name", data.deviceName)
    .tag("gateway", data.gatewayId)
    .tag("gateway_name", data.gatewayName)
    .floatField("rssi", data.rssi)
    .timestamp(data.timestamp);
  const fields: Record<string, number | undefined> = {
    temperature: data.temperature,
    humidity: data.humidity,
    absoluteHumidity: data.absoluteHumidity,
    pressure: data.pressure,
    equilibriumVaporPressure: data.equilibriumVaporPressure,
    airDensity: data.airDensity,
    accX: data.accelerationX,
    accY: data.accelerationY,
    accZ: data.accelerationZ,
    accelerationTotal: data.accelerationTotal,
    accelerationAngleFromX: data.accelerationAngleFromX,
    accelerationAngleFromY: data.accelerationAngleFromY,
    accelerationAngleFromZ: data.accelerationAngleFromZ,
    batteryVoltage: data.batteryVoltage,
    txPower: data.txPower,
    movementCounter: data.movementCounter,
    measurementSequenceNumber: data.measurementSequenceNumber,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value != null) point.floatField(key, value);
  }
  return point;
}

export async function writeBatch(samples: RuuviData[]) {
  if (!samples.length) return;
  const points = samples.map(toPoint);
  try {
    writeApi.writePoints(points);
  } catch (err) {
    logger.error({ err }, "Influx write failed");
  }
}