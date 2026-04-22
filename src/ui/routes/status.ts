import type { Express } from "express";
import { orchestrator } from "../../runtime/bridgeOrchestrator";
import { runtimeRegistry } from "../../runtime/runtimeRegistry";

function fmt(ts: number | null | undefined): string {
  if (!ts) return "never";
  return new Date(ts).toLocaleString();
}

export function registerStatusRoutes(app: Express): void {
  app.get("/status", (_req, res) => {
    const status = orchestrator.getStatus();
    res.renderPage("status", {
      title: "Status",
      nav: "status",
      status,
      lastSyncText: fmt(status.lastSyncAt),
      lastEventText: fmt(status.datacakeMqtt.lastEventAt),
      lastPublishText: fmt(status.haMqtt.lastPublishAt)
    });
  });

  app.post("/status/reannounce", async (_req, res) => {
    runtimeRegistry.markAllDiscoveryUnpublished();
    await orchestrator.applySelectionChange();
    res.redirect("/status");
  });
}
