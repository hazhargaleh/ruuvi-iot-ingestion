CREATE DATABASE IF NOT EXISTS ruuvi
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE ruuvi;

-- ─────────────────────────────────────────────────────────────
-- Main table: raw data only
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS measurements
(
    id                          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ts                          DATETIME(3)  NOT NULL,
    device_id                   VARCHAR(17)  NOT NULL COMMENT 'MAC address of tag',
    device_name                 VARCHAR(100) NOT NULL COMMENT 'RuuviTag name (user-configurable)',
    gateway_id                  VARCHAR(17)  NOT NULL COMMENT 'MAC address of gateway',
    gateway_name                VARCHAR(100) NOT NULL COMMENT 'Gateway name (user-configurable)',
    rssi                        SMALLINT COMMENT 'Received Signal Strength Indicator (dBm)',
    temperature                 DECIMAL(7, 4) COMMENT '°C',
    humidity                    DECIMAL(7, 4) COMMENT '% relative humidity',
    pressure                    INT UNSIGNED COMMENT 'Pa (hectopascals × 100)',
    acceleration_x              DECIMAL(7, 4) COMMENT 'g',
    acceleration_y              DECIMAL(7, 4) COMMENT 'g',
    acceleration_z              DECIMAL(7, 4) COMMENT 'g',
    battery_voltage             DECIMAL(5, 3) COMMENT 'V',
    tx_power                    TINYINT COMMENT 'dBm',
    movement_counter            SMALLINT UNSIGNED COMMENT 'Increments on movement',
    measurement_sequence_number MEDIUMINT UNSIGNED COMMENT 'Increments on each measurement, resets on reboot',
    data_format                 TINYINT UNSIGNED COMMENT 'RuuviTag data format version',

    INDEX idx_ts (ts),
    INDEX idx_device (device_id, ts),
    INDEX idx_device_name (device_name, ts),
    INDEX idx_gateway (gateway_name, ts),
    INDEX idx_temp (temperature)
) ENGINE = InnoDB
  ROW_FORMAT = COMPRESSED
    COMMENT ='RuuviTag raw measurements';

