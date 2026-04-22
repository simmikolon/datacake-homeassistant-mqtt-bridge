import { childLogger } from "../utils/logger";
import { Mutex } from "../utils/mutex";
import { configService } from "../config/configService";
import { syncInventory } from "../datacake/inventoryService";
import { MqttDatacakeSubscriber, DatacakeMessage } from "../mqtt/mqttDatacakeSubscriber";
import { MqttHomeAssistantPublisher } from "../mqtt/mqttHomeAssistantPublisher";
import { buildDatacakeSubscriptionTopic } from "../mqtt/topics";
import { runtimeRegistry, DeviceRuntime, FieldRuntime } from "./runtimeRegistry";
import {
  updateDiscoveryMeta,
  updateLastAvailability,
  updateLastValue
} from "../db/repositories/fieldsRepo";
import {
  deletePublishedAvailability,
  deletePublishedDiscovery,
  listPublishedAvailabilities,
  listPublishedDiscoveries,
  upsertPublishedAvailability,
  upsertPublishedDiscovery
} from "../db/repositories/publicationsRepo";
import { serializeForHa } from "../utils/payload";

const log = childLogger("orchestrator");

export type OrchestratorStatus = {
  running: boolean;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  datacakeMqtt: ReturnType<MqttDatacakeSubscriber["getStatus"]>;
  haMqtt: ReturnType<MqttHomeAssistantPublisher["getStatus"]>;
  devices: number;
  selectedDevices: number;
  exportedEntities: number;
};

export class BridgeOrchestrator {
  private datacake = new MqttDatacakeSubscriber();
  private ha = new MqttHomeAssistantPublisher();
  // Single mutex that serialises EVERY state-changing operation: inventory
  // sync, registry rebuild, MQTT connect/disconnect, subscription diffing,
  // discovery publishing and entity cleanup. This prevents races such as
  // double subscriptions or two rebuilds racing to clear the same retained
  // topic.
  private mutex = new Mutex();
  private running = false;
  private lastSyncAt: number | null = null;
  private lastSyncError: string | null = null;

  constructor() {
    this.datacake.on("message", (msg: DatacakeMessage) => {
      this.handleDatacakeMessage(msg).catch((err) =>
        log.error({ err }, "Failed to process Datacake message")
      );
    });
    this.datacake.on("connect", () => {
      this.mutex.run(() => this.syncSubscriptions()).catch((err) =>
        log.error({ err }, "Failed to sync subscriptions after Datacake connect")
      );
    });
    this.ha.on("connect", () => {
      // Both the boot path and every reconfigure rely on this listener to do
      // the actual publish work: `ha.connect()` returns before the underlying
      // MQTT client is actually connected, so the cleanup+publish call inside
      // `runFullCycleLocked`/`reconfigure`/`applySelectionChange` is typically
      // a no-op. We run cleanup here as well so stale retained entities get
      // tombstoned at boot, not only on the next UI-triggered reconfigure.
      this.mutex
        .run(async () => {
          await this.cleanupStaleEntities();
          await this.publishAllAvailabilityAndDiscovery();
        })
        .catch((err) => log.error({ err }, "Failed to publish after HA connect"));
    });
    this.ha.on("ha-online", () => {
      log.info("HA announced online — re-publishing discovery");
      this.mutex
        .run(async () => {
          runtimeRegistry.markAllDiscoveryUnpublished();
          await this.cleanupStaleEntities();
          await this.publishAllAvailabilityAndDiscovery();
        })
        .catch((err) => log.error({ err }, "Failed to re-announce discovery"));
    });

    configService.on("change", () => {
      this.reconfigure().catch((err) =>
        log.error({ err }, "Reconfigure after settings change failed")
      );
    });
  }

  getStatus(): OrchestratorStatus {
    const devices = runtimeRegistry.listAllDevices();
    return {
      running: this.running,
      lastSyncAt: this.lastSyncAt,
      lastSyncError: this.lastSyncError,
      datacakeMqtt: this.datacake.getStatus(),
      haMqtt: this.ha.getStatus(),
      devices: devices.length,
      selectedDevices: devices.filter((d) => d.selected).length,
      exportedEntities: runtimeRegistry.countExportedFields()
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    log.info("Bridge starting");

    if (!configService.isConfigured()) {
      log.warn("Configuration incomplete — UI is available but bridge will idle");
      await this.mutex.run(async () => {
        runtimeRegistry.rebuild(configService.get().discoveryPrefix);
      });
      return;
    }

    await this.mutex.run(() => this.runFullCycleLocked());
  }

  async stop(): Promise<void> {
    this.running = false;
    log.info("Bridge stopping");
    await this.mutex.run(async () => {
      await Promise.allSettled([this.datacake.disconnect(), this.ha.disconnect()]);
    });
  }

  async triggerResync(): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.mutex.run(async () => {
      try {
        await this.runInventorySyncLocked();
        const settings = configService.get();
        runtimeRegistry.rebuild(settings.discoveryPrefix);
        await this.cleanupStaleEntities();
        await this.publishAllAvailabilityAndDiscovery();
        await this.syncSubscriptions();
        return { ok: true };
      } catch (err) {
        this.lastSyncError = (err as Error).message;
        log.error({ err }, "Manual resync failed");
        return { ok: false, error: (err as Error).message };
      }
    });
  }

