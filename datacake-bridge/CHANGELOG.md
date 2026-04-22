# Changelog

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
