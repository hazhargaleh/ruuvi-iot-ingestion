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
- [Testing](#testing)
- [Data pipeline](#data-pipeline)
- [Stored metrics](#stored-metrics)
- [MariaDB retention & downsampling](#mariadb-retention--downsampling)
- [HTTP endpoints](#http-endpoints)
- [Prometheus metrics](#prometheus-metrics)
- [Docker](#docker)
- [Production deployment](#production-deployment)
- [Project structure](#project-structure)
- [Logging](#logging)
- [Optimizations](#optimizations)
- [Troubleshooting](#troubleshooting)
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
      ├──► InfluxDB v2   (time-series, Grafana dashboards)
      └──► MariaDB       (SQL, HACCP reports, exports)
```

The gateway decodes BLE packets and publishes JSON payloads over MQTT. This service consumes those messages, enriches them with computed metrics (dew point, VPD, battery %, etc.), and writes them to one or both databases in configurable batches.

---

## Features

- **MQTT ingestion** — subscribes to `ruuvi/#` topics with TLS support and automatic reconnection
- **Zod validation** — strict schema validation on every incoming payload, including the config itself at startup
- **Derived metrics** — dew point, frost point, absolute humidity, VPD, air density, acceleration angles, battery percentage, and more (see [Stored metrics](#stored-metrics))
- **Dual storage** — write to InfluxDB, MariaDB, or both simultaneously via a single env variable
- **Batch writes** — configurable buffer size and flush interval for both databases
- **Device name mapping** — map gateway and tag MAC addresses to human-readable names via `.env`
- **Auto schema init** — MariaDB tables and views are created automatically on first start
- **Retention & downsampling** — automatic deletion of old raw data and hourly aggregation for MariaDB (configurable)
- **Health & metrics** — Fastify HTTP server exposing `/health` and `/metrics` (Prometheus via `prom-client`)
- **Rate limiting** — built-in protection against brute-force and DoS attacks on HTTP endpoints
- **Structured logging** — `pino` with pretty-print in development
- **Docker support** — multi-stage `Dockerfile` with non-root user and `dumb-init` for proper signal handling
- **Unit tests** — Jest test suite covering calculations and buffer logic

---

## Requirements

- Node.js >= 24
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

2. Create a `.env` file from the example:

```bash
cp .env.example .env
```

3. Generate a secure API key and add it to your `.env`:

```bash
# Linux / macOS
openssl rand -hex 32

# PowerShell (Windows)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }))

# One-liner — appends directly to .env (Linux / macOS)
echo "HTTP_API_KEY=$(openssl rand -hex 32)" >> .env
```

4. Edit `.env` and fill in your MQTT, InfluxDB, and MariaDB connection details.

---

## Configuration

All configuration is done via environment variables in your `.env` file. The entire configuration is validated with Zod at startup — the service will refuse to start and print a clear error message if a required variable is missing or has an invalid format.

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
| `INFLUX_URL` | — | InfluxDB URL — must include the scheme, e.g. `http://localhost:8086` |
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
| `STORAGE_BACKEND` | `both` | `influxdb` \| `mariadb` \| `both` |

### Buffering

| Variable | Default | Description |
|---|---|---|
| `BUFFER_SIZE` | `500` | Max points before an InfluxDB flush is triggered |
| `MARIA_BUFFER_SIZE` | `100` | Max rows before a MariaDB flush is triggered |
| `FLUSH_INTERVAL` | `5000` | Periodic flush interval in milliseconds |

### HTTP & security

| Variable | Default | Description |
|---|---|---|
| `HTTP_PORT` | `3002` | Port for the health/metrics HTTP server |
| `HTTP_API_KEY` | **required** | API key for all HTTP endpoints — see [Installation](#installation) for generation instructions |

> `HTTP_API_KEY` is independent of `INFLUX_TOKEN`. This allows rotating each credential separately without affecting the other.

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
| `MARIA_RETENTION_DAYS` | `60` | Retain raw data for this many days |
| `MARIA_DOWNSAMPLE_ENABLED` | `true` | Enable hourly aggregation |
| `MARIA_DOWNSAMPLE_RETENTION_DAYS` | `365` | Retain hourly data for this many days (`0` = forever) |
| `MARIA_DOWNSAMPLE_DELETE_RAW` | `true` | Delete raw rows once they have been aggregated |
| `MARIA_MAINTENANCE_INTERVAL_HOURS` | `6` | How often to run maintenance tasks (hours) |

### General

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` enables pretty-print logging |
| `COMPANY_CODE` | `1177` | Ruuvi manufacturer company code (`0x0499`) |

---

## Running the service

### Development

Run with automatic reload on file changes:

```bash
npm run dev
```

### Production

Compile TypeScript and start the service:

```bash
npm run build
npm start
```

### Linting & formatting

```bash
npm run lint       # ESLint
npm run format     # Prettier
npm run typecheck  # TypeScript (no emit)
```

---

## Testing

The project uses [Jest](https://jestjs.io/) with `ts-jest`.

```bash
# Run all tests
npm test

# Watch mode — re-run on file changes
npm run test:watch

# With coverage report
npm run test:coverage
```

### Test coverage

| Module | Tests |
|---|---|
| `ruuviCalculations.ts` | `equilibriumVaporPressure`, `dewPoint`, `frostPoint`, `absoluteHumidity`, `airDensity`, `accelerationTotal`, `vaporPressureDeficit`, `accelerationAngles`, `batteryPercentage` |
| `messageBuffer.ts` | Buffer accumulation, size-triggered flush, manual flush, empty buffer guard |

All 24 tests pass. ✅

---

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
| `vaporPressureDeficit` | kPa | Key indicator for greenhouse horticulture (ideal: 0.8–1.2 kPa) |
| `airDensity` | kg/m³ | Density of humid air |
| `accelerationTotal` | g | Magnitude of the acceleration vector |
| `accelerationAngleFromX/Y/Z` | ° | Tilt angles from each axis |
| `batteryPercentage` | % | Estimated battery level (CR2477 discharge curve) |

---

## MariaDB retention & downsampling

When `STORAGE_BACKEND` is `mariadb` or `both`, two optional maintenance tasks run on a configurable schedule.

### Retention

Deletes rows from the `measurements` table older than `MARIA_RETENTION_DAYS`. Deletions are capped at 5 000 rows per run to avoid locking the table on large datasets.

### Downsampling

Aggregates completed hours from `measurements` into the `measurements_hourly` table. Each hourly row contains:

- `AVG` for all continuous metrics (temperature, humidity, pressure, etc.)
- `MIN` / `MAX` for temperature and humidity — useful for cold-chain compliance
- `movement_counter_delta` — number of movements recorded during the hour

Once a raw hour has been successfully aggregated, raw rows for that hour can optionally be deleted (`MARIA_DOWNSAMPLE_DELETE_RAW=true`). The current hour is never aggregated — only complete hours are processed.

### Resulting data lifecycle example

```
Day 0  → 60    Raw data in measurements            (30s resolution)
Day 1  → 365   Hourly averages in measurements_hourly
Day 365+        Hourly data deleted if DOWNSAMPLE_RETENTION_DAYS=365
```

---

## HTTP endpoints

The service exposes a Fastify HTTP server protected by an API key and rate limiting (100 requests/minute per IP).

All requests must include the header:

```
x-api-key: <HTTP_API_KEY>
```

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status":"ok"}` |
| `GET` | `/metrics` | Prometheus metrics |

### Quick check

```bash
curl -H "x-api-key: your-api-key" http://localhost:3002/health
# {"status":"ok"}

curl -H "x-api-key: your-api-key" http://localhost:3002/metrics
# Prometheus text format
```

---

## Prometheus metrics

The `/metrics` endpoint exposes the following custom metrics in addition to the default Node.js process metrics:

| Metric | Type | Description |
|---|---|---|
| `ruuvi_mqtt_connected` | Gauge | MQTT connection status (`1` = connected, `0` = disconnected) |
| `ruuvi_mqtt_messages_processed_total` | Counter | Total MQTT messages processed successfully |
| `ruuvi_mqtt_messages_invalid_total` | Counter | Total invalid MQTT messages rejected by Zod |
| `ruuvi_buffer_size{type="influx"}` | Gauge | Current InfluxDB buffer fill level |
| `ruuvi_buffer_size{type="maria"}` | Gauge | Current MariaDB buffer fill level |

### Scraping with Prometheus

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'ruuvi'
    static_configs:
      - targets: ['localhost:3002']
    metrics_path: '/metrics'
    params:
      x-api-key: ['your-api-key']
```

### Useful PromQL queries

```
# MQTT connection status
ruuvi_mqtt_connected

# Message throughput (per minute)
rate(ruuvi_mqtt_messages_processed_total[1m])

# Error rate
rate(ruuvi_mqtt_messages_invalid_total[1m])

# Buffer utilization
ruuvi_buffer_size
```

### Grafana panels

| Panel | Query |
|---|---|
| MQTT status | `ruuvi_mqtt_connected` |
| Messages/min | `rate(ruuvi_mqtt_messages_processed_total[1m])` |
| Error rate | `rate(ruuvi_mqtt_messages_invalid_total[1m])` |
| Buffer level | `ruuvi_buffer_size` |

---

## Docker

The project ships with a multi-stage `Dockerfile` and a `docker-compose.yml` that starts the full stack.

### Full stack with Docker Compose (recommended)

```bash
# Start all services
docker compose up -d

# Check status
docker compose ps

# Follow logs
docker compose logs -f ruuvi-ingestion

# Stop
docker compose down

# Stop and remove volumes (deletes all data)
docker compose down -v
```

### Services exposed

| Service | Port | Description |
|---|---|---|
| `ruuvi-iot-ingestion` | `3002` | Health & metrics HTTP server |
| `mosquitto` | `1883`, `9001` | MQTT broker |
| `influxdb` | `8086` | InfluxDB UI & API |
| `mariadb` | `3306` | MariaDB |

### Build and run the image standalone

```bash
# Build
docker build -t ruuvi-iot-ingestion:latest .

# Run
docker run -d \
  --name ruuvi \
  -p 3002:3002 \
  -e MQTT_HOST=mosquitto \
  -e MQTT_PORT=1883 \
  -e STORAGE_BACKEND=both \
  -e INFLUX_URL=http://influxdb:8086 \
  -e INFLUX_ORG=myorg \
  -e INFLUX_BUCKET=ruuvi \
  -e INFLUX_TOKEN=mytoken \
  -e MARIA_HOST=mariadb \
  -e MARIA_USER=ruuvi \
  -e MARIA_PASSWORD=ruuvi_pass \
  -e HTTP_API_KEY=your-secure-key \
  --network ruuvi-network \
  ruuvi-iot-ingestion:latest
```

> **Note:** The `docker-compose.yml` uses example credentials. Replace all passwords, tokens, and API keys before deploying to production.

---

## Production deployment

### Checklist

- [ ] All secrets stored in a secrets manager or environment injection (never committed to git)
- [ ] `HTTP_API_KEY` generated with `openssl rand -hex 32`
- [ ] TLS configured for MQTT (`mqtts`) and InfluxDB (`https`)
- [ ] `MQTT_REJECT_UNAUTHORIZED=true`
- [ ] Database backups scheduled
- [ ] Prometheus scraping and Grafana alerts configured
- [ ] Log forwarding to a centralized service (Loki, Datadog, etc.)
- [ ] Health check endpoint monitored by an uptime service
- [ ] Rollback plan documented

### Performance tuning for high load

```env
BUFFER_SIZE=2000
MARIA_BUFFER_SIZE=1000
FLUSH_INTERVAL=3000
```

### Kubernetes example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ruuvi-iot-ingestion
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ruuvi-iot-ingestion
  template:
    metadata:
      labels:
        app: ruuvi-iot-ingestion
    spec:
      containers:
        - name: ruuvi-iot-ingestion
          image: your-registry/ruuvi-iot-ingestion:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 3002
          env:
            - name: MQTT_HOST
              valueFrom:
                configMapKeyRef:
                  name: ruuvi-config
                  key: mqtt_host
            - name: HTTP_API_KEY
              valueFrom:
                secretKeyRef:
                  name: ruuvi-secrets
                  key: api_key
          livenessProbe:
            httpGet:
              path: /health
              port: 3002
              httpHeaders:
                - name: x-api-key
                  value: $(HTTP_API_KEY)
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 3002
              httpHeaders:
                - name: x-api-key
                  value: $(HTTP_API_KEY)
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

---

## Project structure

```
.
├── Dockerfile
├── docker-compose.yml
├── schema/
│   ├── mariadb_init.sql           MariaDB schema (used by Docker entrypoint)
│   └── ruuvi_mqtt_data_with_timestamps.schema.json
└── src/
    ├── index.ts                   Entry point
    ├── config/
    │   └── env.ts                 Environment variable parsing & Zod validation
    ├── http/
    │   └── healthServer.ts        Fastify server — /health and /metrics
    ├── influx-db/
    │   └── influxDbService.ts     InfluxDB write client
    ├── logger/
    │   └── logger.ts              Pino logger
    ├── maria-db/
    │   ├── mariaDbService.ts      MariaDB pool, schema init, batch writes
    │   └── mariaDbRetention.ts    Retention & downsampling tasks
    ├── mqtt/
    │   └── mqttService.ts         MQTT client, message processing, Prometheus metrics
    ├── pipeline/
    │   └── messageBuffer.ts       Generic batch buffer with Prometheus gauge
    ├── ruuvi/
    │   ├── ruuviCalculations.ts   Derived metric formulas
    │   ├── ruuviData.ts           RuuviData model class
    │   ├── ruuviDecoder.ts        BLE manufacturer data decoder
    │   └── ruuviMqttDataWithTimestampsSchema.ts  Zod schema
    ├── tests/
    │   ├── messageBuffer.test.ts
    │   └── ruuviCalculations.test.ts
    └── types/
        └── advlib-ble-manufacturers.d.ts
```

---

## Logging

- Logs are generated with `pino`
- Key events (MQTT connection, batch writes, maintenance tasks) are logged at `info` level
- Decode errors and invalid payloads are logged as `warn`
- In development (`NODE_ENV=development`), logs are pretty-printed via `pino-pretty`
- In production, logs are output as JSON and can be forwarded to centralized services (Loki, Datadog, ELK, etc.)

```bash
# Follow logs in Docker
docker compose logs -f ruuvi-ingestion

# Filter buffer-related events
docker compose logs -f ruuvi-ingestion | grep buffer

# Kubernetes
kubectl logs -f deployment/ruuvi-iot-ingestion
```

---

## Optimizations

- Increase `BUFFER_SIZE` to reduce the number of InfluxDB write operations under high message volume
- Adjust `FLUSH_INTERVAL` to match your tag reporting interval (e.g. `30000` for 30 s reporting)
- Use a local MQTT broker (Mosquitto is included in `docker-compose.yml`) to reduce network latency
- Set `STORAGE_BACKEND=influxdb` if you do not need SQL exports, to skip unnecessary MariaDB writes
- Set `MARIA_DOWNSAMPLE_DELETE_RAW=true` to keep the `measurements` table small and fast

---

## Troubleshooting

### `HTTP_API_KEY` not set

The service refuses to start if `HTTP_API_KEY` is missing. Generate one and add it to your `.env`:

```bash
openssl rand -hex 32
```

### `INFLUX_URL` invalid format

The URL must include the scheme:

```env
# correct
INFLUX_URL=http://localhost:8086

# incorrect — missing http://
INFLUX_URL=localhost:8086
```

### MQTT connection fails

```bash
# Check the broker is running
docker compose logs mosquitto

# For local dev, MQTT_HOST should be localhost
# Inside Docker Compose, MQTT_HOST should be mosquitto
```

### No data in the databases

```bash
# Check service logs for errors
docker compose logs ruuvi-ingestion

# Verify MQTT messages are arriving
docker compose logs mosquitto

# Check buffer metrics
curl -H "x-api-key: your-key" http://localhost:3002/metrics | grep ruuvi_buffer
```

### Real-time metrics monitoring

```bash
watch 'curl -s -H "x-api-key: your-key" http://localhost:3002/metrics | grep ruuvi'
```

---

## License

MIT License — open source project

## Author

[Hazhar Galeh](https://github.com/hazhargaleh)