  // Full boot cycle: settings → inventory → registry → MQTT connect → publish
  // discovery & availability → subscribe to Datacake topics. Always executed
  // under the orchestrator mutex.
  private async runFullCycleLocked(): Promise<void> {
    const settings = configService.get();
    await this.runInventorySyncLocked();
    runtimeRegistry.rebuild(settings.discoveryPrefix);

    await Promise.allSettled([
      this.ha.connect(settings.haMqtt, settings.discoveryPrefix),
      this.datacake.connect(settings.datacakeMqtt)
    ]);

    await this.cleanupStaleEntities();
    await this.publishAllAvailabilityAndDiscovery();
    await this.syncSubscriptions();
  }

  private async runInventorySyncLocked(): Promise<void> {
    try {
      const result = await syncInventory();
      this.lastSyncAt = Date.now();
      this.lastSyncError = null;
      log.info(result, "Inventory sync complete");
    } catch (err) {
      this.lastSyncError = (err as Error).message;
      log.error({ err }, "Inventory sync failed");
      // We continue so the UI and MQTT pipelines keep working with whatever
      // is already in SQLite.
    }
  }

  // Lightweight reconfigure — used when settings changed at runtime. Runs
  // under the mutex so there is at most one in flight.
  reconfigure(): Promise<void> {
    return this.mutex.run(async () => {
      const settings = configService.get();
      if (!configService.isConfigured()) {
        log.warn("Reconfigure skipped — configuration incomplete");
        return;
      }
      runtimeRegistry.rebuild(settings.discoveryPrefix);
      await this.ha.connect(settings.haMqtt, settings.discoveryPrefix);
      await this.datacake.connect(settings.datacakeMqtt);
      await this.cleanupStaleEntities();
      await this.publishAllAvailabilityAndDiscovery();
      await this.syncSubscriptions();
    });
  }

  // Applies device/field toggle changes without dropping MQTT connections.
  // Serialised through the mutex so UI submissions cannot interleave.
  applySelectionChange(): Promise<void> {
    return this.mutex.run(async () => {
      const settings = configService.get();
      runtimeRegistry.rebuild(settings.discoveryPrefix);
      await this.cleanupStaleEntities();
      await this.publishAllAvailabilityAndDiscovery();
      await this.syncSubscriptions();
    });
  }

  private async syncSubscriptions(): Promise<void> {
    const topics = runtimeRegistry
      .listSelectedDevices()
      .filter((d) => d.productSlug)
      .map((d) => buildDatacakeSubscriptionTopic(d.productSlug, d.id));
    await this.datacake.updateSubscriptions(topics);
  }

  // Publishes availability first (so entities show up "online" immediately
  // on creation) and then the discovery payload per field.
  private async publishAllAvailabilityAndDiscovery(): Promise<void> {
    if (!this.ha.getStatus().connected) return;
    for (const device of runtimeRegistry.listSelectedDevices()) {
      await this.publishDeviceAvailability(device);
      await this.publishDeviceDiscovery(device);
    }
  }

  private async publishDeviceDiscovery(device: DeviceRuntime): Promise<void> {
    for (const field of device.fields.values()) {
      if (!field.enabled || field.ignoreByMapping) continue;
      if (field.discoveryPublished) continue;
      try {
        await this.ha.publishRetained(field.discoveryTopic, field.discoveryPayload);
        runtimeRegistry.markDiscoveryPublished(device.id, field.fieldName);
        updateDiscoveryMeta(device.id, field.fieldName, field.uniqueId, field.discoveryHash);
        upsertPublishedDiscovery({
          uniqueId: field.uniqueId,
          deviceId: device.id,
          fieldName: field.fieldName,
          component: field.haComponent,
          discoveryTopic: field.discoveryTopic,
          stateTopic: field.stateTopic,
          hash: field.discoveryHash
        });
        log.debug(
          { deviceId: device.id, fieldName: field.fieldName, topic: field.discoveryTopic },
          "Published discovery config"
        );
      } catch (err) {
        log.warn(
          { err, deviceId: device.id, fieldName: field.fieldName },
          "Failed to publish discovery"
        );
      }
    }
  }

