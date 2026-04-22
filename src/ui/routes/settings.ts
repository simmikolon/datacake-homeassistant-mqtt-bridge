import type { Express, Response } from "express";
import mqtt from "mqtt";
import { configService } from "../../config/configService";
import { AppSettings } from "../../config/schema";
import { pingWorkspace } from "../../datacake/datacakeApi";
import { childLogger } from "../../utils/logger";

const log = childLogger("ui.settings");

function renderSettings(
  res: Response,
  settings: AppSettings,
  flash?: { type: "success" | "error" | "info"; message: string } | null
) {
  res.renderPage("settings", {
    title: "Settings",
    nav: "settings",
    settings,
    flash: flash ?? null
  });
}

// All three Test buttons persist the freshly submitted form values BEFORE
// running the connectivity check. Reason: the password input (type=password)
// is never rendered back with a `value` attribute, so after a Test-only
// submit the user would see an empty password field; a subsequent Save would
// send an empty password and `parsePartialSettings` would silently keep the
// old (wrong) credential. By persisting on Test we guarantee that whatever
// just passed the test is also what the orchestrator uses.
function persistFromForm(
  res: Response,
  rawBody: Record<string, unknown>
): AppSettings | null {
  try {
    return configService.updateFromForm(rawBody);
  } catch (err) {
    log.warn({ err }, "Invalid settings submission");
    renderSettings(res, configService.get(), {
      type: "error",
      message: (err as Error).message
    });
    return null;
  }
}

export function registerSettingsRoutes(app: Express): void {
  app.get("/settings", (_req, res) => {
    renderSettings(res, configService.get());
  });

  app.post("/settings", (req, res) => {
    const next = persistFromForm(res, req.body ?? {});
    if (!next) return;
    renderSettings(res, next, { type: "success", message: "Settings saved." });
  });

  app.post("/settings/test-graphql", async (req, res) => {
    const next = persistFromForm(res, req.body ?? {});
    if (!next) return;
    try {
      const result = await pingWorkspace({
        endpoint: next.datacake.endpoint,
        token: next.datacake.token,
        workspaceId: next.datacake.workspaceId
      });
      renderSettings(res, next, {
        type: "success",
        message: `Settings saved — Datacake API reachable (${result.total} devices in workspace).`
      });
    } catch (err) {
      renderSettings(res, next, {
        type: "error",
        message: `Settings saved, but Datacake API test failed: ${(err as Error).message}`
      });
    }
  });

  app.post("/settings/test-mqtt-datacake", async (req, res) => {
    const next = persistFromForm(res, req.body ?? {});
    if (!next) return;
    await testMqtt(res, next, "datacakeMqtt");
  });

  app.post("/settings/test-mqtt-ha", async (req, res) => {
    const next = persistFromForm(res, req.body ?? {});
    if (!next) return;
    await testMqtt(res, next, "haMqtt");
  });
}

async function testMqtt(
  res: Response,
  settings: AppSettings,
  which: "datacakeMqtt" | "haMqtt"
): Promise<void> {
  const label = which === "datacakeMqtt" ? "Datacake" : "HA";
  const mq = settings[which];
  if (!mq.url) {
    renderSettings(res, settings, {
      type: "error",
      message: `Settings saved, but ${label} MQTT URL is not set.`
    });
    return;
  }

  const result = await probeMqtt(mq.url, {
    username: mq.username || undefined,
    password: mq.password || undefined,
    clientId: (mq.clientId || "datacake-bridge-probe-") + Math.random().toString(16).slice(2, 8),
    rejectUnauthorized: mq.rejectUnauthorized
  });

  if (result.ok) {
    renderSettings(res, settings, {
      type: "success",
      message: `Settings saved — ${label} MQTT broker is reachable.`
    });
  } else {
    renderSettings(res, settings, {
      type: "error",
      message: `Settings saved, but ${label} MQTT test failed: ${result.error}`
    });
  }
}

function probeMqtt(
  url: string,
  options: {
    username?: string;
    password?: string;
    clientId: string;
    rejectUnauthorized: boolean;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const client = mqtt.connect(url, {
      ...options,
      reconnectPeriod: 0,
      connectTimeout: 8000
    });

    const done = (result: { ok: true } | { ok: false; error: string }) => {
      client.end(true);
      resolve(result);
    };

    client.once("connect", () => done({ ok: true }));
    client.once("error", (err: Error) => done({ ok: false, error: err.message }));
    setTimeout(() => done({ ok: false, error: "timeout" }), 9000);
  });
}
