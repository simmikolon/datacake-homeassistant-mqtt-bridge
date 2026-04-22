import type { Express } from "express";
import { getRecentLogs } from "../../utils/logger";

export function registerLogsRoutes(app: Express): void {
  app.get("/logs", (_req, res) => {
    const entries = getRecentLogs(200);
    res.renderPage("logs", {
      title: "Logs",
      nav: "logs",
      entries
    });
  });
}
