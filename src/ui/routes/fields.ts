import type { Express } from "express";
import { childLogger } from "../../utils/logger";
import { getDevice } from "../../db/repositories/devicesRepo";
import {
  listFields,
  setFieldOverride,
  setFieldToggles
} from "../../db/repositories/fieldsRepo";
import { mapField } from "../../mapping/fieldMapper";
import { orchestrator } from "../../runtime/bridgeOrchestrator";

const log = childLogger("ui.fields");

export function registerFieldsRoutes(app: Express): void {
  app.get("/devices/:id/fields", (req, res) => {
    const device = getDevice(req.params.id);
    if (!device) {
      res.status(404).send("Device not found");
      return;
    }
    // Prefer the mapping columns persisted during the last inventory sync
    // (they are always up to date after `syncInventory`). Fall back to a live
    // `mapField` call only if the row has never been synced yet — this keeps
    // the fields UI snappy without repeating the mapping logic on every
    // request.
    const rows = listFields(device.id).map((f) => {
      const usePersisted = f.mappedComponent !== null || f.ignored;
      const mapped = usePersisted
        ? {
            ignore: f.ignored,
            component: (f.mappedComponent ?? "sensor") as
              | "sensor"
              | "binary_sensor"
              | "switch"
              | "number",
            rule: {
              device_class: f.mappedDeviceClass ?? undefined,
              unit_of_measurement: f.mappedUnit ?? undefined,
              state_class: f.mappedStateClass ?? undefined
            }
          }
        : mapField({
            fieldName: f.fieldName,
            fieldType: f.fieldType,
            semantic: f.semantic
          });
      return {
        fieldName: f.fieldName,
        fieldType: f.fieldType,
        semantic: f.semantic,
        enabled: f.enabled,
        diagnostic: f.diagnostic,
        overrideJson: f.overrideJson ?? "",
        ignore: mapped.ignore,
        component: mapped.component,
        deviceClass: mapped.rule.device_class,
        unit: mapped.rule.unit_of_measurement
      };
    });

    res.renderPage("fields", {
      title: `Fields · ${device.verboseName}`,
      nav: "devices",
      device,
      fields: rows
    });
  });

  app.post("/devices/:id/fields", async (req, res) => {
    const device = getDevice(req.params.id);
    if (!device) {
      res.status(404).send("Device not found");
      return;
    }

    // `express.urlencoded({ extended: true })` turns `fields[NAME][enabled]=on`
    // into `{ fields: { NAME: { enabled: "on", ... } } }` which we walk here.
    const fieldsInput = (req.body?.fields ?? {}) as Record<
      string,
      { __submitted?: string; enabled?: string; diagnostic?: string; override?: string }
    >;

    for (const [fieldName, values] of Object.entries(fieldsInput)) {
      if (values?.__submitted !== "1") continue;
      const enabled = values.enabled === "on";
      const diagnostic = values.diagnostic === "on";
      setFieldToggles(device.id, fieldName, enabled, diagnostic);

      const override = (values.override ?? "").trim();
      if (!override) {
        setFieldOverride(device.id, fieldName, null);
      } else {
        try {
          JSON.parse(override);
          setFieldOverride(device.id, fieldName, override);
        } catch {
          log.warn({ deviceId: device.id, fieldName }, "Ignoring invalid override JSON");
        }
      }
    }

    await orchestrator.applySelectionChange();
    res.redirect(`/devices/${device.id}/fields`);
  });
}
