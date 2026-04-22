// Robust payload normalization for values that arrive via Datacake MQTT.
//
// The parser follows a strict, well-defined precedence so that any byte buffer
// ends up in a predictable shape. HA state topics prefer primitive values over
// nested JSON, which is why we publish the unwrapped form whenever possible.
//
// Order (exactly as specified by the bridge contract):
//   1. Read the buffer as UTF-8 text and trim()
//   2. Empty payload                     → null
//   3. Exactly "true" / "false"          → boolean
//   4. Numeric literal (int/float/exp)   → number
//   5. Starts with "{" or "["            → JSON (extract .value when present,
//                                          otherwise keep the raw JSON text)
//   6. Anything else                     → string

export type NormalizedValue = {
  raw: string;
  value: string | number | boolean | null;
  kind: "number" | "boolean" | "string" | "null" | "json";
};

const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function normalizePayload(buf: Buffer | string): NormalizedValue {
  const raw = typeof buf === "string" ? buf : buf.toString("utf8");
  const trimmed = raw.trim();

  if (!trimmed.length) {
    return { raw, value: null, kind: "null" };
  }

  if (trimmed === "true") return { raw, value: true, kind: "boolean" };
  if (trimmed === "false") return { raw, value: false, kind: "boolean" };

  if (NUMERIC_RE.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return { raw, value: num, kind: "number" };
    }
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "value" in parsed
      ) {
        const v = (parsed as { value: unknown }).value;
        if (typeof v === "number" && Number.isFinite(v)) {
          return { raw, value: v, kind: "number" };
        }
        if (typeof v === "boolean") {
          return { raw, value: v, kind: "boolean" };
        }
        if (typeof v === "string") {
          return { raw, value: v, kind: "string" };
        }
      }
      return { raw, value: trimmed, kind: "json" };
    } catch {
      // Malformed JSON – treat as plain string.
    }
  }

  return { raw, value: trimmed, kind: "string" };
}

// Serialises a normalized value into the form HA expects on a state topic.
// We intentionally favour primitive payloads over JSON so sensors, binary
// sensors, etc. work without `value_template`.
export function serializeForHa(value: NormalizedValue): string {
  if (value.value === null) return "";
  if (typeof value.value === "boolean") return value.value ? "ON" : "OFF";
  return String(value.value);
}
