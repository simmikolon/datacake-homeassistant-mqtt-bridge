import { mapField, MappedField } from "./fieldMapper";

export type ExportDefaults = {
  enabled: boolean;
  diagnostic: boolean;
  ignore: boolean;
  mapped: MappedField;
};

// Applies the bridge's default export policy for a fresh field:
//  - never auto-enable ignored fields (GEO / LOCATION / USER_LOG / unknown strings)
//  - auto-enable cleanly mapped sensors/binary_sensors
//  - diagnostic fields (RSSI, SNR, link metadata, battery voltage) stay off
//    unless the user opts-in later via the UI
export function defaultExportFor(args: {
  fieldName: string;
  fieldType: string;
  semantic: string | null;
}): ExportDefaults {
  const mapped = mapField(args);

  if (mapped.ignore) {
    return { enabled: false, diagnostic: false, ignore: true, mapped };
  }

  const rule = mapped.rule;
  const hidden = rule.hiddenByDefault === true;
  const diagnostic = rule.diagnosticDefault === true || rule.entity_category === "diagnostic";

  return {
    enabled: !hidden && !diagnostic,
    diagnostic: diagnostic,
    ignore: false,
    mapped
  };
}