-- ─────────────────────────────────────────────────────────────
-- View: all metrics with calculated fields
-- Used for historical dashboards
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW measurements_calculated AS
SELECT
    id,
    ts,
    device_id,
    device_name,
    gateway_id,
    gateway_name,
    rssi,

    -- Raw measurements
    temperature,
    humidity,
    pressure,
    acceleration_x,
    acceleration_y,
    acceleration_z,
    battery_voltage,
    tx_power,
    movement_counter,
    measurement_sequence_number,
    data_format,

    -- Saturation vapour pressure (Pa) — Magnus's formula
    611.2 * EXP((17.625 * temperature) / (243.04 + temperature))
                 AS equilibrium_vapor_pressure,

    -- Dew point (°C) — Magnus's formula
    -- Valid for T ≥ 0°C
    CASE
        WHEN temperature >= 0 THEN
            (243.04 * (LN(humidity / 100) + (17.625 * temperature) / (243.04 + temperature)))
                / (17.625 - LN(humidity / 100) - (17.625 * temperature) / (243.04 + temperature))
        END                                                                                   AS dew_point,

    -- Freezing point (°C) — Alduchov & Eskridge formula
    -- More accurate than the dew point when T < 0°C
    IF(temperature < 0, (273.86 * (LN(humidity / 100) + (22.587 * temperature) / (273.86 + temperature)))
        / (22.587 - LN(humidity / 100) - (22.587 * temperature) / (273.86 + temperature)),
       (243.04 * (LN(humidity / 100) + (17.625 * temperature) / (243.04 + temperature)))
           / (17.625 - LN(humidity / 100) - (17.625 * temperature) / (243.04 + temperature))) AS frost_point,

    -- Absolute humidity (g/m³)
    (
        (humidity / 100)
            * 611.2 * EXP((17.625 * temperature) / (243.04 + temperature))
            / (461.5 * (temperature + 273.15))
        ) * 1000                                                                              AS absolute_humidity,

    -- Air density humid (kg/m³)
    (
        (pressure - (humidity / 100) * 611.2 * EXP((17.625 * temperature) / (243.04 + temperature)))
            / (287.058 * (temperature + 273.15))
        ) + (
        (humidity / 100) * 611.2 * EXP((17.625 * temperature) / (243.04 + temperature))
            / (461.5 * (temperature + 273.15))
        )                                                                         AS air_density,

    -- Vapour pressure deficit — VPD (kPa)
    -- Ideal greenhouse conditions: 0.8–1.2 kPa
    (611.2 * EXP((17.625 * temperature) / (243.04 + temperature)) * (1 - humidity / 100)) / 1000
                 AS vapor_pressure_deficit,

    -- Acceleration vector standard (g)
    SQRT(
            acceleration_x * acceleration_x +
            acceleration_y * acceleration_y +
            acceleration_z * acceleration_z
    ) AS acceleration_total,

    -- Angles of inclination (degrees)
    DEGREES(ACOS(
            acceleration_x / NULLIF(SQRT(
                                            acceleration_x * acceleration_x +
                                            acceleration_y * acceleration_y +
                                            acceleration_z * acceleration_z
                                    ), 0)
            )) AS acceleration_angle_x,

    DEGREES(ACOS(
            acceleration_y / NULLIF(SQRT(
                                            acceleration_x * acceleration_x +
                                            acceleration_y * acceleration_y +
                                            acceleration_z * acceleration_z
                                    ), 0)
            )) AS acceleration_angle_y,

    DEGREES(ACOS(
            acceleration_z / NULLIF(SQRT(
                                            acceleration_x * acceleration_x +
                                            acceleration_y * acceleration_y +
                                            acceleration_z * acceleration_z
                                    ), 0)
            )) AS acceleration_angle_z,

    -- Battery percentage — CR2477 discharge curve (linear segments)
    CASE
        WHEN battery_voltage >= 3.0 THEN 100.0
        WHEN battery_voltage >= 2.9 THEN 75.0 + (battery_voltage - 2.9) / (3.0 - 2.9) * 25.0
        WHEN battery_voltage >= 2.7 THEN 50.0 + (battery_voltage - 2.7) / (2.9 - 2.7) * 25.0
        WHEN battery_voltage >= 2.5 THEN 25.0 + (battery_voltage - 2.5) / (2.7 - 2.5) * 25.0
        WHEN battery_voltage >= 2.0 THEN (battery_voltage - 2.0) / (2.5 - 2.0) * 25.0
        ELSE 0.0
        END AS battery_percentage

FROM measurements;

-- ─────────────────────────────────────────────────────────────
-- View: latest metric calculated by device
-- Used for stat panels / gauges
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW latest_measurements AS
SELECT c.*
FROM measurements_calculated c
         INNER JOIN (
    SELECT device_id, MAX(ts) AS max_ts
    FROM measurements
    GROUP BY device_id
) latest ON c.device_id = latest.device_id
    AND c.ts         = latest.max_ts;
