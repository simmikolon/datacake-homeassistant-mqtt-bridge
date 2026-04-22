import { childLogger } from "../utils/logger";
import { listDevices } from "../db/repositories/devicesRepo";
import { listFields } from "../db/repositories/fieldsRepo";
import { mapField } from "../mapping/fieldMapper";
import { buildDiscovery, DiscoveryArtifacts } from "../mapping/discoveryBuilder";
import { buildDiscoveryTopic, buildHaAvailabilityTopic, buildHaStateTopic } from "../mqtt/topics";
import type { HaComponent } from "../mapping/semanticRules";

const log = childLogger("runtime");

export type FieldRuntime = {
  key: string;
  fieldName: string;
  fieldType: string;
  semantic: string | null;
  haComponent: HaComponent;
  uniqueId: string;
  stateTopic: string;
  discoveryTopic: string;
  discoveryPayload: Record<string, unknown>;
  discoveryHash: string;
  enabled: boolean;
  diagnostic: boolean;
  ignoreByMapping: boolean;
  discoveryPublished: boolean;
  lastValue: string | number | boolean | null;
};

export type DeviceRuntime = {
  id: string;
  verboseName: string;
  productSlug: string;
  online: boolean;
  lastHeard: string | null;
  selected: boolean;
  availabilityTopic: string;
  fields: Map<string, FieldRuntime>;
};

class RuntimeRegistry {
  private devices = new Map<string, DeviceRuntime>();

  rebuild(discoveryPrefix: string): void {
    const deviceRecords = listDevices();
    const next = new Map<string, DeviceRuntime>();

    for (const device of deviceRecords) {
      const runtime: DeviceRuntime = {
        id: device.id,
        verboseName: device.verboseName,
        productSlug: device.productSlug,
        online: device.online,
        lastHeard: device.lastHeard,
        selected: device.selected,
        availabilityTopic: buildHaAvailabilityTopic(device.id),
        fields: new Map()
      };

      const fields = listFields(device.id);
      for (const f of fields) {
        const mapped = mapField({
          fieldName: f.fieldName,
          fieldType: f.fieldType,
          semantic: f.semantic
        });
        const artifacts: DiscoveryArtifacts = buildDiscovery({
          deviceId: device.id,
          verboseName: device.verboseName,
          productSlug: device.productSlug,
          fieldName: f.fieldName,
          component: mapped.component,
          rule: mapped.rule,
          diagnostic: f.diagnostic,
          override: f.overrideJson ? safeParseJson(f.overrideJson) : null
        });

        const discoveryTopic = buildDiscoveryTopic(
          artifacts.component,
          artifacts.uniqueId,
          discoveryPrefix
        );

        const runtimeField: FieldRuntime = {
          key: f.fieldName,
          fieldName: f.fieldName,
          fieldType: f.fieldType,
          semantic: f.semantic,
          haComponent: artifacts.component,
          uniqueId: artifacts.uniqueId,
          stateTopic: buildHaStateTopic(device.id, f.fieldName),
          discoveryTopic,
          discoveryPayload: artifacts.payload as unknown as Record<string, unknown>,
          discoveryHash: artifacts.hash,
          enabled: f.enabled,
          diagnostic: f.diagnostic,
          ignoreByMapping: mapped.ignore,
          discoveryPublished: false,
          lastValue: f.lastValue ?? null
        };
        runtime.fields.set(f.fieldName, runtimeField);
      }
      next.set(device.id, runtime);
    }

    // Preserve discoveryPublished flags across rebuilds where possible so we
    // avoid spamming retained topics that are already in sync with HA.
    for (const [id, existing] of this.devices) {
      const nextDev = next.get(id);
      if (!nextDev) continue;
      for (const [fieldName, existingField] of existing.fields) {
        const nextField = nextDev.fields.get(fieldName);
        if (!nextField) continue;
        if (existingField.discoveryHash === nextField.discoveryHash) {
          nextField.discoveryPublished = existingField.discoveryPublished;
        }
      }
    }

    this.devices = next;
    log.debug({ devices: this.devices.size }, "Runtime registry rebuilt");
  }

  getDevice(id: string): DeviceRuntime | undefined {
    return this.devices.get(id);
  }

  getField(deviceId: string, fieldName: string): FieldRuntime | undefined {
    return this.devices.get(deviceId)?.fields.get(fieldName);
  }

  listSelectedDevices(): DeviceRuntime[] {
    return Array.from(this.devices.values()).filter((d) => d.selected);
  }

  listAllDevices(): DeviceRuntime[] {
    return Array.from(this.devices.values());
  }

  countExportedFields(): number {
    let count = 0;
    for (const device of this.devices.values()) {
      if (!device.selected) continue;
      for (const field of device.fields.values()) {
        if (field.enabled && !field.ignoreByMapping) count += 1;
      }
    }
    return count;
  }

  markDiscoveryPublished(deviceId: string, fieldName: string): void {
    const field = this.getField(deviceId, fieldName);
    if (field) field.discoveryPublished = true;
  }

  markAllDiscoveryUnpublished(): void {
    for (const device of this.devices.values()) {
      for (const field of device.fields.values()) {
        field.discoveryPublished = false;
      }
    }
  }
}

function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s);
    return typeof parsed === "object" && parsed && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const runtimeRegistry = new RuntimeRegistry();
