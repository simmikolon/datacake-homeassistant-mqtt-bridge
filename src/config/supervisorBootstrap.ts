import { childLogger } from "../utils/logger";
import { configService } from "./configService";

const log = childLogger("config.supervisor");

type SupervisorMqttServiceResponse = {
  result?: "ok" | "error";
  data?: {
    addon?: string;
    host?: string;
    port?: number;
    ssl?: boolean;
    protocol?: string;
    username?: string;
    password?: string;
  };
  message?: string;
};

// Returns true when this process was started by the Home Assistant Supervisor
// (i.e. as an add-on). The Supervisor injects a token env var; without it the
// internal Supervisor API is not reachable and we must skip bootstrapping.
export function isRunningAsAddon(): boolean {
  return Boolean(process.env.SUPERVISOR_TOKEN);
}

// Queries the Supervisor's services/mqtt endpoint for the currently running
// MQTT broker (typically the Mosquitto add-on). Returns null on any failure so
// the caller can silently fall back to operator-supplied configuration.
async function fetchSupervisorMqtt(
  token: string
): Promise<SupervisorMqttServiceResponse["data"] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch("http://supervisor/services/mqtt", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "Supervisor MQTT service lookup returned non-200");
      return null;
    }
    const body = (await res.json()) as SupervisorMqttServiceResponse;
    if (body.result !== "ok" || !body.data?.host) {
      log.warn({ body }, "Supervisor MQTT service lookup returned no broker details");
      return null;
    }
    return body.data;
  } catch (err) {
    log.warn({ err }, "Supervisor MQTT service lookup failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// On first boot of the add-on we enrich the persisted configuration with the
// HA Mosquitto broker details so the operator only has to supply Datacake
// credentials. Subsequent boots leave the (now operator-owned) values alone.
export async function bootstrapFromSupervisorIfNeeded(): Promise<void> {
  if (!isRunningAsAddon()) return;

  const current = configService.get();
  if (current.haMqtt.url) {
    log.debug("HA MQTT already configured — skipping Supervisor bootstrap");
    return;
  }

  const data = await fetchSupervisorMqtt(process.env.SUPERVISOR_TOKEN as string);
  if (!data || !data.host) return;

  const scheme = data.ssl ? "mqtts" : "mqtt";
  const port = data.port ?? (data.ssl ? 8883 : 1883);
  const url = `${scheme}://${data.host}:${port}`;

  configService.replace({
    ...current,
    haMqtt: {
      ...current.haMqtt,
      url,
      username: data.username ?? "",
      password: data.password ?? "",
      clientId: current.haMqtt.clientId || "datacake-ha-bridge",
      // Local add-on broker is always trusted; `rejectUnauthorized` is moot
      // over plain MQTT but we keep the default here for symmetry.
      rejectUnauthorized: current.haMqtt.rejectUnauthorized
    }
  });

  log.info(
    { host: data.host, port, ssl: Boolean(data.ssl), username: data.username ?? null },
    "Bootstrapped HA MQTT settings from Supervisor services/mqtt"
  );
}
