# Datacake → Home Assistant MQTT Bridge

A self-hosted bridge that inventories devices in a [Datacake](https://datacake.co) workspace, consumes their live telemetry via Datacake Realtime MQTT, and publishes them to Home Assistant using MQTT Discovery. Home Assistant picks up every exported field automatically as a proper entity — no YAML, no HACS, no custom Python integration.

> MVP scope: one workspace, one HA broker, one process. No multi-tenant SaaS.

## Features

- Paginated inventory of all devices in a Datacake workspace (GraphQL) with
  proper dedupe-by-`device.id` stop conditions (empty page OR unique count ≥
  `total`).
- Subscription to `dtck/<productSlug>/<deviceId>/+` topics per selected device.
- Mapping engine (`semantic` → `fieldType` → `fieldName`) that turns raw Datacake fields into HA sensors / binary sensors with `device_class`, `unit_of_measurement`, `state_class`, …
- Mapping decisions persisted per field so the UI renders instantly and the
  mapping stays auditable.
- Stable, deterministic `unique_id`s; retained discovery, state and availability topics.
- **Entity cleanup built-in**: when a field is disabled, removed from the
  Datacake inventory, or its device is de-selected/deleted, the bridge
  publishes an empty retained payload to the discovery topic so Home
  Assistant removes the entity instead of leaving a tombstone.
- **Strict serialisation**: every inventory sync, registry rebuild, MQTT
  (un)subscribe and discovery publish goes through a single async mutex —
  no race conditions, no duplicate subscriptions.
- Diagnostic fields (RSSI, SNR, datarate, …) opt-in only. Location / GEO /
  user-log / unknown strings never exported by default, but retained in the
  DB for future device-attribute support.
- SQLite persistence — configuration, device selection, field toggles, last
  values *and* the set of retained topics ever published survive restarts.
- Server-rendered Tailwind admin UI: settings, device selection, per-field mapping, status and logs.
- Automatic re-announce when Home Assistant (re)comes online (`<prefix>/status`).
- Dockerfile + docker-compose; runs as a non-root user on a `/data` volume
  (ready for a future Home Assistant add-on).

## Installation options

The same code runs in two modes:

- **Plain Docker** on any host next to Home Assistant — quick start below.
- **Home Assistant Add-on** installed via the Supervisor, with Ingress UI and
  auto-discovered HA MQTT broker. See [Home Assistant add-on](#home-assistant-add-on).

## Quick start (Docker)

```bash
docker compose build
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and fill in:

1. Datacake GraphQL endpoint (default `https://api.datacake.co/graphql/`), API token, Workspace ID.
2. Datacake Realtime MQTT URL + credentials.
3. Home Assistant MQTT broker URL + credentials.
4. Optional: Discovery prefix (default `homeassistant`).

Use the **Test** buttons on the settings page to verify credentials, then **Sync inventory** on the *Devices* page. Tick the devices you want to export, optionally open a device to toggle individual fields and save — Home Assistant will show the new entities within seconds.

### Running without Docker

```bash
npm install
npm run build
PORT=3000 DB_PATH=./data/bridge.db node dist/index.js
```

Dev workflow (watch TypeScript + Tailwind):

```bash
npm run dev
```

## Architecture

```text
┌──────────────┐   GraphQL    ┌─────────────────┐
│ Datacake API │──────────────▶│ InventoryService│
└──────────────┘               └────────┬────────┘
                                        │ upsert
                                        ▼
                                 ┌───────────────┐
                                 │    SQLite     │
                                 └──────┬────────┘
                                        │ rebuild
                                        ▼
┌──────────────────┐  dtck/…   ┌─────────────────┐   datacake/state/…   ┌──────────────┐
│ Datacake MQTT    │──────────▶│ Runtime Registry│─────────────────────▶│ HA MQTT      │
│ (broker)         │           │   + Orchestrator│  homeassistant/…/cfg │ (HA broker)  │
└──────────────────┘           └─────────────────┘                      └──────────────┘
         ▲                                                                    │
         └──── subscriptions on device-selection change ──────────────────────┘

                                 ┌─────────────┐
                                 │  Web UI     │  (Express + EJS + Tailwind)
                                 └─────────────┘
```

Key modules (all under `src/`):

| Module | Purpose |
|---|---|
| `config/configService.ts` | Settings with Zod validation, persisted in SQLite |
| `datacake/datacakeApi.ts` | GraphQL client, retries, timeouts |
| `datacake/inventoryService.ts` | Paginated `AllDevices` with dedupe + merge |
| `mapping/semanticRules.ts` | Central table of semantic → HA mapping |
| `mapping/fieldMapper.ts` | Priority resolver: `semantic` > `fieldType` > `fieldName` |
| `mapping/discoveryBuilder.ts` | HA discovery payload + SHA1 hash |
| `mqtt/mqttDatacakeSubscriber.ts` | Manages subscriptions per selected device |
| `mqtt/mqttHomeAssistantPublisher.ts` | Retained discovery/state/availability publishes |
| `runtime/runtimeRegistry.ts` | In-memory device/field registry |
| `runtime/bridgeOrchestrator.ts` | Lifecycle + event flow |
| `ui/webServer.ts` | Server-rendered admin UI |

## Topic schema

| Direction | Topic | Retained |
|---|---|---|
| IN (Datacake) | `dtck/<productSlug>/<deviceId>/<fieldName>` | — |
| OUT (HA discovery) | `<prefix>/<component>/<uniqueId>/config` | ✅ |
| OUT (HA state) | `datacake/state/<deviceId>/<fieldName>` | ✅ |
| OUT (HA availability) | `datacake/availability/<deviceId>` (`online`/`offline`) | ✅ |
| IN (HA lifecycle) | `<prefix>/status` (`online` → re-announce) | — |

The bridge never forwards Datacake topics 1:1 to HA. Each incoming message is parsed, resolved against the runtime registry, normalized and re-published on its own HA-friendly topic.

### Example discovery payload

```json
{
  "name": "Temperature",
  "unique_id": "dtck_5fa87e1f-b4b8-4801-b2e4-11960d300d71_temperature",
  "state_topic": "datacake/state/5fa87e1f-b4b8-4801-b2e4-11960d300d71/TEMPERATURE",
  "availability_topic": "datacake/availability/5fa87e1f-b4b8-4801-b2e4-11960d300d71",
  "payload_available": "online",
  "payload_not_available": "offline",
  "device_class": "temperature",
  "unit_of_measurement": "°C",
  "state_class": "measurement",
  "device": {
    "identifiers": ["dtck_5fa87e1f-b4b8-4801-b2e4-11960d300d71"],
    "name": "01 - Blumenbeet an der Terrasse zur Hecke",
    "manufacturer": "Datacake",
    "model": "teneo-soil-moisture-sensor-11"
  }
}
```

## Mapping & export policy

Priority: **`semantic` → `fieldType` → `fieldName` pattern**.

| Semantic / pattern | HA component | Device class | Unit | Default |
|---|---|---|---|---|
| `TEMPERATURE` | sensor | temperature | °C | exported |
| `HUMIDITY` | sensor | humidity | % | exported |
| `BATTERY` | sensor | battery | % | exported (diagnostic) |
| `RSSI` / `SIGNAL` / `LINKQUALITY` | sensor | signal_strength | dBm | opt-in (diagnostic) |
| `SNR` | sensor | — | dB | opt-in (diagnostic) |
| `SOIL_MOISTURE` / `MOISTURE` | sensor | moisture | % | exported |
| `CO2` | sensor | carbon_dioxide | ppm | exported |
| `POWER` / `ENERGY` / `VOLTAGE` / `CURRENT` | sensor | matching | matching | exported |
| `PRESSURE` / `ILLUMINANCE` | sensor | matching | matching | exported |
| `DOOR_OPENED` / `CONTACT` / `MOTION` / `OCCUPANCY` | binary_sensor | matching | — | exported |
| `LOCATION` / `USER_LOG` / `GEO` fieldType | ignored | — | — | **never exported as entity**, but kept in SQLite (future: device attributes) |
| `BOOL` fallback | binary_sensor | — | — | exported |
| `NUMERIC` fallback | sensor | — | — | exported |
| `STRING` fallback (no semantic, no pattern) | sensor | — | — | **not exported by default** — UI toggle required |

See `src/mapping/semanticRules.ts` for the full table. Per-field overrides can be set as JSON on the *Fields* page (e.g. `{ "name": "Kitchen CO2", "unit_of_measurement": "ppm" }`).

## Configuration reference

Environment variables (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port for the admin UI |
| `DB_PATH` | `./data/bridge.db` | SQLite file path |
| `LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` |
| `LOG_BUFFER_SIZE` | `500` | Entries kept in the in-memory ring buffer shown at `/logs` |

All other settings (API token, MQTT credentials, discovery prefix) live in SQLite and are edited via the `/settings` UI page. They are not read from environment variables so secrets are not leaked into container env.

## Persistence

SQLite schema (migrations in `src/db/migrations.ts`):

- `settings` — one row, JSON blob of the current configuration.
- `devices` — inventory snapshot + user selection (`selected` flag).
- `fields` — per-field export toggles, diagnostic flag, optional override,
  discovery hash, last value/availability **and the resolved mapping**
  (`mapped_component`, `mapped_device_class`, `mapped_unit`,
  `mapped_state_class`, `ignored`).
- `published_discoveries` — every retained discovery/state topic the bridge
  has actually published. Used by the cleanup step to tombstone orphaned
  entities.
- `published_availabilities` — every retained availability topic the bridge
  has published. Cleared when a device is removed or deselected.

Because discovery / state / availability topics are published with the retained flag, Home Assistant rehydrates the entity state immediately on its own restart. The bridge rehydrates its view of the world from SQLite, so restarts are transparent.

### Entity cleanup

Every reconfigure (settings save, device selection save, field toggle,
manual sync, HA re-announce) diffs the runtime registry against the
`published_*` tables. Anything no longer desired is cleared with an
**empty retained payload** so Home Assistant removes the entity. Without
this step stale entities would linger in HA indefinitely.

### Serialisation

All state-changing operations — inventory sync, registry rebuild, MQTT
connect / subscribe / publish, cleanup — run under a single async mutex
(`src/utils/mutex.ts`). This guarantees that concurrent UI submissions,
`homeassistant/status` events and runtime reconfigurations cannot race or
produce duplicate subscriptions.

### Availability logic (MVP spec)

- At inventory sync time, availability follows the `device.online` flag
  returned by the Datacake GraphQL API.
- Any incoming MQTT message from a known, selected device flips
  availability to `online` immediately.
- There is **no** aggressive offline handling based on inactivity in the
  MVP. A future configurable `lastHeard` timeout is a natural extension
  point (see `handleDatacakeMessage`).

## Operations

- `GET /logs` shows the last ~200 log lines straight from memory.
- `GET /status` exposes connection status for both MQTT brokers and the last API sync.
- **Re-publish discovery** on the status page forces all discovery topics to be re-sent (useful when HA was wiped).
- Subscribing the bridge to `homeassistant/status` means an HA restart auto-re-announces all entities without manual intervention.

## Troubleshooting

**Entities don't appear in HA.**  
Check `/status` — both MQTT indicators must be green. Verify that the configured discovery prefix matches HA's MQTT integration (default `homeassistant`). If HA was running before the bridge connected, hit **Re-publish discovery**.

**Values never update.**  
On the device list page, make sure the device is ticked. Then open the device and confirm the field has **Export** enabled. Watch `/logs` for `Received message for unknown field` or `Field not exported` entries.

**TLS errors on the Datacake MQTT broker.**  
Uncheck *Verify TLS certificate* on the settings page if you rely on a non-public CA, or install the CA in the container.

**Pagination loop / incomplete device list.**  
The inventory service paginates until all devices have been collected or an empty page is returned. The sync safety cap is 500 pages; increase `DEFAULT_PAGE_SIZE` in `inventoryService.ts` if you regularly run into it for very large workspaces.

**Overrides.**  
Each field has an optional *Override (JSON)* textarea that is shallow-merged into the discovery payload after the mapping engine builds it. Useful for renaming (`{"name":"Living room temp"}`) or forcing a unit (`{"unit_of_measurement":"°F"}`).

## Extension points

- **Write-back / commands.** `mqttHomeAssistantPublisher.ts` can subscribe to HA command topics and forward into the Datacake API. The orchestrator already owns both clients, so threading the callback through is straightforward.
- **Better offline detection.** Augment `bridgeOrchestrator.handleDatacakeMessage` with a timer per device to publish `offline` after a configurable inactivity window.
- **Additional entity types.** Add rules to `semanticRules.ts`; the mapping/discovery flow picks them up automatically.
- **LOCATION / GEO as device attributes.** Ignored for entity creation today
  but kept in SQLite with `ignored = 1`. A future release can expose them
  as extra `device` attributes on related entities or a `device_tracker`.

## Home Assistant add-on

This repository ships as a self-hostable **Home Assistant add-on** directly.
Everything the Supervisor needs lives under [`datacake-bridge/`](datacake-bridge/),
with the repository-level manifest at [`repository.yaml`](repository.yaml).

### Install

1. In Home Assistant go to *Settings → Add-ons → Add-on Store → ⋮ → Repositories*
   and paste `https://github.com/simmikolon/datacake-homeassistant-mqtt-bridge`.
   Hit *Reload*.
2. The "Datacake → Home Assistant Bridge" card appears. Click *Install*.
   The Supervisor builds the image locally from source (takes a few minutes).
3. *Start* the add-on. *Open Web UI* (via the card) lands you in the
   Tailwind settings page — authenticated via your HA session.

If you fork this repository, replace `simmikolon` in
[`repository.yaml`](repository.yaml),
[`datacake-bridge/config.yaml`](datacake-bridge/config.yaml),
[`datacake-bridge/build.yaml`](datacake-bridge/build.yaml) and
[`datacake-bridge/Dockerfile`](datacake-bridge/Dockerfile) with your own GitHub
username so the Supervisor clones from your fork at build time.

### What the add-on gives you on top of plain Docker

- **Ingress UI**: no external port, no separate login. HA embeds the UI and
  authenticates via your Home Assistant account.
- **Supervisor MQTT discovery**: the add-on declares `services: [mqtt:need]`
  so on first boot [`src/config/supervisorBootstrap.ts`](src/config/supervisorBootstrap.ts)
  asks the Supervisor for the running MQTT broker and pre-fills the HA MQTT
  section of the settings. You only supply Datacake credentials.
- **Persistent `/data`**: the Supervisor maintains a dedicated volume that
  survives add-on upgrades / reinstalls.
- **Multi-architecture**: amd64, aarch64, armv7 and armhf are declared in
  [`datacake-bridge/build.yaml`](datacake-bridge/build.yaml). Raspberry Pi,
  Intel NUC, etc. all work.

### Publishing prebuilt images (optional)

Local Supervisor builds take 2–5 minutes per arch. If you want users to
install in seconds, publish prebuilt images to GHCR via the provided
GitHub Actions workflow [`.github/workflows/publish-addon.yml`](.github/workflows/publish-addon.yml)
(triggered by pushing a `v0.x.y` tag). Then uncomment the
`image: ghcr.io/simmikolon/datacake-bridge-{arch}` line in
[`datacake-bridge/config.yaml`](datacake-bridge/config.yaml) and the
Supervisor will pull the ready-made image instead of building.

## License

MIT (choose whichever you prefer — no strings attached in this MVP).
