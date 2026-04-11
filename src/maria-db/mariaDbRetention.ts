import { getMariaPool } from './mariaDbService.js';
import { config } from '../config/env.js';
import { logger } from '../logger/logger.js';

// ── Downsampling: hourly aggregation ───
async function runDownsample(): Promise<void> {
  const conn = await getMariaPool().getConnection();
  try {
    // We aggregate the full hours that are not yet present in `measurements_hourly`
    //  DATE_FORMAT rounds to the nearest hour
    const [result] = (await conn.query(`
      INSERT INTO measurements_hourly (ts_hour, device_fk, sample_count,
                                       rssi, rssi_min, rssi_max,
                                       temperature, temperature_min, temperature_max,
                                       humidity, humidity_min, humidity_max,
                                       pressure, pressure_min, pressure_max,
                                       acceleration_x, acceleration_x_min, acceleration_x_max,
                                       acceleration_y, acceleration_y_min, acceleration_y_max,
                                       acceleration_z, acceleration_z_min, acceleration_z_max,
                                       acceleration_total, acceleration_total_min, acceleration_total_max,
                                       battery_voltage,
                                       movement_counter_delta,
                                       absolute_humidity, absolute_humidity_min, absolute_humidity_max,
                                       dew_point, dew_point_min, dew_point_max,
                                       frost_point, frost_point_min, frost_point_max,
                                       vapor_pressure_deficit, vapor_pressure_deficit_min, vapor_pressure_deficit_max,
                                       battery_percentage)
      SELECT DATE_FORMAT(mc.ts, '%Y-%m-%d %H:00:00')                    AS ts_hour,
             mc.device_fk,
             COUNT(*)                                                   AS sample_count,
             -- Rssi
             AVG(mc.rssi)                                               AS rssi,
             ROUND(MIN(mc.rssi), 4)                                     AS rssi_min,
             ROUND(MAX(mc.rssi), 4)                                     AS rssi_max,
             -- Temperature
             ROUND(AVG(mc.temperature), 4)                              AS temperature,
             ROUND(MIN(mc.temperature), 4)                              AS temperature_min,
             ROUND(MAX(mc.temperature), 4)                              AS temperature_max,
             -- Humidity
             ROUND(AVG(mc.humidity), 4)                                 AS humidity,
             ROUND(MIN(mc.humidity), 4)                                 AS humidity_min,
             ROUND(MAX(mc.humidity), 4)                                 AS humidity_max,
             -- Pressure
             AVG(mc.pressure)                                           AS pressure,
             ROUND(MIN(mc.pressure), 4)                                 AS pressure_min,
             ROUND(MAX(mc.pressure), 4)                                 AS pressure_max,
             -- Acceleration X
             ROUND(AVG(mc.acceleration_x), 4)                           AS acceleration_x,
             ROUND(MIN(mc.acceleration_x), 4)                           AS acceleration_x_min,
             ROUND(MAX(mc.acceleration_x), 4)                           AS acceleration_x_max,
             -- Acceleration Y
             ROUND(AVG(mc.acceleration_y), 4)                           AS acceleration_y,
             ROUND(MIN(mc.acceleration_y), 4)                           AS acceleration_y_min,
             ROUND(MAX(mc.acceleration_y), 4)                           AS acceleration_y_max,
             -- Acceleration Z
             ROUND(AVG(mc.acceleration_z), 4)                           AS acceleration_z,
             ROUND(MIN(mc.acceleration_z), 4)                           AS acceleration_z_min,
             ROUND(MAX(mc.acceleration_z), 4)                           AS acceleration_z_max,
             -- Acceleration total
             ROUND(AVG(mc.acceleration_total), 4)                       AS acceleration_total,
             ROUND(MIN(mc.acceleration_total), 4)                       AS acceleration_total_min,
             ROUND(MAX(mc.acceleration_total), 4)                       AS acceleration_total_max,
             -- Battery voltage
             ROUND(AVG(mc.battery_voltage), 3)                          AS battery_voltage,
             -- Movement counter delta
             MAX(mc.movement_counter) - MIN(mc.movement_counter) AS movement_counter_delta,
             -- Absolute humidity
             ROUND(AVG(mc.absolute_humidity), 4)                        AS absolute_humidity,
             ROUND(MIN(mc.absolute_humidity), 4)                        AS absolute_humidity_min,
             ROUND(MAX(mc.absolute_humidity), 4)                        AS absolute_humidity_max,
             -- Dew point
             ROUND(AVG(mc.dew_point), 4)                                AS dew_point,
             ROUND(MIN(mc.dew_point), 4)                                AS dew_point_min,
             ROUND(MAX(mc.dew_point), 4)                                AS dew_point_max,
             -- Frost point
             ROUND(AVG(mc.frost_point), 4)                              AS frost_point,
             ROUND(MIN(mc.frost_point), 4)                              AS frost_point_min,
             ROUND(MAX(mc.frost_point), 4)                              AS frost_point_max,
             -- Vapor pressure deficit
             ROUND(AVG(mc.vapor_pressure_deficit), 4)                   AS vapor_pressure_deficit,
             ROUND(MIN(mc.vapor_pressure_deficit), 4)                   AS vapor_pressure_deficit_min,
             ROUND(MAX(mc.vapor_pressure_deficit), 4)                   AS vapor_pressure_deficit_max,
              -- Battery percentage
             ROUND(AVG(mc.battery_percentage), 3)                       AS battery_percentage
      FROM measurements_calculated mc
      WHERE
        -- Only full hours (not the current hour)
        mc.ts < DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00')
        -- Only the hours that have not yet been added up
        AND DATE_FORMAT(mc.ts, '%Y-%m-%d %H:00:00') NOT IN (SELECT ts_hour
                                                            FROM measurements_hourly
                                                            WHERE device_fk = mc.device_fk)
      GROUP BY DATE_FORMAT(mc.ts, '%Y-%m-%d %H:00:00'), mc.device_fk
      ON DUPLICATE KEY UPDATE sample_count    = VALUES(sample_count),
                              rssi            = VALUES(rssi),
                              rssi_min        = VALUES(rssi_min),
                              rssi_max        = VALUES(rssi_max),
                              temperature     = VALUES(temperature),
                              temperature_min = VALUES(temperature_min),
                              temperature_max = VALUES(temperature_max),
                              humidity        = VALUES(humidity),
                              humidity_min    = VALUES(humidity_min),
                              humidity_max    = VALUES(humidity_max),
                              pressure        = VALUES(pressure),
                              pressure_min    = VALUES(pressure_min),
                              pressure_max    = VALUES(pressure_max),
                              acceleration_x     = VALUES(acceleration_x),
                              acceleration_x_min = VALUES(acceleration_x_min),
                              acceleration_x_max = VALUES(acceleration_x_max),
                              acceleration_y     = VALUES(acceleration_y),
                              acceleration_y_min = VALUES(acceleration_y_min),
                              acceleration_y_max = VALUES(acceleration_y_max),
                              acceleration_z     = VALUES(acceleration_z),
                              acceleration_z_min = VALUES(acceleration_z_min),
                              acceleration_z_max = VALUES(acceleration_z_max),
                              acceleration_total     = VALUES(acceleration_total),
                              acceleration_total_min = VALUES(acceleration_total_min),
                              acceleration_total_max = VALUES(acceleration_total_max),
                              battery_voltage     = VALUES(battery_voltage),
                              battery_percentage     = VALUES(battery_percentage),
                              dew_point     = VALUES(dew_point),
                              dew_point_min = VALUES(dew_point_min),
                              dew_point_max = VALUES(dew_point_max),
                              frost_point     = VALUES(frost_point),
                              frost_point_min = VALUES(frost_point_min),
                              frost_point_max = VALUES(frost_point_max),
                              vapor_pressure_deficit     = VALUES(vapor_pressure_deficit),
                              vapor_pressure_deficit_min = VALUES(vapor_pressure_deficit_min),
                              vapor_pressure_deficit_max = VALUES(vapor_pressure_deficit_max)
    `)) as any;

    const affected = result?.affectedRows ?? 0;
    if (affected > 0) {
      logger.info({ rows: affected }, 'MariaDB downsample: hourly rows inserted');
    }

    // Delete aggregated raw data if enabled
    if (config.mariaRetention.downsampleDeleteRaw) {
      const [del] = (await conn.query(`
        DELETE FROM measurements
        WHERE ts < DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00')
          AND DATE_FORMAT(ts, '%Y-%m-%d %H:00:00') IN (
            SELECT ts_hour FROM measurements_hourly
          )
      `)) as any;

      const deleted = del?.affectedRows ?? 0;
      if (deleted > 0) {
        logger.info({ rows: deleted }, 'MariaDB downsample: raw rows deleted after aggregation');
      }
    }
  } catch (err) {
    logger.error({ err }, 'MariaDB downsample failed');
  } finally {
    conn.release();
  }
}

