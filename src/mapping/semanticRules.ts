export type HaComponent = "sensor" | "binary_sensor" | "switch" | "number";

export type MappingRule = {
  component: HaComponent | "ignore";
  device_class?: string;
  unit_of_measurement?: string;
  state_class?: string;
  entity_category?: "diagnostic" | "config";
  // If true, the field is classified as diagnostic by default and therefore
  // disabled unless the user opts-in. Used by `exportPolicy`.
  diagnosticDefault?: boolean;
  // If true, the field should not be exported by default even though the
  // mapping exists (e.g. location, user log, raw strings without meaning).
  hiddenByDefault?: boolean;
  // Extra payload_on/off for binary sensors etc.
  payload_on?: string;
  payload_off?: string;
};

// Central table. `semantic` is uppercased before lookup. Keys must be uppercase.
export const SEMANTIC_RULES: Record<string, MappingRule> = {
  TEMPERATURE: {
    component: "sensor",
    device_class: "temperature",
    unit_of_measurement: "°C",
    state_class: "measurement"
  },
  HUMIDITY: {
    component: "sensor",
    device_class: "humidity",
    unit_of_measurement: "%",
    state_class: "measurement"
  },
  BATTERY: {
    component: "sensor",
    device_class: "battery",
    unit_of_measurement: "%",
    state_class: "measurement",
    entity_category: "diagnostic"
  },
  BATTERY_VOLTAGE: {
    component: "sensor",
    device_class: "voltage",
    unit_of_measurement: "V",
    state_class: "measurement",
    entity_category: "diagnostic",
    diagnosticDefault: true
  },
  SIGNAL: {
    component: "sensor",
    device_class: "signal_strength",
    unit_of_measurement: "dBm",
    state_class: "measurement",
    entity_category: "diagnostic",
    diagnosticDefault: true
  },
  RSSI: {
    component: "sensor",
    device_class: "signal_strength",
    unit_of_measurement: "dBm",
    state_class: "measurement",
    entity_category: "diagnostic",
    diagnosticDefault: true
  },
  SNR: {
    component: "sensor",
    unit_of_measurement: "dB",
    state_class: "measurement",
    entity_category: "diagnostic",
    diagnosticDefault: true
  },
  SOIL_MOISTURE: {
    component: "sensor",
    device_class: "moisture",
    unit_of_measurement: "%",
    state_class: "measurement"
  },
  MOISTURE: {
    component: "sensor",
    device_class: "moisture",
    unit_of_measurement: "%",
    state_class: "measurement"
  },
  CO2: {
    component: "sensor",
    device_class: "carbon_dioxide",
    unit_of_measurement: "ppm",
    state_class: "measurement"
  },
  POWER: {
    component: "sensor",
    device_class: "power",
    unit_of_measurement: "W",
    state_class: "measurement"
  },
  ENERGY: {
    component: "sensor",
    device_class: "energy",
    unit_of_measurement: "kWh",
    state_class: "total_increasing"
  },
  VOLTAGE: {
    component: "sensor",
    device_class: "voltage",
    unit_of_measurement: "V",
    state_class: "measurement"
  },
  CURRENT: {
    component: "sensor",
    device_class: "current",
    unit_of_measurement: "A",
    state_class: "measurement"
  },
  PRESSURE: {
    component: "sensor",
    device_class: "pressure",
    unit_of_measurement: "hPa",
    state_class: "measurement"
  },
  ILLUMINANCE: {
    component: "sensor",
    device_class: "illuminance",
    unit_of_measurement: "lx",
    state_class: "measurement"
  },
  DOOR_OPENED: {
    component: "binary_sensor",
    device_class: "door",
    payload_on: "ON",
    payload_off: "OFF"
  },
  CONTACT: {
    component: "binary_sensor",
    device_class: "opening",
    payload_on: "ON",
    payload_off: "OFF"
  },
  MOTION: {
    component: "binary_sensor",
    device_class: "motion",
    payload_on: "ON",
    payload_off: "OFF"
  },
  OCCUPANCY: {
    component: "binary_sensor",
    device_class: "occupancy",
    payload_on: "ON",
    payload_off: "OFF"
  },
  LOCATION: {
    component: "ignore",
    hiddenByDefault: true
  },
  USER_LOG: {
    component: "ignore",
    hiddenByDefault: true
  }
};

// Regex-based fallback when the API gave us neither a semantic nor a clean
// fieldType match. Key is matched against the UPPERCASE fieldName.
export const FIELDNAME_PATTERNS: Array<{ pattern: RegExp; rule: MappingRule }> = [
  { pattern: /(^|_)TEMP(ERATURE)?($|_)/, rule: SEMANTIC_RULES.TEMPERATURE },
  { pattern: /(^|_)HUMIDITY($|_)/, rule: SEMANTIC_RULES.HUMIDITY },
  { pattern: /(^|_)BATTERY($|_)/, rule: SEMANTIC_RULES.BATTERY },
  { pattern: /(^|_)BATT($|_)/, rule: SEMANTIC_RULES.BATTERY },
  { pattern: /(^|_)RSSI($|_)/, rule: SEMANTIC_RULES.RSSI },
  { pattern: /(^|_)SNR($|_)/, rule: SEMANTIC_RULES.SNR },
  { pattern: /(^|_)SIGNAL($|_)/, rule: SEMANTIC_RULES.SIGNAL },
  { pattern: /(^|_)LINKQUALITY($|_)/, rule: SEMANTIC_RULES.SIGNAL },
  { pattern: /(^|_)(SOIL_?)?MOISTURE($|_)/, rule: SEMANTIC_RULES.MOISTURE },
  { pattern: /(^|_)CO2($|_)/, rule: SEMANTIC_RULES.CO2 },
  { pattern: /(^|_)POWER($|_)/, rule: SEMANTIC_RULES.POWER },
  { pattern: /(^|_)ENERGY($|_)/, rule: SEMANTIC_RULES.ENERGY },
  { pattern: /(^|_)VOLTAGE($|_)/, rule: SEMANTIC_RULES.VOLTAGE },
  { pattern: /(^|_)CURRENT($|_)/, rule: SEMANTIC_RULES.CURRENT },
  { pattern: /(^|_)PRESSURE($|_)/, rule: SEMANTIC_RULES.PRESSURE },
  { pattern: /(^|_)(ILLUMINANCE|LUX)($|_)/, rule: SEMANTIC_RULES.ILLUMINANCE },
  { pattern: /(^|_)CONTACT($|_)/, rule: SEMANTIC_RULES.CONTACT },
  { pattern: /(^|_)MOTION($|_)/, rule: SEMANTIC_RULES.MOTION },
  { pattern: /(^|_)OCCUPANCY($|_)/, rule: SEMANTIC_RULES.OCCUPANCY },
  { pattern: /(^|_)DOOR($|_)/, rule: SEMANTIC_RULES.DOOR_OPENED },
  { pattern: /(^|_)(LOCATION|GPS|COORDS?)($|_)/, rule: SEMANTIC_RULES.LOCATION },
  { pattern: /(^|_)USER_LOG($|_)/, rule: SEMANTIC_RULES.USER_LOG },
  { pattern: /(^|_)LORA_?DATARATE($|_)/, rule: { component: "sensor", entity_category: "diagnostic", diagnosticDefault: true } },
  { pattern: /(^|_)SPREADING_?FACTOR($|_)/, rule: { component: "sensor", entity_category: "diagnostic", diagnosticDefault: true } }
];
