import type { Express } from "express";
import { configService } from "../../config/configService";
import { orchestrator } from "../../runtime/bridgeOrchestrator";

export function registerDashboardRoutes(app: Express): void {
  app.get("/", (_req, res) => {
    const settings = configService.get();
    const status = orchestrator.getStatus();
    res.renderPage("dashboard", {
      title: "Dashboard",
      nav: "dashboard",
      configured: configService.isConfigured(),
      settings,
      status,
      lastSyncText: status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "never",
      lastSyncError: status.lastSyncError
    });
  });
}
