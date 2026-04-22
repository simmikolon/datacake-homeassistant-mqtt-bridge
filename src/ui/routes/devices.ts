import type { Express } from "express";
import { childLogger } from "../../utils/logger";
import { listDevices, setDevicesSelection } from "../../db/repositories/devicesRepo";
import { listFields } from "../../db/repositories/fieldsRepo";
import { orchestrator } from "../../runtime/bridgeOrchestrator";
import { configService } from "../../config/configService";

const log = childLogger("ui.devices");

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

export function registerDevicesRoutes(app: Express): void {
  app.get("/devices", (_req, res) => {
    const devices = listDevices().map((d) => ({
      ...d,
      fieldCount: listFields(d.id).length
    }));
    res.renderPage("devices", {
      title: "Devices",
      nav: "devices",
      devices,
      selectedCount: devices.filter((d) => d.selected).length
    });
  });

  app.post("/devices/sync", async (_req, res) => {
    if (!configService.isConfigured()) {
      res.redirect("/settings");
      return;
    }
    // Routed through the orchestrator so inventory sync + registry rebuild +
    // discovery publish + subscription diff all happen under the single
    // reconfigure mutex.
    const result = await orchestrator.triggerResync();
    if (!result.ok) log.error({ error: result.error }, "Manual sync failed");
    res.redirect("/devices");
  });

  app.post("/devices/select", async (req, res) => {
    const ids = toArray(req.body?.selected);
    setDevicesSelection(ids);
    await orchestrator.applySelectionChange();
    res.redirect("/devices");
  });
}
