// Lightweight .env loader so the app runs without the `dotenv` package.
// Imported as the very first side-effect module in `index.ts` so subsequent
// module-level `process.env` reads see the right values.

import * as fs from "fs";
import * as path from "path";

const envFile = path.join(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  try {
    const raw = fs.readFileSync(envFile, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // Best effort only.
  }
}

export {};
