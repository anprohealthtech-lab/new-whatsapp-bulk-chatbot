import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./utils";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson: any) {
    capturedJsonResponse = bodyJson;
    return originalResJson.call(res, bodyJson);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    const server = await registerRoutes(app);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      res.status(status).json({ message });
      log(`Error: ${message}`);
    });

    // API-first mode - serve minimal UI only in development
    if (process.env.NODE_ENV === "development" && process.env.SERVE_UI === "true") {
      try {
        // Dynamic import to avoid loading Vite/Rollup in production
        const { setupVite } = await import("./vite-dev");
        await setupVite(app, server);
      } catch (error) {
        log("Vite setup not available, running in API-only mode");
      }
    } else {
      // Production API-only mode
      app.get('/', (req: Request, res: Response) => {
        res.json({
          name: "WhatsApp LIMS API",
          version: "1.0.0",
          description: "Multi-User WhatsApp LIMS Backend Service",
          status: "running",
          endpoints: {
            health: "/api/external/health",
            docs: "/api/external/docs",
            sessions: "/api/external/sessions/*",
            messages: "/api/external/messages/*"
          },
          timestamp: new Date().toISOString()
        });
      });
      
      // API Documentation endpoint
      app.get('/api/external/docs', (req: Request, res: Response) => {
        res.json({
          name: "WhatsApp LIMS External API",
          version: "1.0.0",
          documentation: "See EXTERNAL_API_DOCUMENTATION.md for full API documentation",
          endpoints: {
            "POST /api/external/sessions/create": "Create new WhatsApp session",
            "GET /api/external/sessions/:id/status": "Get session status",
            "GET /api/external/sessions/:id/qr": "Get QR code",
            "DELETE /api/external/sessions/:id": "Disconnect session",
            "POST /api/external/messages/send": "Send text message", 
            "POST /api/external/reports/send": "Send report with file",
            "GET /api/external/health": "System health check"
          },
          authentication: "X-API-Key header required"
        });
      });
    }

    // ALWAYS serve the app on the port specified in the environment variable PORT
    // Default to 3001 for DigitalOcean App Platform compatibility.
    // this serves both the API and the client.
    const port = parseInt(process.env.PORT || '3001', 10);
    server.listen(port, () => {
      log(`serving on port ${port}`);
    });

    // Global error handlers to prevent the process from crashing
    process.on('uncaughtException', (error) => {
      log(`Uncaught Exception: ${error.message}`);
      console.error(error);
      // Don't exit the process in production
    });

    process.on('unhandledRejection', (reason, promise) => {
      log(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
      console.error(reason);
      // Don't exit the process in production
    });

  } catch (error) {
    log(`Failed to start server: ${error instanceof Error ? error.message : 'Unknown error'}`);
    console.error(error);
    process.exit(1);
  }
})();
