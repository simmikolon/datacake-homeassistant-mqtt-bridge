import { createHash } from "crypto";
import { buildHaAvailabilityTopic, buildHaStateTopic } from "../mqtt/topics";
import { buildUniqueId } from "../utils/ids";
import { childLogger } from "../utils/logger";
import type { HaComponent, MappingRule } from "./semanticRules";

const log = childLogger("mapping.discovery");

// Keys the operator is allowed to override via the per-field JSON textarea.
// Anything touching the MQTT topology (`state_topic`, `availability_topic`,
// `unique_id`, `device`, …) is intentionally NOT overridable — overriding
// these would decouple HA from the topics the bridge actually publishes on
// and break state forwarding / availability / entity tracking.
const ALLOWED_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "name",
  "icon",
  "device_class",
  "unit_of_measurement",
  "state_class",
  "entity_category",
  "payload_on",
  "payload_off",
  "object_id",
  "suggested_display_precision",
  "value_template",
  "expire_after",
  "force_update",
  "enabled_by_default"
]);

export type HaDeviceMetadata = {
  identifiers: string[];
  name: string;
  manufacturer: string;
  model: string;
};

export type DiscoveryPayload = {
  name: string;
  unique_id: string;
  state_topic: string;
  availability_topic: string;
  payload_available: string;
  payload_not_available: string;
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  entity_category?: "diagnostic" | "config";
  payload_on?: string;
  payload_off?: string;
  device: HaDeviceMetadata;
};

export type DiscoveryArtifacts = {
  component: HaComponent;
  uniqueId: string;
  stateTopic: string;
  availabilityTopic: string;
  payload: DiscoveryPayload;
  hash: string;
};

function humanizeFieldName(fieldName: string): string {
  const lower = fieldName.toLowerCase().replace(/_/g, " ");
  return lower
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

export function buildDiscovery(args: {
  deviceId: string;
  verboseName: string;
  productSlug: string;
  fieldName: string;
  component: HaComponent;
  rule: MappingRule;
  diagnostic: boolean;
  override?: Partial<DiscoveryPayload> | null;
}): DiscoveryArtifacts {
  const uniqueId = buildUniqueId(args.deviceId, args.fieldName);
  const stateTopic = buildHaStateTopic(args.deviceId, args.fieldName);
  const availabilityTopic = buildHaAvailabilityTopic(args.deviceId);

  const payload: DiscoveryPayload = {
    name: humanizeFieldName(args.fieldName),
    unique_id: uniqueId,
    state_topic: stateTopic,
    availability_topic: availabilityTopic,
    payload_available: "online",
    payload_not_available: "offline",
    device: {
      identifiers: [`dtck_${args.deviceId}`],
      name: args.verboseName,
      manufacturer: "Datacake",
      model: args.productSlug
    }
  };

  if (args.rule.device_class) payload.device_class = args.rule.device_class;
  if (args.rule.unit_of_measurement) payload.unit_of_measurement = args.rule.unit_of_measurement;
  if (args.rule.state_class) payload.state_class = args.rule.state_class;

  // Diagnostic classification follows the user toggle first, falling back to
  // the rule's own entity_category to stay consistent with the mapping table.
  if (args.diagnostic) {
    payload.entity_category = "diagnostic";
  } else if (args.rule.entity_category) {
    payload.entity_category = args.rule.entity_category;
  }

  if (args.component === "binary_sensor") {
    payload.payload_on = args.rule.payload_on ?? "ON";
    payload.payload_off = args.rule.payload_off ?? "OFF";
  }

  if (args.override && typeof args.override === "object") {
    const rejected: string[] = [];
    for (const [key, value] of Object.entries(args.override)) {
      if (ALLOWED_OVERRIDE_KEYS.has(key)) {
        (payload as Record<string, unknown>)[key] = value;
      } else {
        rejected.push(key);
      }
    }
    if (rejected.length) {
      log.warn(
        { uniqueId, rejected },
        "Ignored override keys that would break MQTT topology or are unsupported"
      );
    }
  }

  const hash = sha1(JSON.stringify(payload));
  return {
    component: args.component,
    uniqueId,
    stateTopic,
    availabilityTopic,
    payload,
    hash
  };
}
