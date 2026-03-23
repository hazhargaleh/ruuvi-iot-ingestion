# ruuvi-iot-ingestion

A high-performance Node.js/TypeScript backend service that collects sensor data from [RuuviTag](https://ruuvi.com/) Bluetooth sensors via a Ruuvi Gateway and MQTT, computes derived metrics, and stores them in InfluxDB and/or MariaDB.

---

## Table of contents

- [Architecture](#architecture)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the service](#running-the-service)
- [Data pipeline](#data-pipeline)
- [Stored metrics](#stored-metrics)
- [MariaDB retention & downsampling](#mariadb-retention--downsampling)
- [HTTP endpoints](#http-endpoints)
- [Project structure](#project-structure)
- [Logging](#logging)
- [Optimizations](#optimizations)
- [License](#license)

---

## Architecture

```
RuuviTags (BLE)
      │
      ▼  Bluetooth
Ruuvi Gateway
      │
      ▼  MQTT over TLS
ruuvi-iot-ingestion (this service)
      │   • Zod validation
      │   • Derived metric calculation
      │   • Dual message buffer
      │
      ├──► InfluxDB v2   (time-series)
      └──► MariaDB       (SQL, HACCP reports, exports)
```

The gateway decodes BLE packets and publishes JSON payloads over MQTT. This service consumes those messages, enriches them with computed metrics (dew point, VPD, battery %, etc.), and writes them to one or both databases in configurable batches.

---

## Features

- **MQTT ingestion** — subscribes to `ruuvi/#` topics with TLS support and automatic reconnection
- **Zod validation** — strict schema validation of every incoming payload
- **Derived metrics** — dew point, frost point, absolute humidity, VPD, air density, acceleration angles, battery percentage, and more (see [Stored metrics](#stored-metrics))
- **Dual storage** — write to InfluxDB, MariaDB, or both simultaneously via a single env variable
- **Batch writes** — configurable buffer size and flush interval for both databases
- **Device name mapping** — map gateway and tag MAC addresses to human-readable names via `.env`
- **Auto schema init** — MariaDB tables and views are created automatically on first start
- **Retention & downsampling** — automatic deletion of old raw data and hourly aggregation for MariaDB (configurable)
- **Health & metrics** — Fastify HTTP server exposing `/health` and `/metrics` (Prometheus)
- **Structured logging** — `pino` with pretty-print in development

---

## Requirements

- Node.js >= 20
- npm >= 9
- One or more [Ruuvi Gateways](https://ruuvi.com/gateway/) with MQTT support
- InfluxDB v2 (if using InfluxDB storage)
- MariaDB >= 10.6 (if using MariaDB storage)

---

## Installation

1. Clone the project and install dependencies:

```bash
git clone https://github.com/hazhargaleh/ruuvi-iot-ingestion.git
cd ruuvi-iot-ingestion
npm install
```

2. Create a `.env` file from the example and adjust the values:

```bash
cp .env.example .env
```

---

## Configuration

All configuration is done via environment variables in your `.env` file.

### MQTT

| Variable | Default | Description |
|---|---|---|
| `MQTT_HOST` | `localhost` | MQTT broker hostname |
| `MQTT_PORT` | `8883` | MQTT broker port |
| `MQTT_PROTOCOL` | `mqtt` | Protocol — `mqtt`, `mqtts`, `ws`, `wss` |
| `MQTT_TOPIC` | `ruuvi/#` | Topic to subscribe to |
| `MQTT_USERNAME` | — | Optional broker username |
| `MQTT_PASSWORD` | — | Optional broker password |
| `MQTT_CA` | — | Path to CA certificate (TLS) |
| `MQTT_CERT` | — | Path to client certificate (TLS) |
| `MQTT_KEY` | — | Path to client key (TLS) |
| `MQTT_REJECT_UNAUTHORIZED` | `true` | Reject invalid TLS certificates |

### InfluxDB

| Variable | Default | Description |
|---|---|---|
| `INFLUX_URL` | — | InfluxDB URL, e.g. `http://localhost:8086` |
| `INFLUX_TOKEN` | — | InfluxDB API token |
| `INFLUX_ORG` | — | InfluxDB organisation name |
| `INFLUX_BUCKET` | — | InfluxDB bucket name |

### MariaDB

| Variable | Default | Description |
|---|---|---|
| `MARIA_HOST` | `localhost` | MariaDB hostname |
| `MARIA_PORT` | `3306` | MariaDB port |
| `MARIA_USER` | `ruuvi` | Database user |
| `MARIA_PASSWORD` | — | Database password |
| `MARIA_DATABASE` | `ruuvi` | Database name |

### Storage backend

| Variable | Default | Description |
|---|---|---|
| `STORAGE_BACKEND` | `both` | `influx` \| `maria` \| `both` |

### Buffering

| Variable | Default | Description |
|---|---|---|
| `BUFFER_SIZE` | `500` | Max points before an InfluxDB flush is triggered |
| `MARIA_BUFFER_SIZE` | `100` | Max rows before a MariaDB flush is triggered |
| `FLUSH_INTERVAL` | `5000` | Periodic flush interval in milliseconds |

### Device name mapping

Provide JSON-encoded objects mapping MAC addresses to human-readable labels:

```env
GATEWAY_NAMES='{"F3:2D:EF:E7:2E:78":"Station 1","C8:25:2D:8E:9C:2C":"Station 2"}'
TAG_NAMES='{"CE:52:DE:73:84:F2":"Fridge 1","AB:CD:EF:12:34:56":"Freezer"}'
```

If a MAC address is not listed, the raw MAC is used as a fallback.

### MariaDB retention & downsampling

| Variable | Default | Description |
|---|---|---|
| `MARIA_RETENTION_ENABLED` | `true` | Enable automatic deletion of old raw data |
| `MARIA_RETENTION_DAYS` | `30` | Retain raw data for this many days |
| `MARIA_DOWNSAMPLE_ENABLED` | `true` | Enable hourly aggregation |
| `MARIA_DOWNSAMPLE_RETENTION_DAYS` | `365` | Retain hourly data for this many days (`0` = forever) |
| `MARIA_DOWNSAMPLE_DELETE_RAW` | `true` | Delete raw rows once they have been aggregated |
| `MARIA_MAINTENANCE_INTERVAL_HOURS` | `6` | How often to run maintenance tasks (hours) |

### General

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` enables pretty-print logging |
| `HTTP_PORT` | `3002` | Port for the health/metrics HTTP server |
| `COMPANY_CODE` | `1177` | Ruuvi manufacturer company code (`0x0499`) |

---

## Running the service

### Development

Run the service in development mode with automatic reload:

```bash
npm run dev
```

### Production

Compile TypeScript and start the service:

```bash
npm run build
npm start
```
---

## Tests
Run th test suite with Jest (configuration with ES modules):
24 unit tests covering 
- RuuviTag calculations (pressure, humidity, angles, etc.)
- Message buffer behavior
Parameterized exhaustive tests

```bash
npm test  # Run tests
npm run test:watch # Watch mode for dev 
npm run test:converage # Coverage report
```
## Data pipeline

Each MQTT message goes through the following stages before being written to the database(s):

1. **Flood protection** — messages larger than 8 KB and non-Ruuvi topics are discarded immediately
2. **JSON parsing** — raw payload is parsed and validated against the Zod schema
3. **Device resolution** — gateway and tag MAC addresses are resolved to human-readable names
4. **Metric mapping** — decoded fields from the gateway payload are mapped to a `RuuviData` object
5. **Derived metric calculation** — computed fields are added once, shared by both storage backends
6. **Buffering** — the enriched `RuuviData` object is pushed to the InfluxDB buffer, the MariaDB buffer, or both, depending on `STORAGE_BACKEND`
7. **Batch write** — buffers are flushed either when they reach their size limit or on the periodic flush interval

---

## Stored metrics

### Raw metrics (from the RuuviTag firmware)

| Field | Unit | Description |
|---|---|---|
| `temperature` | °C | Ambient temperature |
| `humidity` | % | Relative humidity |
| `pressure` | Pa | Atmospheric pressure |
| `accelerationX/Y/Z` | g | Acceleration on each axis |
| `batteryVoltage` | V | Battery voltage |
| `txPower` | dBm | Transmit power |
| `movementCounter` | — | Cumulative movement count |
| `measurementSequenceNumber` | — | Packet sequence counter |
| `dataFormat` | — | RuuviTag data format version |
| `rssi` | dBm | Received signal strength |

### Derived metrics (calculated by this service)

| Field | Unit | Description |
|---|---|---|
| `dewPoint` | °C | Temperature at which condensation forms |
| `frostPoint` | °C | Freezing point — more accurate than dew point below 0 °C |
| `absoluteHumidity` | g/m³ | Mass of water vapour per unit volume of air |
| `equilibriumVaporPressure` | Pa | Saturation vapour pressure (Magnus formula) |
| `vaporPressureDeficit` | kPa | Key indicator for greenhouse horticulture |
| `airDensity` | kg/m³ | Density of humid air |
| `accelerationTotal` | g | Magnitude of the acceleration vector |
| `accelerationAngleFromX/Y/Z` | ° | Tilt angles from each axis |
| `batteryPercentage` | % | Estimated battery level (CR2477 discharge curve) |

---

## MariaDB retention & downsampling

When `STORAGE_BACKEND` is `maria` or `both`, two optional maintenance tasks run on a configurable schedule.

### Retention

Deletes rows from the `measurements` table older than `MARIA_RETENTION_DAYS`. Deletions are capped at 5 000 rows per run to avoid locking the table for extended periods on large datasets.

### Downsampling

Aggregates completed hours from `measurements` into the `measurements_hourly` table. Each hourly row contains:

- `AVG` for all continuous metrics (temperature, humidity, pressure, etc.)
- `MIN` / `MAX` for temperature and humidity — useful for cold-chain compliance
- `movement_counter_delta` — number of movements recorded during the hour

Once a raw hour has been successfully aggregated, raw rows for that hour can optionally be deleted (`MARIA_DOWNSAMPLE_DELETE_RAW=true`). The current hour is never aggregated — only complete hours are processed.

### Resulting data lifecycle example

```
Day 0  → 30    Raw data in measurements            (30s resolution)
Day 1  → 365   Hourly averages in measurements_hourly
Day 365+        Hourly data deleted if DOWNSAMPLE_RETENTION_DAYS=365
```

---

## HTTP endpoints

The service exposes a lightweight Fastify HTTP server. All endpoints require the `x-api-key` header set to the value of `INFLUX_TOKEN`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status":"ok"}` |
| `GET` | `/metrics` | Prometheus metrics (prom-client default metrics) |

---

## Project structure

```
.
├── dist/                         Compiled TypeScript → JavaScript
├── schema/
│   └── ruuvi_mqtt_data_with_timestamps.schema.json
└── src/
    ├── index.ts                  Entry point
    ├── config/
    │   └── env.ts                Environment variable parsing
    ├── http/
    │   └── healthServer.ts       Fastify health + metrics server
    ├── influx/
    │   └── influxService.ts      InfluxDB write client
    ├── logger/
    │   └── logger.ts             Pino logger
    ├── maria/
    │   ├── mariaService.ts       MariaDB pool, schema init, batch writes
    │   └── mariaRetention.ts     Retention & downsampling tasks
    ├── mqtt/
    │   └── mqttService.ts        MQTT client, message processing
    ├── pipeline/
    │   └── messageBuffer.ts      Generic batch buffer
    ├── ruuvi/
    │   ├── ruuviCalculations.ts  Derived metric formulas
    │   ├── ruuviData.ts          RuuviData model class
    │   ├── ruuviDecoder.ts       BLE manufacturer data decoder
    │   └── ruuvi_mqtt_data_with_timestamps.schema.ts  Zod schema
    └── types/
        └── advlib-ble-manufacturers.d.ts
```

---

## Logging

- Logs are generated with `pino`
- Key events such as MQTT connection, message reception, and batch writes are logged at `info` level
- Decode errors and invalid payloads are logged as `warn`
- In development (`NODE_ENV=development`), logs are pretty-printed via `pino-pretty`
- In production, logs are output as JSON and can be redirected to files or centralized logging services (Loki, Datadog, etc.)

---

## Optimizations

- Increase `BUFFER_SIZE` to reduce the number of InfluxDB write operations under high message volume
- Adjust `FLUSH_INTERVAL` based on your tag reporting interval (e.g. set to `30000` if tags report every 30 s)
- Use a local MQTT broker (e.g. Mosquitto) to reduce network latency
- Enable InfluxDB retention policies and downsampling tasks to manage storage growth over time
- Set `STORAGE_BACKEND=influx` if you do not need SQL exports, to avoid unnecessary MariaDB writes

---

## License

MIT License — open source project

## Author

[Hazhar Galeh](https://github.com/hazhargaleh)