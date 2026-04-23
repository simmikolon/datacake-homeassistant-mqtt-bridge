# Changelog

## 0.1.2

- Fix: Docker layer cache could reuse a stale `git clone` from the previous
  version, defeating the 0.1.1 schema fix. The Dockerfile's clone step now
  references `BUILD_VERSION` so every version bump guarantees a fresh clone.

## 0.1.1

- Fix: Supervisor bootstrap no longer crashes on first boot when Datacake
  credentials are still empty. Schema now permits empty intermediate values;
  `configService.isConfigured()` remains the runtime gate for actually
  starting the MQTT pipelines.

## 0.1.0

Initial release as a Home Assistant add-on.

- GraphQL inventory with full pagination
- Datacake Realtime MQTT subscription per selected device
- Automatic mapping from `semantic` / `fieldType` / `fieldName` to HA sensors and binary sensors
- Retained discovery, state and availability publishing
- Automatic entity cleanup when fields/devices are disabled or removed
- Home Assistant `<prefix>/status` re-announce hook
- Home Assistant Ingress (authenticated UI inside Supervisor)
- Auto-discovery of the HA Mosquitto add-on on first boot
- Persistent `/data/bridge.db` (SQLite) for all configuration and runtime state
