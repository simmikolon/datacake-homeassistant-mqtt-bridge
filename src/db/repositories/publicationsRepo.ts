import { getDb } from "../database";

// Tracks retained MQTT topics the bridge has actually published to HA. Used by
// the cleanup pass in the orchestrator to delete "tombstoned" entities with an
// empty retained payload when a field is disabled, removed, or its device is
// de-selected/deleted.

export type PublishedDiscoveryRow = {
  unique_id: string;
  device_id: string;
  field_name: string;
  component: string;
  discovery_topic: string;
  state_topic: string;
  hash: string | null;
  last_published_at: number | null;
};

export type PublishedDiscovery = {
  uniqueId: string;
  deviceId: string;
  fieldName: string;
  component: string;
  discoveryTopic: string;
  stateTopic: string;
  hash: string | null;
  lastPublishedAt: number | null;
};

function mapRow(row: PublishedDiscoveryRow): PublishedDiscovery {
  return {
    uniqueId: row.unique_id,
    deviceId: row.device_id,
    fieldName: row.field_name,
    component: row.component,
    discoveryTopic: row.discovery_topic,
    stateTopic: row.state_topic,
    hash: row.hash,
    lastPublishedAt: row.last_published_at
  };
}

export function listPublishedDiscoveries(): PublishedDiscovery[] {
  return (getDb()
    .prepare("SELECT * FROM published_discoveries")
    .all() as PublishedDiscoveryRow[]).map(mapRow);
}

export function upsertPublishedDiscovery(entry: {
  uniqueId: string;
  deviceId: string;
  fieldName: string;
  component: string;
  discoveryTopic: string;
  stateTopic: string;
  hash: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO published_discoveries
         (unique_id, device_id, field_name, component, discovery_topic, state_topic, hash, last_published_at)
       VALUES (@uniqueId, @deviceId, @fieldName, @component, @discoveryTopic, @stateTopic, @hash, @now)
       ON CONFLICT(unique_id) DO UPDATE SET
         device_id = excluded.device_id,
         field_name = excluded.field_name,
         component = excluded.component,
         discovery_topic = excluded.discovery_topic,
         state_topic = excluded.state_topic,
         hash = excluded.hash,
         last_published_at = excluded.last_published_at`
    )
    .run({ ...entry, now: Date.now() });
}

export function deletePublishedDiscovery(uniqueId: string): void {
  getDb()
    .prepare("DELETE FROM published_discoveries WHERE unique_id = ?")
    .run(uniqueId);
}

export type PublishedAvailabilityRow = {
  device_id: string;
  availability_topic: string;
  last_payload: string | null;
  last_published_at: number | null;
};

export type PublishedAvailability = {
  deviceId: string;
  availabilityTopic: string;
  lastPayload: string | null;
  lastPublishedAt: number | null;
};

function mapAvailabilityRow(row: PublishedAvailabilityRow): PublishedAvailability {
  return {
    deviceId: row.device_id,
    availabilityTopic: row.availability_topic,
    lastPayload: row.last_payload,
    lastPublishedAt: row.last_published_at
  };
}

export function listPublishedAvailabilities(): PublishedAvailability[] {
  return (getDb()
    .prepare("SELECT * FROM published_availabilities")
    .all() as PublishedAvailabilityRow[]).map(mapAvailabilityRow);
}

export function upsertPublishedAvailability(entry: {
  deviceId: string;
  availabilityTopic: string;
  payload: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO published_availabilities
         (device_id, availability_topic, last_payload, last_published_at)
       VALUES (@deviceId, @availabilityTopic, @payload, @now)
       ON CONFLICT(device_id) DO UPDATE SET
         availability_topic = excluded.availability_topic,
         last_payload = excluded.last_payload,
         last_published_at = excluded.last_published_at`
    )
    .run({ ...entry, now: Date.now() });
}

export function deletePublishedAvailability(deviceId: string): void {
  getDb()
    .prepare("DELETE FROM published_availabilities WHERE device_id = ?")
    .run(deviceId);
}
