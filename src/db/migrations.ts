import type { Database } from "better-sqlite3";
import { childLogger } from "../utils/logger";

const log = childLogger("db.migrations");

type Migration = {
  id: number;
  name: string;
  up: (db: Database) => void;
};

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          verbose_name TEXT NOT NULL,
          product_slug TEXT NOT NULL,
          online INTEGER NOT NULL DEFAULT 0,
          last_heard TEXT,
          selected INTEGER NOT NULL DEFAULT 0,
          last_seen_inventory INTEGER NOT NULL,
          raw_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fields (
          device_id TEXT NOT NULL,
          field_name TEXT NOT NULL,
          field_type TEXT NOT NULL,
          semantic TEXT,
          enabled INTEGER NOT NULL DEFAULT 0,
          diagnostic INTEGER NOT NULL DEFAULT 0,
          override_json TEXT,
          unique_id TEXT,
          discovery_hash TEXT,
          last_value TEXT,
          last_value_at INTEGER,
          last_availability TEXT,
          last_availability_at INTEGER,
          PRIMARY KEY (device_id, field_name),
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_fields_device ON fields(device_id);
        CREATE INDEX IF NOT EXISTS idx_fields_enabled ON fields(enabled);
      `);
    }
  },
  {
    id: 2,
    name: "mapping_and_cleanup",
    up: (db) => {
      // Persist the resolved mapping alongside the raw field definition so the
      // UI can render quickly, the orchestrator can cheaply diff state, and
      // the mapping decision itself stays auditable after the rule set
      // evolves.
      db.exec(`
        ALTER TABLE fields ADD COLUMN mapped_component TEXT;
        ALTER TABLE fields ADD COLUMN mapped_device_class TEXT;
        ALTER TABLE fields ADD COLUMN mapped_unit TEXT;
        ALTER TABLE fields ADD COLUMN mapped_state_class TEXT;
        ALTER TABLE fields ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
      `);

      // Track exactly which discovery topics / availability topics we have
      // already published (retained) so we can clear them with an empty
      // retained payload the moment a field is disabled, removed from the
      // remote inventory, or its device is de-selected/deleted. Without this
      // table stale entities linger in Home Assistant forever.
      db.exec(`
        CREATE TABLE IF NOT EXISTS published_discoveries (
          unique_id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          field_name TEXT NOT NULL,
          component TEXT NOT NULL,
          discovery_topic TEXT NOT NULL,
          state_topic TEXT NOT NULL,
          hash TEXT,
          last_published_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_pub_disc_device
          ON published_discoveries(device_id);

        CREATE TABLE IF NOT EXISTS published_availabilities (
          device_id TEXT PRIMARY KEY,
          availability_topic TEXT NOT NULL,
          last_payload TEXT,
          last_published_at INTEGER
        );
      `);
    }
  }
];

export function applyMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row: any) => row.id as number)
  );

  const insert = db.prepare(
    "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
  );

  const runTx = db.transaction((migration: Migration) => {
    migration.up(db);
    insert.run(migration.id, migration.name, Date.now());
  });

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    log.info({ id: migration.id, name: migration.name }, "Applying migration");
    runTx(migration);
  }
}
