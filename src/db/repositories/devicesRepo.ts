import { getDb } from "../database";

export type DeviceRow = {
  id: string;
  verbose_name: string;
  product_slug: string;
  online: number;
  last_heard: string | null;
  selected: number;
  last_seen_inventory: number;
  raw_json: string;
};

export type DeviceRecord = {
  id: string;
  verboseName: string;
  productSlug: string;
  online: boolean;
  lastHeard: string | null;
  selected: boolean;
  lastSeenInventory: number;
};

function mapRow(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    verboseName: row.verbose_name,
    productSlug: row.product_slug,
    online: row.online === 1,
    lastHeard: row.last_heard,
    selected: row.selected === 1,
    lastSeenInventory: row.last_seen_inventory
  };
}

export function listDevices(): DeviceRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, verbose_name, product_slug, online, last_heard, selected, last_seen_inventory, raw_json
       FROM devices ORDER BY verbose_name ASC`
    )
    .all() as DeviceRow[];
  return rows.map(mapRow);
}

export function listSelectedDevices(): DeviceRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, verbose_name, product_slug, online, last_heard, selected, last_seen_inventory, raw_json
       FROM devices WHERE selected = 1 ORDER BY verbose_name ASC`
    )
    .all() as DeviceRow[];
  return rows.map(mapRow);
}

export function getDevice(id: string): DeviceRecord | null {
  const row = getDb()
    .prepare(
      `SELECT id, verbose_name, product_slug, online, last_heard, selected, last_seen_inventory, raw_json
       FROM devices WHERE id = ?`
    )
    .get(id) as DeviceRow | undefined;
  return row ? mapRow(row) : null;
}

export type UpsertDeviceInput = {
  id: string;
  verboseName: string;
  productSlug: string;
  online: boolean;
  lastHeard: string | null;
  raw: unknown;
};

export function upsertDevice(input: UpsertDeviceInput): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO devices (id, verbose_name, product_slug, online, last_heard, selected, last_seen_inventory, raw_json)
       VALUES (@id, @verboseName, @productSlug, @online, @lastHeard, 0, @now, @raw)
       ON CONFLICT(id) DO UPDATE SET
         verbose_name = excluded.verbose_name,
         product_slug = excluded.product_slug,
         online = excluded.online,
         last_heard = excluded.last_heard,
         last_seen_inventory = excluded.last_seen_inventory,
         raw_json = excluded.raw_json`
    )
    .run({
      id: input.id,
      verboseName: input.verboseName,
      productSlug: input.productSlug,
      online: input.online ? 1 : 0,
      lastHeard: input.lastHeard,
      now,
      raw: JSON.stringify(input.raw ?? {})
    });
}

export function setDeviceSelected(id: string, selected: boolean): void {
  getDb()
    .prepare("UPDATE devices SET selected = ? WHERE id = ?")
    .run(selected ? 1 : 0, id);
}

export function setDevicesSelection(selectedIds: string[]): void {
  const db = getDb();
  const tx = db.transaction((ids: string[]) => {
    db.prepare("UPDATE devices SET selected = 0").run();
    if (ids.length) {
      const stmt = db.prepare("UPDATE devices SET selected = 1 WHERE id = ?");
      for (const id of ids) stmt.run(id);
    }
  });
  tx(selectedIds);
}

export function deleteDevicesNotIn(ids: string[]): number {
  if (!ids.length) {
    const info = getDb().prepare("DELETE FROM devices").run();
    return info.changes;
  }
  const placeholders = ids.map(() => "?").join(",");
  const info = getDb()
    .prepare(`DELETE FROM devices WHERE id NOT IN (${placeholders})`)
    .run(...ids);
  return info.changes;
}
