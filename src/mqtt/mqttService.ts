import mqtt from "mqtt";
import { config } from "../config/env.js";
import { logger } from "../logger/logger.js";
import { MessageBuffer } from "../pipeline/messageBuffer.js";
import { RuuviData } from "../ruuvi/ruuviData.js";
import { decodeRuuvi } from "../ruuvi/ruuviDecoder.js";
import { writeBatch } from "../influx/influxService.js";
import ruuviSchema from "../ruuvi/ruuvi_mqtt_data_with_timestamps.schema.js";
import {
  absoluteHumidity,
  accelerationAngles,
  accelerationTotal,
  airDensity,
  equilibriumVaporPressure,
} from '../ruuvi/ruuviCalculations.js';
// ----------------------
// Optimisation Ruuvi BLE
// ----------------------
function extractRuuviPayload(hex: string): string | null {
  const marker = "ff9904"; // type=manufacturer + companyCode
  const idx = hex.toLowerCase().indexOf(marker);
  if (idx === -1) return null;
  return hex.substring(idx + 6); // on enlève "ff9904"
}
// ----------------------
// Message buffer Influx
// ----------------------
const influxBuffer = new MessageBuffer<RuuviData>(config.bufferSize, writeBatch);
setInterval(() => influxBuffer.flush(), config.flushInterval);
// ----------------------
// MQTT
// ----------------------
export function startMqtt() {
  const client = mqtt.connect({
    protocol: config.mqtt.protocol as any,
    host: config.mqtt.host,
    port: config.mqtt.port,
    username: config.mqtt.username,
    password: config.mqtt.password,
    rejectUnauthorized: config.mqtt.rejectUnauthorized,
    ca: config.mqtt.ca ? [config.mqtt.ca] : undefined,
    cert: config.mqtt.cert,
    key: config.mqtt.key,
    reconnectPeriod: 5000,
    keepalive: 30,
    clean: true
  });
  client.on("connect", () => {
    logger.info(`MQTT connected to ${config.mqtt.protocol}://${config.mqtt.host}:${config.mqtt.port}`);
    client.subscribe(config.mqtt.topic);
  });
  client.on("message", (topic, msg) => {
    try {
      // MQTT flood protection / high payload
      if (msg.length > 8192) return;
      if (!topic.startsWith("ruuvi/")) return;
      if (topic.endsWith("gw_status")) return;
      // Quick JSON parsing (zod handles validation)
      const payloadStr = msg.toString();
      const parsed = ruuviSchema.safeParse(JSON.parse(payloadStr));
      if (!parsed.success) {
        logger.warn({ errors: parsed.error }, "Invalid Ruuvi payload");
        return;
      }
      const data = parsed.data;
      // Lock this thread
      const parts = topic.split("/");
      if (parts.length < 3) return;
      const gatewayMac = parts[1].replace(/[^A-F0-9:]/gi, "");
      const tagMac = parts[2].replace(/[^A-F0-9:]/gi, "");
      // Created by RuuviData
      const timestamp = Number(data.ts) * 1000;
      const gatewayName = config.gatewayNames[gatewayMac] ?? gatewayMac;
      const tagName = config.tagNames[tagMac] ?? tagMac;
      const sample = new RuuviData(
        data.coords ?? "",
        tagMac,
        tagName,
        gatewayMac,
        gatewayName,
        "ruuvi-gateway",
        data.data,
        data.rssi,
        timestamp
      );
      // Extraction and decoding of the Ruuvi payload
      if (sample.rawData) {
        const manufacturerData = extractRuuviPayload(sample.rawData);
        if (!manufacturerData) return;

        const decoded = decodeRuuvi(manufacturerData);
        if (!decoded) return;

        Object.assign(sample, decoded);
        // Calculation of derived fields
        const { temperature, humidity, pressure, accelerationX, accelerationY, accelerationZ } = sample;

        if (temperature !== undefined) {
          sample.equilibriumVaporPressure = equilibriumVaporPressure(temperature);

          if (humidity !== undefined) {
            sample.absoluteHumidity = absoluteHumidity(temperature, humidity);

            if (pressure !== undefined) {
              sample.airDensity = airDensity(temperature, pressure, humidity);
            }
          }
        }

        if (accelerationX !== undefined && accelerationY !== undefined && accelerationZ !== undefined) {
          sample.accelerationTotal = accelerationTotal(accelerationX, accelerationY, accelerationZ);
          const angles = accelerationAngles(accelerationX, accelerationY, accelerationZ);
          sample.accelerationAngleFromX = angles.angleFromX;
          sample.accelerationAngleFromY = angles.angleFromY;
          sample.accelerationAngleFromZ = angles.angleFromZ;
        }
      }
      // Push to Influx via Buffer
      influxBuffer.push(sample);
    } catch (err) {
      logger.warn({ err, topic }, "MQTT message processing failed");
    }
  });
  client.on("error", (err) => {
    logger.error({ err }, "MQTT connection error");
  });
  client.on("reconnect", () => {
    logger.info("MQTT reconnecting...");
  });
}