import { FIELDNAME_PATTERNS, HaComponent, MappingRule, SEMANTIC_RULES } from "./semanticRules";

export type MappedField = {
  component: HaComponent;
  rule: MappingRule;
  reason: "semantic" | "fieldType" | "fieldName" | "ignore";
  // When `ignore` is true the field is never exported as an entity. The field
  // itself is still persisted in SQLite so we don't "forget" it between syncs
  // and can surface it later as device attributes (LOCATION / GEO) or keep a
  // disabled row for traceability (USER_LOG etc.).
  ignore: boolean;
};

// Applies the mapping priority `semantic > fieldType > fieldName` and returns
// both the resolved mapping and the reason that produced it, for audit logs
// and the fields UI.
export function mapField(args: {
  fieldName: string;
  fieldType: string;
  semantic: string | null;
}): MappedField {
  const upperName = args.fieldName.toUpperCase();
  const upperType = args.fieldType.toUpperCase();
  const upperSemantic = args.semantic?.toUpperCase() ?? null;

  // 1) semantic (highest priority — the authoritative Datacake signal)
  if (upperSemantic && SEMANTIC_RULES[upperSemantic]) {
    const rule = SEMANTIC_RULES[upperSemantic];
    if (rule.component === "ignore") {
      return { component: "sensor", rule, reason: "ignore", ignore: true };
    }
    return { component: rule.component, rule, reason: "semantic", ignore: false };
  }

  // 2a) GEO fieldType is never exported as an entity in the MVP. We keep the
  // field in the DB (see inventoryService) so a future release can expose it
  // as device attributes or a `device_tracker`.
  if (upperType === "GEO") {
    return {
      component: "sensor",
      rule: { component: "ignore", hiddenByDefault: true },
      reason: "ignore",
      ignore: true
    };
  }

  // 2b+3) try fieldName pattern first — it is more specific than the generic
  // fieldType fallback. The pattern list intentionally includes the
  // LOCATION/USER_LOG ignore cases so we hard-ignore them even without a
  // matching `semantic`.
  for (const entry of FIELDNAME_PATTERNS) {
    if (entry.pattern.test(upperName)) {
      if (entry.rule.component === "ignore") {
        return { component: "sensor", rule: entry.rule, reason: "ignore", ignore: true };
      }
      return {
        component: entry.rule.component,
        rule: entry.rule,
        reason: "fieldName",
        ignore: false
      };
    }
  }

  // 4) Raw fieldType fallbacks
  if (upperType === "BOOL") {
    return {
      component: "binary_sensor",
      rule: { component: "binary_sensor", payload_on: "ON", payload_off: "OFF" },
      reason: "fieldType",
      ignore: false
    };
  }

  if (upperType === "NUMERIC") {
    return {
      component: "sensor",
      rule: { component: "sensor" },
      reason: "fieldType",
      ignore: false
    };
  }

  if (upperType === "STRING") {
    // Bridge contract: a STRING field without a `semantic` AND without a
    // whitelisted fieldName pattern defaults to "do not export". It is still
    // surfaced in the UI as a togglable, mapped-but-disabled sensor so the
    // operator can explicitly opt-in.
    return {
      component: "sensor",
      rule: { component: "sensor", hiddenByDefault: true },
      reason: "fieldType",
      ignore: false
    };
  }

  // Unknown fieldType — mark as ignored but still keep it in the DB.
  return {
    component: "sensor",
    rule: { component: "sensor", hiddenByDefault: true },
    reason: "fieldType",
    ignore: true
  };
}
