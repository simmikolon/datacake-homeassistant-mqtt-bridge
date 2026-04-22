# Datacake → Home Assistant Bridge

Self-hosted add-on that mirrors devices from a [Datacake](https://datacake.co) workspace into Home Assistant via MQTT Discovery.

## What it does

- Loads all devices from your Datacake workspace over GraphQL (with proper pagination).
- Subscribes to the Datacake Realtime MQTT broker per selected device (`dtck/<slug>/<id>/+`).
- Maps each Datacake field to a proper HA sensor / binary sensor with `device_class`, `unit_of_measurement`, `state_class`, …
- Publishes retained discovery, state and availability topics on your Home Assistant MQTT broker.
- Cleans up HA entities automatically when you disable fields or deselect devices.
- Re-announces discovery when Home Assistant comes online.

## Setup

1. **Install** the add-on from the repository.
2. **Start** it once — the Supervisor auto-discovers the Mosquitto add-on if you have one and pre-fills the HA MQTT section.
3. **Open Web UI** via the add-on card.
4. **Settings → Datacake API**: paste your Datacake API token and workspace ID.
5. **Settings → Datacake MQTT**: broker URL + credentials for Datacake Realtime MQTT.
6. Click **Test Datacake API** and **Test Datacake MQTT** — both must succeed.
7. **Devices** → **Sync inventory** → tick the devices you want, save.
8. Open Home Assistant → Settings → Devices & Services. Your Datacake devices appear under the MQTT integration.

## Configuration

The add-on stores all connection secrets in `/data/bridge.db` (SQLite, persistent volume). The two Supervisor options affect runtime behaviour only:

| Option | Default | Description |
|---|---|---|
| `log_level` | `info` | `trace` / `debug` / `info` / `warn` / `error` |
| `log_buffer_size` | `500` | Max in-memory log lines shown on the *Logs* page |

See the [documentation tab](./DOCS.md) for details.
