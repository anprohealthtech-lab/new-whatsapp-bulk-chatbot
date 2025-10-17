import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./utils";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
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

    // importantly only setup vite in development and after
    // setting up all the other routes so the catch-all route
    // doesn't interfere with the other routes
    if (process.env.NODE_ENV === "development" && process.env.npm_lifecycle_event !== "build") {
      try {
        // Dynamic import to avoid loading Vite/Rollup in production
        const { setupVite } = await import("./vite-dev");
        await setupVite(app, server);
      } catch (error) {
        log("Vite setup not available in production build, serving static files");
        serveStatic(app);
      }
    } else {
      serveStatic(app);
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
