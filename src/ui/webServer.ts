import express, { NextFunction, Request, Response } from "express";
import * as path from "path";
import { childLogger } from "../utils/logger";
import { registerDashboardRoutes } from "./routes/dashboard";
import { registerSettingsRoutes } from "./routes/settings";
import { registerDevicesRoutes } from "./routes/devices";
import { registerFieldsRoutes } from "./routes/fields";
import { registerStatusRoutes } from "./routes/status";
import { registerLogsRoutes } from "./routes/logs";

const log = childLogger("ui");

export type RenderOpts = {
  title: string;
  nav: string;
  body: string;
  flash?: { type: "success" | "error" | "info"; message: string } | null;
};

declare module "express-serve-static-core" {
  interface Response {
    renderPage(view: string, opts: Omit<RenderOpts, "body"> & Record<string, unknown>): void;
  }
}

export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  const baseDir = path.dirname(__dirname); // dist/ at runtime
  const viewsDir = path.join(baseDir, "views");
  const publicDir = path.join(baseDir, "public");

  app.set("view engine", "ejs");
  app.set("views", viewsDir);
  app.use("/", express.static(publicDir, { maxAge: "5m" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(express.json({ limit: "1mb" }));

  // When running behind Home Assistant's ingress proxy the Supervisor sends
  // the dynamic path prefix (e.g. `/api/hassio_ingress/<token>`) via the
  // `X-Ingress-Path` request header. We mirror it into `res.locals.ingressPath`
  // so `layout.ejs` can emit a matching `<base>` tag; every in-app link is
  // written as a relative path and resolves correctly both directly (no
  // ingress prefix) and via HA ingress.
  app.use((req, res, next) => {
    const raw = req.headers["x-ingress-path"];
    const prefix = typeof raw === "string" ? raw.replace(/\/+$/, "") : "";
    // The <base href=...> needs a trailing slash, otherwise the browser
    // resolves relative URLs against the last path segment instead of the
    // directory root. The fallback `/` keeps standalone (non-ingress) access
    // working identically to before.
    res.locals.ingressPath = prefix ? `${prefix}/` : "/";
    next();
  });

  // Convenience helper that renders a page inside the shared layout.
  app.use((_req, res, next) => {
    res.renderPage = function (view: string, opts) {
      this.render(view, opts, (err, html) => {
        if (err) {
          log.error({ err, view }, "Failed to render view");
          this.status(500).send("Render error: " + (err as Error).message);
          return;
        }
        this.render(
          "layout",
          {
            title: opts.title,
            nav: opts.nav,
            flash: opts.flash ?? null,
            body: html
          },
          (err2, layoutHtml) => {
            if (err2) {
              log.error({ err: err2 }, "Failed to render layout");
              this.status(500).send("Layout error: " + (err2 as Error).message);
              return;
            }
            this.send(layoutHtml);
          }
        );
      });
    };
    next();
  });

  registerDashboardRoutes(app);
  registerSettingsRoutes(app);
  registerDevicesRoutes(app);
  registerFieldsRoutes(app);
  registerStatusRoutes(app);
  registerLogsRoutes(app);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err }, "Unhandled error in request");
    res.status(500).send("Internal error: " + err.message);
  });

  return app;
}

export function startHttpServer(port: number): Promise<void> {
  return new Promise((resolve) => {
    const app = createApp();
    app.listen(port, () => {
      log.info({ port }, "Web UI listening");
      resolve();
    });
  });
}
