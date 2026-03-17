import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { config } from '../config/env.js';
import { logger } from '../logger/logger.js';
import { RuuviData } from '../ruuvi/ruuviData.js';

let pool: Pool;

export function getMariaPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.maria.host,
      port: config.maria.port,
      user: config.maria.user,
      password: config.maria.password,
      database: config.maria.database,
      waitForConnections: true,
      connectionLimit: 5, // low load → 5 connections are sufficient
      queueLimit: 100,
      timezone: 'Z', // UTC everywhere
    });
    logger.info('MariaDB pool created');
  }
  return pool;
}
export async function initMariaSchema(): Promise<void> {
  const conn = await getMariaPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`
      CREATE TABLE IF NOT EXISTS measurements (
        id                           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        ts                           DATETIME(3)      NOT NULL,
        device_id                    VARCHAR(17)      NOT NULL COMMENT 'MAC address of tag',
        device_name                  VARCHAR(100)     NOT NULL,
        gateway_id                   VARCHAR(17)      NOT NULL,
        gateway_name                 VARCHAR(100)     NOT NULL COMMENT 'MAC address of gateway',
        rssi                         SMALLINT,
        temperature                  DECIMAL(7,4),
        humidity                     DECIMAL(7,4),
        pressure                     INT UNSIGNED COMMENT 'Pa',
        acceleration_x               DECIMAL(7,4),
        acceleration_y               DECIMAL(7,4),
        acceleration_z               DECIMAL(7,4),
        battery_voltage              DECIMAL(5,3),
        tx_power                     TINYINT,
        movement_counter             SMALLINT UNSIGNED,
        measurement_sequence_number  MEDIUMINT UNSIGNED,
        data_format                  TINYINT UNSIGNED,
        absolute_humidity            DECIMAL(8,4) COMMENT 'g/m³',
        equilibrium_vapor_pressure   DECIMAL(10,4) COMMENT 'Pa',
        air_density                  DECIMAL(8,6) COMMENT 'kg/m³',
        dew_point                    DECIMAL(7,4) COMMENT '°C',
        frost_point                  DECIMAL(7,4) COMMENT '°C',
        vapor_pressure_deficit       DECIMAL(8,5) COMMENT 'kPa',
        acceleration_total           DECIMAL(7,4),
        acceleration_angle_x         DECIMAL(7,4) COMMENT 'degrees',
        acceleration_angle_y         DECIMAL(7,4) COMMENT 'degrees',
        acceleration_angle_z         DECIMAL(7,4) COMMENT 'degrees',
        battery_percentage           DECIMAL(5,2) COMMENT '0-100%',
        INDEX idx_ts          (ts),
        INDEX idx_device      (device_id, ts),
        INDEX idx_device_name (device_name, ts),
        INDEX idx_gateway     (gateway_name, ts)
      ) ENGINE=InnoDB
        ROW_FORMAT=COMPRESSED
        COMMENT='RuuviTag raw and derived metrics';
    `);

    await conn.query(`
      CREATE OR REPLACE VIEW latest_measurements AS
        SELECT m.*
        FROM measurements m
        INNER JOIN (
          SELECT device_id, MAX(ts) AS max_ts
          FROM measurements
          GROUP BY device_id
        ) latest ON m.device_id = latest.device_id
                AND m.ts        = latest.max_ts
    `);
    await conn.commit();
    logger.info('MariaDB schema ready');
  } catch (err) {
    await conn.rollback();
    logger.error({ err }, 'MariaDB schema init failed');
    throw err; // on remonte l'erreur pour bloquer le démarrage
  } finally {
    conn.release();
  }
}
const INSERT_SQL = `
  INSERT INTO measurements (
    ts, device_id, device_name, gateway_id, gateway_name, rssi,
    temperature, humidity, pressure,
    acceleration_x, acceleration_y, acceleration_z,
    battery_voltage, tx_power, movement_counter,
    measurement_sequence_number, data_format,
    absolute_humidity, equilibrium_vapor_pressure, air_density,
    dew_point, frost_point, vapor_pressure_deficit,
    acceleration_total, acceleration_angle_x, acceleration_angle_y, acceleration_angle_z,
    battery_percentage
  ) VALUES ?
`;

function toRow(d: RuuviData): (number | string | null)[] {
  const ts = new Date(d.timestamp).toISOString().replace('T', ' ').replace('Z', '');
  return [
    ts,
    d.deviceId,
    d.deviceName,
    d.gatewayId,
    d.gatewayName,
    d.rssi ?? null,
    d.temperature ?? null,
    d.humidity ?? null,
    d.pressure ?? null,
    d.accelerationX ?? null,
    d.accelerationY ?? null,
    d.accelerationZ ?? null,
    d.batteryVoltage ?? null,
    d.txPower ?? null,
    d.movementCounter ?? null,
    d.measurementSequenceNumber ?? null,
    d.dataFormat ?? null,
    d.absoluteHumidity ?? null,
    d.equilibriumVaporPressure ?? null,
    d.airDensity ?? null,
    d.dewPoint ?? null,
    d.frostPoint ?? null,
    d.vaporPressureDeficit ?? null,
    d.accelerationTotal ?? null,
    d.accelerationAngleFromX ?? null,
    d.accelerationAngleFromY ?? null,
    d.accelerationAngleFromZ ?? null,
    d.batteryPercentage ?? null,
  ];
}

export async function writeBatch(samples: RuuviData[]): Promise<void> {
  if (!samples.length) return;
  const rows = samples.map(toRow);
  let conn: PoolConnection | undefined;
  try {
    conn = await getMariaPool().getConnection();
    await conn.query(INSERT_SQL, [rows]); // Multi-row INSERT in a single query
    logger.debug({ count: rows.length }, 'MariaDB batch written');
  } catch (err) {
    logger.error({ err }, 'MariaDB write failed');
  } finally {
    conn?.release();
  }
}
