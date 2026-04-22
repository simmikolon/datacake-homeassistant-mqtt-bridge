import { getDb } from "../database";
import type { AppSettings } from "../../config/schema";

export function loadSettings(): AppSettings | null {
  const row = getDb()
    .prepare("SELECT payload FROM settings WHERE id = 1")
    .get() as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as AppSettings;
  } catch {
    return null;
  }
}

export function saveSettings(settings: AppSettings): void {
  const payload = JSON.stringify(settings);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO settings (id, payload, updated_at)
       VALUES (1, @payload, @now)
       ON CONFLICT(id) DO UPDATE SET payload = @payload, updated_at = @now`
    )
    .run({ payload, now });
}