  // Availability logic (per review spec):
  //   - On inventory sync: use `device.online` as the source of truth.
  //   - On every incoming MQTT message: set availability to `online`.
  //   - No aggressive offline handling without a configurable timeout.
  private async publishDeviceAvailability(device: DeviceRuntime): Promise<void> {
    try {
      const payload = device.online ? "online" : "offline";
      await this.ha.publishRetained(device.availabilityTopic, payload);
      upsertPublishedAvailability({
        deviceId: device.id,
        availabilityTopic: device.availabilityTopic,
        payload
      });
    } catch (err) {
      log.warn({ err, deviceId: device.id }, "Failed to publish availability");
    }
  }

  // Entity cleanup: diffs the "currently published" table against the desired
  // runtime registry and publishes empty retained payloads for anything that
  // should no longer exist in HA. Triggered before every publish pass so
  // tombstones go out before fresh discovery docs do.
  private async cleanupStaleEntities(): Promise<void> {
    if (!this.ha.getStatus().connected) return;

    const publishedDiscoveries = listPublishedDiscoveries();
    const publishedAvailabilities = listPublishedAvailabilities();

    // Desired discovery set = enabled, non-ignored fields of selected devices.
    const desiredUniqueIds = new Set<string>();
    const desiredAvailabilityDeviceIds = new Set<string>();
    for (const device of runtimeRegistry.listSelectedDevices()) {
      desiredAvailabilityDeviceIds.add(device.id);
      for (const field of device.fields.values()) {
        if (field.enabled && !field.ignoreByMapping) {
          desiredUniqueIds.add(field.uniqueId);
        }
      }
    }

    for (const entry of publishedDiscoveries) {
      if (desiredUniqueIds.has(entry.uniqueId)) continue;
      try {
        // Empty retained payload on the discovery topic instructs Home
        // Assistant to remove the entity. The state topic is cleared too so
        // HA does not rehydrate a dead sensor on its next restart.
        await this.ha.clearRetained(entry.discoveryTopic);
        await this.ha.clearRetained(entry.stateTopic);
        deletePublishedDiscovery(entry.uniqueId);
        log.info(
          { uniqueId: entry.uniqueId, discoveryTopic: entry.discoveryTopic },
          "Cleared retained discovery + state for removed entity"
        );
      } catch (err) {
        log.warn({ err, uniqueId: entry.uniqueId }, "Failed to clear stale entity");
      }
    }

    for (const entry of publishedAvailabilities) {
      if (desiredAvailabilityDeviceIds.has(entry.deviceId)) continue;
      try {
        await this.ha.clearRetained(entry.availabilityTopic);
        deletePublishedAvailability(entry.deviceId);
        log.info(
          { deviceId: entry.deviceId, topic: entry.availabilityTopic },
          "Cleared availability for removed/deselected device"
        );
      } catch (err) {
        log.warn({ err, deviceId: entry.deviceId }, "Failed to clear availability");
      }
    }
  }

  private async handleDatacakeMessage(msg: DatacakeMessage): Promise<void> {
    const device = runtimeRegistry.getDevice(msg.parsed.deviceId);
    if (!device) {
      log.debug({ topic: msg.topic }, "Received message for unknown device");
      return;
    }
    if (!device.selected) {
      log.debug({ topic: msg.topic }, "Device not selected — ignoring");
      return;
    }

    const field: FieldRuntime | undefined = device.fields.get(msg.parsed.fieldName);
    if (!field) {
      log.debug({ topic: msg.topic }, "Received message for unknown field");
      return;
    }
    if (!field.enabled || field.ignoreByMapping) {
      log.debug({ topic: msg.topic }, "Field not exported — ignoring");
      return;
    }

    if (!this.ha.getStatus().connected) {
      log.warn("HA MQTT not connected, cannot forward state");
      return;
    }

    try {
      const haPayload = serializeForHa(msg.value);
      await this.ha.publishRetained(field.stateTopic, haPayload);
      field.lastValue = msg.value.value;
      updateLastValue(device.id, field.fieldName, haPayload);

      // Any message proves the device is online right now, regardless of what
      // the inventory told us.
      if (!device.online) {
        device.online = true;
        await this.ha.publishRetained(device.availabilityTopic, "online");
        upsertPublishedAvailability({
          deviceId: device.id,
          availabilityTopic: device.availabilityTopic,
          payload: "online"
        });
        updateLastAvailability(device.id, field.fieldName, "online");
      }
    } catch (err) {
      log.warn({ err, topic: msg.topic }, "Failed to forward state to HA");
    }
  }
}

export const orchestrator = new BridgeOrchestrator();
