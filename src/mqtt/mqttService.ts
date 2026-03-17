import mqtt from 'mqtt';
import { config } from '../config/env.js';
import { logger } from '../logger/logger.js';
import { MessageBuffer } from '../pipeline/messageBuffer.js';
import { RuuviData } from '../ruuvi/ruuviData.js';
import { writeBatch as influxWriteBatch } from '../influx-db/influxDbService.js';
import { writeBatch as mariaWriteBatch } from '../maria-db/mariaDbService.js';
import ruuviSchema from '../ruuvi/ruuviMqttDataWithTimestampsSchema.js';
import {
  absoluteHumidity,
  accelerationAngles,
  accelerationTotal,
  airDensity,
  batteryPercentage,
  dewPoint,
  equilibriumVaporPressure,
  frostPoint,
  vaporPressureDeficit,
} from '../ruuvi/ruuviCalculations.js';

// ----------------------
// Buffers
// ----------------------
const influxBuffer =
  config.storageBackend !== 'mariadb' ? new MessageBuffer<RuuviData>(config.bufferSize, influxWriteBatch) : null;

const mariaBuffer =
  config.storageBackend !== 'influxdb' ? new MessageBuffer<RuuviData>(config.mariaBufferSize, mariaWriteBatch) : null;

setInterval(() => {
  influxBuffer?.flush();
  mariaBuffer?.flush();
}, config.flushInterval);

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
    clean: true,
  });

  client.on('connect', () => {
    logger.info(`MQTT connected to ${config.mqtt.protocol}://${config.mqtt.host}:${config.mqtt.port}`);
    client.subscribe(config.mqtt.topic);
  });

  client.on('message', (topic, msg) => {
    try {
      if (msg.length > 8192) return;
      if (!topic.startsWith('ruuvi/')) return;
      if (topic.endsWith('gw_status')) return;

      const parsed = ruuviSchema.safeParse(JSON.parse(msg.toString()));
      if (!parsed.success) {
        logger.warn({ errors: parsed.error }, 'Invalid Ruuvi payload');
        return;
      }

      const data = parsed.data;
      const parts = topic.split('/');
      if (parts.length < 3) return;

      const gatewayMac = parts[1].replace(/[^A-F0-9:]/gi, '');
      const tagMac = parts[2].replace(/[^A-F0-9:]/gi, '');
      const gatewayName = config.gatewayNames[gatewayMac] ?? gatewayMac;
      const tagName = config.tagNames[tagMac] ?? tagMac;
      const timestamp = Number(data.ts ?? data.gwts) * 1000;

      // ── Construction RuuviData depuis les champs décodés du gateway ──
      const sample = new RuuviData(
        data.coords ?? '',
        tagMac,
        tagName,
        gatewayMac,
        gatewayName,
        'ruuvi-gateway',
        data.data ?? '',
        data.rssi,
        timestamp,
      );

      // Raw metrics directly from the JSON payload
      sample.temperature = data.temperature;
      sample.humidity = data.humidity;
      sample.pressure = data.pressure;
      sample.accelerationX = data.accelX;
      sample.accelerationY = data.accelY;
      sample.accelerationZ = data.accelZ;
      sample.batteryVoltage = data.voltage;
      sample.txPower = data.txPower;
      sample.movementCounter = data.movementCounter;
      sample.measurementSequenceNumber = data.measurementSequenceNumber;
      sample.dataFormat = data.dataFormat;

      // Calculation of derived fields (once for both databases)
      const { temperature, humidity, pressure, accelerationX, accelerationY, accelerationZ } = sample;

      if (temperature !== undefined) {
        sample.equilibriumVaporPressure = equilibriumVaporPressure(temperature);

        if (humidity !== undefined) {
          sample.absoluteHumidity = absoluteHumidity(temperature, humidity);
          sample.dewPoint = dewPoint(temperature, humidity);
          sample.frostPoint = frostPoint(temperature, humidity);
          sample.vaporPressureDeficit = vaporPressureDeficit(temperature, humidity);

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

      if (sample.batteryVoltage !== undefined) {
        sample.batteryPercentage = batteryPercentage(sample.batteryVoltage);
      }

      influxBuffer?.push(sample);
      mariaBuffer?.push(sample);
    } catch (err) {
      logger.warn({ err, topic }, 'MQTT message processing failed');
    }
  });

  client.on('error', (err) => logger.error({ err }, 'MQTT connection error'));
  client.on('reconnect', () => logger.info('MQTT reconnecting...'));
}
