// Helpers for deterministic HA identifiers and topic-safe strings.

export function normalizeFieldName(fieldName: string): string {
  return fieldName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildUniqueId(deviceId: string, fieldName: string): string {
  // Stability outweighs beauty; keep the full device id so collisions are
  // impossible even across workspaces that share short prefixes.
  const safeDevice = deviceId.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return `dtck_${safeDevice}_${normalizeFieldName(fieldName)}`;
}

export function shortDeviceId(deviceId: string): string {
  const firstSeg = deviceId.split("-")[0] ?? deviceId;
  return firstSeg.toLowerCase();
}

export function safeTopicSegment(value: string): string {
  // MQTT topic segments cannot contain '/', '+' or '#'; also strip control chars.
  return value.replace(/[\s#+/]+/g, "_").replace(/[^\x20-\x7E]+/g, "_");
}
