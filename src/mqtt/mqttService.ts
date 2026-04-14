import mqtt from 'mqtt';
import { Gauge, Counter } from 'prom-client';
import { config } from '../config/env.js';
import { logger } from '../logger/logger.js';
import { MessageBuffer } from '../pipeline/messageBuffer.js';
import { RuuviData } from '../ruuvi/ruuviData.js';
import { writeBatch as influxWriteBatch } from '../influx-db/influxDbService.js';
import { writeBatch as mariaWriteBatch } from '../maria-db/mariaDbService.js';
import ruuviSchema from '../ruuvi/ruuviMqttDataWithTimestampsSchema.js';
// ----------------------
// Metrics
// ----------------------
// MQTT connection status metrics
const mqttConnected = new Gauge({
  name: 'ruuvi_mqtt_connected',
  help: 'MQTT connection status (1=connected, 0=disconnected)',
});
//  Counters for processed messages
const mqttMessagesProcessed = new Counter({
  name: 'ruuvi_mqtt_messages_processed_total',
  help: 'Total MQTT messages processed successfully',
});
// Counters for invalid messages
const mqttMessagesInvalid = new Counter({
  name: 'ruuvi_mqtt_messages_invalid_total',
  help: 'Total invalid MQTT messages',
});

// ----------------------
// Buffers
// ----------------------
const influxBuffer =
  config.storageBackend !== 'mariadb'
    ? new MessageBuffer<RuuviData>(config.bufferSize, influxWriteBatch, 'influx')
    : null;

const mariaBuffer =
  config.storageBackend !== 'influxdb'
    ? new MessageBuffer<RuuviData>(config.mariaBufferSize, mariaWriteBatch, 'maria')
    : null;

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
    mqttConnected.set(1);
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
        mqttMessagesInvalid.inc();
        return;
      }

      const data = parsed.data;
      const parts = topic.split('/');
      if (parts.length < 3) return;

      const gatewayMac = parts[1].replace(/[^A-F0-9:]/gi, '');
      const tagMac = parts[2].replace(/[^A-F0-9:]/gi, '');
      const gatewayName = config.gatewayNames[gatewayMac] ?? gatewayMac;
      const tagName = config.tagNames[tagMac] ?? tagMac;
      const timestamp = (Number(data.ts ?? data.gwts) + config.mqtt.timestampOffsetSeconds) * 1000;

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

      influxBuffer?.push(sample);
      mariaBuffer?.push(sample);
      mqttMessagesProcessed.inc();
    } catch (err) {
      logger.warn({ err, topic }, 'MQTT message processing failed');
    }
  });

  client.on('error', (err) => {
    logger.error({ err }, 'MQTT connection error');
    mqttConnected.set(0);
  });
  client.on('reconnect', () => logger.info('MQTT reconnecting...'));
  client.on('offline', () => mqttConnected.set(0));
}
