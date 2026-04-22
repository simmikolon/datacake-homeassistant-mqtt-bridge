import mqtt, { MqttClient } from "mqtt";
import { EventEmitter } from "events";
import { childLogger } from "../utils/logger";
import { MqttSettings } from "../config/schema";
import { parseDatacakeTopic, ParsedDatacakeTopic } from "./topics";
import { normalizePayload, NormalizedValue } from "../utils/payload";

const log = childLogger("mqtt.datacake");

export type DatacakeMessage = {
  topic: string;
  parsed: ParsedDatacakeTopic;
  value: NormalizedValue;
};

export type SubscriberStatus = {
  connected: boolean;
  lastError: string | null;
  lastEventAt: number | null;
  subscriptions: number;
};

export class MqttDatacakeSubscriber extends EventEmitter {
  private client: MqttClient | null = null;
  private currentTopics = new Set<string>();
  private status: SubscriberStatus = {
    connected: false,
    lastError: null,
    lastEventAt: null,
    subscriptions: 0
  };

  getStatus(): SubscriberStatus {
    return { ...this.status };
  }

  async connect(settings: MqttSettings): Promise<void> {
    await this.disconnect();
    // Reset transient state so a stale auth/TLS error from a previous set of
    // credentials doesn't keep haunting the /status page after a fix.
    this.status.lastError = null;
    this.status.connected = false;
    if (!settings.url) {
      log.warn("Skipping Datacake MQTT connect — URL not configured");
      return;
    }
    this.currentTopics.clear();

    const client = mqtt.connect(settings.url, {
      username: settings.username || undefined,
      password: settings.password || undefined,
      clientId: settings.clientId || `datacake-bridge-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5000,
      rejectUnauthorized: settings.rejectUnauthorized
    });

    this.client = client;

    client.on("connect", () => {
      this.status.connected = true;
      this.status.lastError = null;
      log.info({ url: redactUrl(settings.url) }, "Connected to Datacake MQTT");
      this.emit("connect");
    });

    client.on("reconnect", () => {
      log.info("Reconnecting to Datacake MQTT...");
    });

    client.on("close", () => {
      if (this.status.connected) {
        log.warn("Datacake MQTT connection closed");
      }
      this.status.connected = false;
      this.emit("close");
    });

    client.on("error", (err: Error) => {
      this.status.lastError = err.message;
      log.error({ err }, "Datacake MQTT error");
      this.emit("mqtt-error", err);
    });

    client.on("message", (topic: string, payload: Buffer) => {
      this.status.lastEventAt = Date.now();
      const parsed = parseDatacakeTopic(topic);
      if (!parsed) {
        log.debug({ topic }, "Ignoring unparsable Datacake topic");
        return;
      }
      const value = normalizePayload(payload);
      this.emit("message", { topic, parsed, value } as DatacakeMessage);
    });
  }

  async updateSubscriptions(topics: string[]): Promise<void> {
    if (!this.client || !this.client.connected) {
      // Nothing is actually subscribed while disconnected — leave both
      // `currentTopics` and `status.subscriptions` untouched so the /status
      // page never reports a subscription count that doesn't match reality.
      // The orchestrator re-invokes updateSubscriptions on every `connect`
      // event; at that point we diff against the (empty) currentTopics baseline
      // and no desired topics are silently skipped.
      return;
    }

    const desired = new Set(topics);
    const toAdd = [...desired].filter((t) => !this.currentTopics.has(t));
    const toRemove = [...this.currentTopics].filter((t) => !desired.has(t));

    if (toRemove.length) {
      await new Promise<void>((resolve) => {
        this.client!.unsubscribe(toRemove, (err) => {
          if (err) log.warn({ err, topics: toRemove }, "Failed to unsubscribe");
          resolve();
        });
      });
    }

    if (toAdd.length) {
      await new Promise<void>((resolve) => {
        this.client!.subscribe(toAdd, { qos: 0 }, (err, granted) => {
          if (err) log.warn({ err, topics: toAdd }, "Failed to subscribe");
          else log.info({ topics: granted?.map((g) => g.topic) }, "Subscribed to Datacake topics");
          resolve();
        });
      });
    }

    this.currentTopics = desired;
    this.status.subscriptions = desired.size;
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    this.currentTopics.clear();
    this.status.subscriptions = 0;
    await new Promise<void>((resolve) => {
      client.end(false, {}, () => resolve());
    });
    this.status.connected = false;
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return url;
  }
}
