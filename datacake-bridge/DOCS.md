# Datacake Bridge — Documentation

## Architecture overview

```text
Datacake API ──GraphQL──▶ Inventory Service ──▶ SQLite
                                                  │
                                                  ▼
Datacake MQTT ──dtck/<slug>/<id>/+──▶ Runtime Registry ──▶ HA MQTT
                                         (mapping engine)    (discovery + state + availability)
```

All state lives in SQLite at `/data/bridge.db`. This survives add-on restarts, upgrades and re-installs (the Supervisor keeps the `/data` volume).

## Topic schema

| Direction | Topic | Retained |
|---|---|---|
| IN (from Datacake) | `dtck/<productSlug>/<deviceId>/<fieldName>` | — |
| OUT (HA discovery) | `<prefix>/<component>/<uniqueId>/config` | ✅ |
| OUT (HA state) | `datacake/state/<deviceId>/<fieldName>` | ✅ |
| OUT (HA availability) | `datacake/availability/<deviceId>` | ✅ |
| IN (HA lifecycle) | `<prefix>/status` → triggers re-announce | — |

The bridge never forwards Datacake topics 1:1 to Home Assistant. Every incoming message is parsed, resolved against the runtime registry, normalised (`"true"`/`"false"` → boolean, numeric strings → number, JSON `.value` unwrap, rest as string) and re-published on its own HA-friendly topic.

## Mapping priority

`semantic` → `fieldType` → `fieldName` pattern.

| Semantic | HA component | Exported by default? |
|---|---|---|
| `TEMPERATURE`, `HUMIDITY`, `CO2`, `POWER`, `ENERGY`, `VOLTAGE`, `CURRENT`, `PRESSURE`, `ILLUMINANCE`, `SOIL_MOISTURE`, `MOISTURE` | `sensor` | ✅ |
| `BATTERY`, `BATTERY_VOLTAGE`, `RSSI`, `SIGNAL`, `SNR` | `sensor` (diagnostic) | Battery: ✅ · RSSI/SNR: opt-in |
| `CONTACT`, `MOTION`, `OCCUPANCY`, `DOOR_OPENED` | `binary_sensor` | ✅ |
| `LOCATION` / `USER_LOG` / GEO fieldType | stored but never exported as entity | ❌ |
| `BOOL` fallback | `binary_sensor` | ✅ |
| `NUMERIC` fallback | `sensor` | ✅ |
| `STRING` fallback | `sensor` | ❌ (opt-in per field) |

Per-field override JSON lets you tweak `name`, `icon`, `device_class`, `unit_of_measurement`, `state_class`, `entity_category`, `payload_on`/`payload_off`, `object_id`, `value_template`, `expire_after`, `force_update`, `suggested_display_precision`, `enabled_by_default`. Topic / availability / device keys are managed by the bridge and will be silently dropped if included in the override.

## Entity cleanup

The bridge tracks every retained discovery / state / availability topic it has ever published in SQLite. When a field is disabled, removed from the Datacake inventory, or its device is deselected, the bridge publishes an empty retained payload on the stored topic so Home Assistant removes the entity instead of leaving a ghost.

## Troubleshooting

**Entities don't appear.**
Check the **Status** page — both MQTT indicators must be green. Verify that the discovery prefix matches the Home Assistant MQTT integration setting (default `homeassistant`). Click **Re-publish discovery** if HA was set up after the bridge.

**Values never update.**
Open *Devices*, ensure the device is ticked, open it, ensure the field has *Export* enabled. Watch the *Logs* page for `Received message for unknown field` or `Field not exported` lines.

**Supervisor-prefilled HA MQTT credentials are wrong.**
Open *Settings*, tick *Clear stored password* under HA MQTT, save. Then re-enter your own credentials, or re-run with a stopped Mosquitto add-on (the bridge only bootstraps the first time `haMqtt.url` is empty).

**Datacake MQTT TLS error.**
If your Datacake MQTT endpoint uses a certificate you don't trust, uncheck *Verify TLS certificate* on the *Settings* page.

## Upgrades

Add-on upgrades replace the container and its code but keep `/data/bridge.db`. Your Datacake credentials, device selection, field toggles and per-entity state all survive. If the schema evolved, the bridge runs idempotent migrations on boot.