-- ─────────────────────────────────────────────────────────────
-- Downsample table - Table of hourly averages - same fields as measurements but with averages and min/max values for the hour
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS measurements_hourly
(
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    ts_hour                DATETIME          NOT NULL COMMENT 'Time rounded to the nearest hour (UTC)',
    device_id              VARCHAR(17)       NOT NULL COMMENT 'MAC address of tag',
    device_name            VARCHAR(100)      NOT NULL COMMENT 'RuuviTag name (user-configurable)',
    gateway_id             VARCHAR(17)       NOT NULL COMMENT 'MAC address of gateway',
    gateway_name           VARCHAR(100)      NOT NULL COMMENT 'Gateway name (user-configurable)',
    sample_count           SMALLINT UNSIGNED NOT NULL COMMENT 'Number of aggregated measurements',
-- Averages of raw measurements
    rssi                   DECIMAL(6, 2) COMMENT 'Average Received Signal Strength Indicator (dBm)',
    temperature            DECIMAL(7, 4) COMMENT 'Average °C',
    humidity               DECIMAL(7, 4) COMMENT 'Average % relative humidity',
    pressure               DECIMAL(10, 4) COMMENT 'Average Pa (hectopascals × 100)',
    acceleration_x         DECIMAL(7, 4) COMMENT 'Average g',
    acceleration_y         DECIMAL(7, 4) COMMENT 'Average g',
    acceleration_z         DECIMAL(7, 4) COMMENT 'Average g',
    acceleration_total     DECIMAL(7, 4) COMMENT 'Average of acceleration vector standard (g)',
    battery_voltage        DECIMAL(5, 3) COMMENT 'Average V',
    movement_counter_delta SMALLINT UNSIGNED COMMENT 'Number of transactions during the period',
    absolute_humidity      DECIMAL(8, 4) COMMENT 'Average of absolute humidity (g/m³)',
    dew_point              DECIMAL(7, 4) COMMENT 'Average of dew point (°C)',
    frost_point            DECIMAL(7, 4) COMMENT 'Average of frost point (°C)',
    vapor_pressure_deficit DECIMAL(8, 5) COMMENT 'Average of vapor pressure deficit (kPa)',
    battery_percentage     DECIMAL(5, 2) COMMENT 'Average of battery percentage (%)',
-- Min/Max values of raw measurements
    rssi_min              DECIMAL(6, 2) COMMENT 'Minimum RSSI during the hour (dBm)',
    rssi_max              DECIMAL(6, 2) COMMENT 'Maximum RSSI during the hour (dBm)',
    temperature_min        DECIMAL(7, 4) COMMENT 'Minimum temperature during the hour (°C)',
    temperature_max        DECIMAL(7, 4) COMMENT 'Maximum temperature during the hour (°C)',
    humidity_min           DECIMAL(7, 4) COMMENT 'Minimum humidity during the hour (% relative humidity)',
    humidity_max           DECIMAL(7, 4) COMMENT 'Maximum humidity during the hour (% relative humidity)',
    pressure_min           DECIMAL(10, 4) COMMENT 'Minimum pressure during the hour (Pa)',
    pressure_max           DECIMAL(10, 4) COMMENT 'Maximum pressure during the hour (Pa)',
    acceleration_x_min     DECIMAL(7, 4) COMMENT 'Minimum acceleration x during the hour (g)',
    acceleration_x_max     DECIMAL(7, 4) COMMENT 'Maximum acceleration x during the hour (g)',
    acceleration_y_min     DECIMAL(7, 4) COMMENT 'Minimum acceleration y during the hour (g)',
    acceleration_y_max     DECIMAL(7, 4) COMMENT 'Maximum acceleration y during the hour (g)',
    acceleration_z_min     DECIMAL(7, 4) COMMENT 'Minimum acceleration z during the hour (g)',
    acceleration_z_max     DECIMAL(7, 4) COMMENT 'Maximum acceleration z during the hour (g)',
    acceleration_total_min DECIMAL(7, 4) COMMENT 'Minimum acceleration vector standard during the hour (g)',
    acceleration_total_max DECIMAL(7, 4) COMMENT 'Maximum acceleration vector standard during the hour (g)',
    absolute_humidity_min  DECIMAL(8, 4) COMMENT 'Minimum absolute humidity during the hour (g/m³)',
    absolute_humidity_max  DECIMAL(8, 4) COMMENT 'Maximum absolute humidity during the hour (g/m³)',
    dew_point_min          DECIMAL(7, 4) COMMENT 'Minimum dew point during the hour (°C)',
    dew_point_max          DECIMAL(7, 4) COMMENT 'Maximum dew point during the hour (°C)',
    frost_point_min        DECIMAL(7, 4) COMMENT 'Minimum frost point during the hour (°C)',
    frost_point_max        DECIMAL(7, 4) COMMENT 'Maximum frost point during the hour (°C)',
    vapor_pressure_deficit_min DECIMAL(8, 5) COMMENT 'Minimum vapor pressure deficit during the hour (kPa)',
    vapor_pressure_deficit_max DECIMAL(8, 5) COMMENT 'Maximum vapor pressure deficit during the hour (kPa)',
    UNIQUE KEY uq_device_hour (device_id, ts_hour),
    INDEX idx_hour (ts_hour),
    INDEX idx_device_hour (device_id, ts_hour),
    INDEX idx_device_name_hour (device_name, ts_hour)
) ENGINE = InnoDB
  ROW_FORMAT = COMPRESSED
    COMMENT ='RuuviTag data aggregated by the hour'