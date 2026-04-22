import { EventEmitter } from "events";
import { loadSettings, saveSettings } from "../db/repositories/settingsRepo";
import { AppSettings, AppSettingsSchema, DEFAULT_SETTINGS, parsePartialSettings } from "./schema";
import { childLogger } from "../utils/logger";

const log = childLogger("config");

class ConfigService extends EventEmitter {
  private current: AppSettings = DEFAULT_SETTINGS;
  private loaded = false;

  load(): AppSettings {
    const stored = loadSettings();
    if (stored) {
      try {
        this.current = AppSettingsSchema.parse(stored);
      } catch (err) {
        log.error({ err }, "Stored settings failed validation, falling back to defaults");
        this.current = DEFAULT_SETTINGS;
      }
    } else {
      this.current = DEFAULT_SETTINGS;
    }
    this.loaded = true;
    return this.current;
  }

  get(): AppSettings {
    if (!this.loaded) this.load();
    return this.current;
  }

  isConfigured(): boolean {
    const s = this.get();
    return (
      Boolean(s.datacake.token) &&
      Boolean(s.datacake.workspaceId) &&
      Boolean(s.datacakeMqtt.url) &&
      Boolean(s.haMqtt.url)
    );
  }

  updateFromForm(raw: Record<string, unknown>): AppSettings {
    const base = this.get();
    const next = parsePartialSettings(base, raw);
    this.current = next;
    saveSettings(next);
    this.emit("change", next);
    return next;
  }

  replace(next: AppSettings): void {
    const parsed = AppSettingsSchema.parse(next);
    this.current = parsed;
    saveSettings(parsed);
    this.emit("change", parsed);
  }
}

export const configService = new ConfigService();
