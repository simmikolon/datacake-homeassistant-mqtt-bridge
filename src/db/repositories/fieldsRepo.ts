import { getDb } from "../database";

export type FieldRow = {
  device_id: string;
  field_name: string;
  field_type: string;
  semantic: string | null;
  enabled: number;
  diagnostic: number;
  override_json: string | null;
  unique_id: string | null;
  discovery_hash: string | null;
  last_value: string | null;
  last_value_at: number | null;
  last_availability: string | null;
  last_availability_at: number | null;
  mapped_component: string | null;
  mapped_device_class: string | null;
  mapped_unit: string | null;
  mapped_state_class: string | null;
  ignored: number;
};

export type FieldRecord = {
  deviceId: string;
  fieldName: string;
  fieldType: string;
  semantic: string | null;
  enabled: boolean;
  diagnostic: boolean;
  overrideJson: string | null;
  uniqueId: string | null;
  discoveryHash: string | null;
  lastValue: string | null;
  lastValueAt: number | null;
  lastAvailability: string | null;
  lastAvailabilityAt: number | null;
  mappedComponent: string | null;
  mappedDeviceClass: string | null;
  mappedUnit: string | null;
  mappedStateClass: string | null;
  ignored: boolean;
};

function mapRow(row: FieldRow): FieldRecord {
  return {
    deviceId: row.device_id,
    fieldName: row.field_name,
    fieldType: row.field_type,
    semantic: row.semantic,
    enabled: row.enabled === 1,
    diagnostic: row.diagnostic === 1,
    overrideJson: row.override_json,
    uniqueId: row.unique_id,
    discoveryHash: row.discovery_hash,
    lastValue: row.last_value,
    lastValueAt: row.last_value_at,
    lastAvailability: row.last_availability,
    lastAvailabilityAt: row.last_availability_at,
    mappedComponent: row.mapped_component,
    mappedDeviceClass: row.mapped_device_class,
    mappedUnit: row.mapped_unit,
    mappedStateClass: row.mapped_state_class,
    ignored: row.ignored === 1
  };
}

export function listFields(deviceId: string): FieldRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM fields WHERE device_id = ? ORDER BY field_name")
    .all(deviceId) as FieldRow[];
  return rows.map(mapRow);
}

export function listAllFields(): FieldRecord[] {
  const rows = getDb().prepare("SELECT * FROM fields").all() as FieldRow[];
  return rows.map(mapRow);
}

export function getField(deviceId: string, fieldName: string): FieldRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM fields WHERE device_id = ? AND field_name = ?")
    .get(deviceId, fieldName) as FieldRow | undefined;
  return row ? mapRow(row) : null;
}

export type UpsertFieldInput = {
  deviceId: string;
  fieldName: string;
  fieldType: string;
  semantic: string | null;
  defaultEnabled: boolean;
  defaultDiagnostic: boolean;
};

// Inserts a new row using the supplied defaults; keeps user toggles intact on update.
export function upsertFieldDefinition(input: UpsertFieldInput): void {
  getDb()
    .prepare(
      `INSERT INTO fields (device_id, field_name, field_type, semantic, enabled, diagnostic)
       VALUES (@deviceId, @fieldName, @fieldType, @semantic, @enabled, @diagnostic)
       ON CONFLICT(device_id, field_name) DO UPDATE SET
         field_type = excluded.field_type,
         semantic = excluded.semantic`
    )
    .run({
      deviceId: input.deviceId,
      fieldName: input.fieldName,
      fieldType: input.fieldType,
      semantic: input.semantic,
      enabled: input.defaultEnabled ? 1 : 0,
      diagnostic: input.defaultDiagnostic ? 1 : 0
    });
}

export function deleteFieldsNotIn(deviceId: string, names: string[]): number {
  if (!names.length) {
    return getDb().prepare("DELETE FROM fields WHERE device_id = ?").run(deviceId).changes;
  }
  const placeholders = names.map(() => "?").join(",");
  const info = getDb()
    .prepare(
      `DELETE FROM fields WHERE device_id = ? AND field_name NOT IN (${placeholders})`
    )
    .run(deviceId, ...names);
  return info.changes;
}

export function setFieldToggles(
  deviceId: string,
  fieldName: string,
  enabled: boolean,
  diagnostic: boolean
): void {
  getDb()
    .prepare(
      `UPDATE fields SET enabled = ?, diagnostic = ? WHERE device_id = ? AND field_name = ?`
    )
    .run(enabled ? 1 : 0, diagnostic ? 1 : 0, deviceId, fieldName);
}

export function setFieldOverride(
  deviceId: string,
  fieldName: string,
  overrideJson: string | null
): void {
  getDb()
    .prepare("UPDATE fields SET override_json = ? WHERE device_id = ? AND field_name = ?")
    .run(overrideJson, deviceId, fieldName);
}

export type MappingColumns = {
  component: string | null;
  deviceClass: string | null;
  unit: string | null;
  stateClass: string | null;
  ignored: boolean;
};

export function updateMappedColumns(
  deviceId: string,
  fieldName: string,
  mapping: MappingColumns
): void {
  getDb()
    .prepare(
      `UPDATE fields SET
         mapped_component = @component,
         mapped_device_class = @deviceClass,
         mapped_unit = @unit,
         mapped_state_class = @stateClass,
         ignored = @ignored
       WHERE device_id = @deviceId AND field_name = @fieldName`
    )
    .run({
      deviceId,
      fieldName,
      component: mapping.component,
      deviceClass: mapping.deviceClass,
      unit: mapping.unit,
      stateClass: mapping.stateClass,
      ignored: mapping.ignored ? 1 : 0
    });
}

export function updateDiscoveryMeta(
  deviceId: string,
  fieldName: string,
  uniqueId: string,
  discoveryHash: string
): void {
  getDb()
    .prepare(
      `UPDATE fields SET unique_id = ?, discovery_hash = ? WHERE device_id = ? AND field_name = ?`
    )
    .run(uniqueId, discoveryHash, deviceId, fieldName);
}

export function updateLastValue(
  deviceId: string,
  fieldName: string,
  value: string
): void {
  getDb()
    .prepare(
      `UPDATE fields SET last_value = ?, last_value_at = ? WHERE device_id = ? AND field_name = ?`
    )
    .run(value, Date.now(), deviceId, fieldName);
}

export function updateLastAvailability(
  deviceId: string,
  fieldName: string,
  availability: string
): void {
  getDb()
    .prepare(
      `UPDATE fields SET last_availability = ?, last_availability_at = ? WHERE device_id = ? AND field_name = ?`
    )
    .run(availability, Date.now(), deviceId, fieldName);
}

export function countEnabledFields(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as c FROM fields WHERE enabled = 1")
    .get() as { c: number };
  return row.c;
}
