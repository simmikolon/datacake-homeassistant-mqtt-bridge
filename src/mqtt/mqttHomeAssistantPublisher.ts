import mqtt, { MqttClient } from "mqtt";
import { EventEmitter } from "events";
import { childLogger } from "../utils/logger";
import { MqttSettings } from "../config/schema";
import { buildHaStatusTopic } from "./topics";

const log = childLogger("mqtt.ha");

export type PublisherStatus = {
  connected: boolean;
  lastError: string | null;
  lastPublishAt: number | null;
};

export class MqttHomeAssistantPublisher extends EventEmitter {
  private client: MqttClient | null = null;
  private status: PublisherStatus = {
    connected: false,
    lastError: null,
    lastPublishAt: null
  };
  private subscribedStatusTopic: string | null = null;

  getStatus(): PublisherStatus {
    return { ...this.status };
  }

  async connect(settings: MqttSettings, discoveryPrefix: string): Promise<void> {
    await this.disconnect();
    // Reset transient state so the /status page doesn't keep showing a stale
    // error from a previous (now-abandoned) set of credentials.
    this.status.lastError = null;
    this.status.connected = false;
    if (!settings.url) {
      log.warn("Skipping HA MQTT connect — URL not configured");
      return;
    }

    const client = mqtt.connect(settings.url, {
      username: settings.username || undefined,
      password: settings.password || undefined,
      clientId: settings.clientId || `datacake-bridge-ha-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5000,
      rejectUnauthorized: settings.rejectUnauthorized
    });

    this.client = client;

    client.on("connect", () => {
      this.status.connected = true;
      this.status.lastError = null;
      log.info({ url: redactUrl(settings.url) }, "Connected to Home Assistant MQTT");
      this.subscribeStatusTopic(discoveryPrefix);
      this.emit("connect");
    });

    client.on("reconnect", () => {
      log.info("Reconnecting to HA MQTT...");
    });

    client.on("close", () => {
      if (this.status.connected) {
        log.warn("HA MQTT connection closed");
      }
      this.status.connected = false;
      this.emit("close");
    });

    client.on("error", (err: Error) => {
      this.status.lastError = err.message;
      log.error({ err }, "HA MQTT error");
      this.emit("mqtt-error", err);
    });

    client.on("message", (topic: string, payload: Buffer) => {
      if (topic === this.subscribedStatusTopic) {
        const text = payload.toString("utf8").trim().toLowerCase();
        log.info({ topic, text }, "Home Assistant status message received");
        if (text === "online") this.emit("ha-online");
      }
    });
  }

  private subscribeStatusTopic(discoveryPrefix: string): void {
    if (!this.client) return;
    const topic = buildHaStatusTopic(discoveryPrefix);
    this.subscribedStatusTopic = topic;
    this.client.subscribe(topic, { qos: 0 }, (err) => {
      if (err) {
        log.warn({ err, topic }, "Failed to subscribe to HA status topic");
      } else {
        log.debug({ topic }, "Listening for HA online announcements");
      }
    });
  }

  // Publishes a JSON payload as a retained message. Designed for discovery
  // configs, but also works for general structured retained data.
  async publishRetained(topic: string, payload: object | string): Promise<void> {
    await this.publish(topic, payload, { retain: true, qos: 0 });
  }

  async publish(
    topic: string,
    payload: object | string,
    options: { retain?: boolean; qos?: 0 | 1 | 2 } = {}
  ): Promise<void> {
    if (!this.client || !this.client.connected) {
      throw new Error("HA MQTT publisher is not connected");
    }
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    await new Promise<void>((resolve, reject) => {
      this.client!.publish(
        topic,
        body,
        { retain: options.retain ?? false, qos: options.qos ?? 0 },
        (err) => {
          if (err) return reject(err);
          this.status.lastPublishAt = Date.now();
          resolve();
        }
      );
    });
  }

  // Clears a retained message by publishing an empty retained payload. Used
  // when disabling or removing a previously-exported entity.
  async clearRetained(topic: string): Promise<void> {
    if (!this.client || !this.client.connected) return;
    await new Promise<void>((resolve) => {
      this.client!.publish(topic, "", { retain: true, qos: 0 }, () => resolve());
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    this.subscribedStatusTopic = null;
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