// ── Data retention: deletion of data that is too old ──
async function runRetention(): Promise<void> {
  const conn = await getMariaPool().getConnection();
  try {
    // Raw data
    if (config.mariaRetention.enabled) {
      const [raw] = (await conn.query(
        `
        DELETE FROM measurements
        WHERE ts < NOW() - INTERVAL ? DAY
        LIMIT 5000
      `,
        [config.mariaRetention.retentionDays],
      )) as any;

      const deleted = raw?.affectedRows ?? 0;
      if (deleted > 0) {
        logger.info(
          { rows: deleted, days: config.mariaRetention.retentionDays },
          'MariaDB retention: raw rows deleted',
        );
      }
    }

    // Downsampled data
    if (config.mariaRetention.downsampleEnabled && config.mariaRetention.downsampleRetentionDays > 0) {
      const [hourly] = (await conn.query(
        `
        DELETE FROM measurements_hourly
        WHERE ts_hour < NOW() - INTERVAL ? DAY
        LIMIT 5000
      `,
        [config.mariaRetention.downsampleRetentionDays],
      )) as any;

      const deleted = hourly?.affectedRows ?? 0;
      if (deleted > 0) {
        logger.info(
          { rows: deleted, days: config.mariaRetention.downsampleRetentionDays },
          'MariaDB retention: hourly rows deleted',
        );
      }
    }
  } catch (err) {
    logger.error({ err }, 'MariaDB retention failed');
  } finally {
    conn.release();
  }
}

// ── Scheduler ──
export function startMariaMaintenanceTasks(): void {
  const intervalMs = config.mariaRetention.maintenanceIntervalHours * 60 * 60 * 1000;

  // Run immediately on startup, then every X hours
  const run = async () => {
    logger.info('MariaDB maintenance tasks starting...');
    if (config.mariaRetention.downsampleEnabled) await runDownsample();
    if (config.mariaRetention.enabled) await runRetention();
    logger.info('MariaDB maintenance tasks done');
  };
  setInterval(run, intervalMs);

  logger.info(
    { intervalHours: config.mariaRetention.maintenanceIntervalHours },
    'MariaDB maintenance scheduler started - first run in ' +
    config.mariaRetention.maintenanceIntervalHours + 'h',
  );
}
