export function buildDatacakeSubscriptionTopic(
  productSlug: string,
  deviceId: string
): string {
  return `dtck/${productSlug}/${deviceId}/+`;
}

export type ParsedDatacakeTopic = {
  productSlug: string;
  deviceId: string;
  fieldName: string;
};

export function parseDatacakeTopic(topic: string): ParsedDatacakeTopic | null {
  const parts = topic.split("/");
  if (parts.length !== 4 || parts[0] !== "dtck") return null;
  const [, productSlug, deviceId, fieldName] = parts;
  if (!productSlug || !deviceId || !fieldName) return null;
  return { productSlug, deviceId, fieldName };
}

export function buildHaStateTopic(deviceId: string, fieldName: string): string {
  return `datacake/state/${deviceId}/${fieldName}`;
}

export function buildHaAvailabilityTopic(deviceId: string): string {
  return `datacake/availability/${deviceId}`;
}

// Defense in depth — the Zod schema already normalises the stored prefix, but
// if an ad-hoc caller passes an unsanitised string we still want a clean
// `<prefix>/<component>/<uniqueId>/config` without leading/trailing slashes.
function normalizeDiscoveryPrefix(prefix: string): string {
  const stripped = (prefix || "").replace(/^\/+|\/+$/g, "");
  return stripped || "homeassistant";
}

export function buildDiscoveryTopic(
  component: string,
  uniqueId: string,
  prefix: string
): string {
  return `${normalizeDiscoveryPrefix(prefix)}/${component}/${uniqueId}/config`;
}

export function buildHaStatusTopic(prefix: string): string {
  return `${normalizeDiscoveryPrefix(prefix)}/status`;
}
