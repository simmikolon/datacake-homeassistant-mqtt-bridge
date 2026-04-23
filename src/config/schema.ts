import { z } from "zod";

// Schemas deliberately allow empty strings for every credential/URL field so
// that intermediate states (e.g. first boot, partial form submission, add-on
// bootstrap writing only the HA MQTT section before the user has supplied
// Datacake credentials) are structurally valid. Whether the bridge has enough
// information to actually start is determined by `configService.isConfigured()`
// at runtime, not by the schema.
export const MqttSettingsSchema = z.object({
  url: z.string().trim().default(""),
  username: z.string().optional().default(""),
  password: z.string().optional().default(""),
  clientId: z.string().optional().default(""),
  // Accept strings from HTML forms and coerce.
  rejectUnauthorized: z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v === "true" || v === "on" || v === "1";
    return true;
  }, z.boolean()).default(true)
});

export type MqttSettings = z.infer<typeof MqttSettingsSchema>;

export const DatacakeApiSettingsSchema = z.object({
  endpoint: z
    .string()
    .trim()
    .default("https://api.datacake.co/graphql/"),
  token: z.string().trim().default(""),
  workspaceId: z.string().trim().default("")
});

export type DatacakeApiSettings = z.infer<typeof DatacakeApiSettingsSchema>;

export const AppSettingsSchema = z.object({
  datacake: DatacakeApiSettingsSchema,
  datacakeMqtt: MqttSettingsSchema,
  haMqtt: MqttSettingsSchema,
  discoveryPrefix: z
    .string()
    .trim()
    .min(1)
    .default("homeassistant")
    // Strip BOTH leading and trailing slashes. HA's MQTT integration defaults
    // to the prefix `homeassistant` (no slashes) and a leading slash would
    // produce broken topics like `/homeassistant/sensor/…/config`. If the
    // operator enters only slashes we fall back to the safe default.
    .transform((v) => {
      const stripped = v.replace(/^\/+|\/+$/g, "");
      return stripped || "homeassistant";
    })
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  datacake: {
    endpoint: "https://api.datacake.co/graphql/",
    token: "",
    workspaceId: ""
  },
  datacakeMqtt: {
    url: "",
    username: "",
    password: "",
    clientId: "",
    rejectUnauthorized: true
  },
  haMqtt: {
    url: "",
    username: "",
    password: "",
    clientId: "datacake-ha-bridge",
    rejectUnauthorized: true
  },
  discoveryPrefix: "homeassistant"
};

function isChecked(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "on" || v === "true" || v === "1";
  return false;
}

// Validates user-submitted form data, tolerating partial inputs by merging with
// the currently stored configuration before running the strict schema.
export function parsePartialSettings(
  base: AppSettings,
  raw: Record<string, unknown>
): AppSettings {
  const merged: AppSettings = {
    datacake: { ...base.datacake },
    datacakeMqtt: { ...base.datacakeMqtt },
    haMqtt: { ...base.haMqtt },
    discoveryPrefix: base.discoveryPrefix
  };

  if (typeof raw["datacake.endpoint"] === "string") {
    merged.datacake.endpoint = raw["datacake.endpoint"].trim();
  }
  // The Datacake API token and the MQTT passwords follow a three-state
  // submit model. The "clear" checkbox has the HIGHEST priority so browser
  // password managers autofilling the hidden field cannot sneak the old
  // credential back in when the operator explicitly asked to drop it:
  //   - `clear…` checkbox ticked → wipe the stored secret, ignore any value
  //     the browser may have autofilled into the password field
  //   - field has a non-empty value → overwrite with the new value
  //   - field empty, no `clear…` checkbox → keep current value (so the
  //     operator can re-save the form without re-typing their secrets)
  if (isChecked(raw["datacake.clearToken"])) {
    merged.datacake.token = "";
  } else if (typeof raw["datacake.token"] === "string" && raw["datacake.token"] !== "") {
    merged.datacake.token = String(raw["datacake.token"]).trim();
  }
  if (typeof raw["datacake.workspaceId"] === "string") {
    merged.datacake.workspaceId = raw["datacake.workspaceId"].trim();
  }

  for (const prefix of ["datacakeMqtt", "haMqtt"] as const) {
    const target = merged[prefix];
    if (typeof raw[`${prefix}.url`] === "string") target.url = (raw[`${prefix}.url`] as string).trim();
    if (typeof raw[`${prefix}.username`] === "string") target.username = raw[`${prefix}.username`] as string;
    if (isChecked(raw[`${prefix}.clearPassword`])) {
      target.password = "";
    } else if (typeof raw[`${prefix}.password`] === "string" && raw[`${prefix}.password`] !== "") {
      target.password = raw[`${prefix}.password`] as string;
    }
    if (typeof raw[`${prefix}.clientId`] === "string") target.clientId = (raw[`${prefix}.clientId`] as string).trim();
    if (`${prefix}.rejectUnauthorized` in raw) {
      const v = raw[`${prefix}.rejectUnauthorized`];
      target.rejectUnauthorized =
        typeof v === "boolean" ? v : v === "on" || v === "true" || v === "1";
    } else {
      // Unchecked checkbox does not arrive in form data; only reset when form
      // meta indicates the checkbox section was submitted.
      if (raw[`${prefix}.__submitted`] === "1") {
        target.rejectUnauthorized = false;
      }
    }
  }

  if (typeof raw["discoveryPrefix"] === "string") {
    merged.discoveryPrefix = (raw["discoveryPrefix"] as string).trim() || "homeassistant";
  }

  return AppSettingsSchema.parse(merged);
}
