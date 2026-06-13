import { Router, type Request, type Response } from "express";
import { config } from "../config.js";

export const portalRouter = Router();

const platformBaseUrl = (config.MAIN_PLATFORM_URL || new URL(config.PLATFORM_AGENT_URL).origin).replace(/\/$/, "");
const publicTokenRequests = new Map<string, { count: number; resetAt: number }>();

portalRouter.post("/api/portal/login", (req, res) => proxyJson(req, res, "/api/auth/login"));
portalRouter.get("/api/portal/me", (req, res) => proxyJson(req, res, "/api/auth/me"));
portalRouter.get("/api/portal/agents", (req, res) => proxyJson(req, res, "/api/voice/agents"));
portalRouter.patch("/api/portal/agents/:id/widget", (req, res) =>
  proxyJson(req, res, `/api/voice/agents/${encodeURIComponent(req.params.id)}/widget`)
);
portalRouter.post("/api/portal/session-token", (req, res) =>
  proxyJson(req, res, "/api/voice/session-token")
);
portalRouter.get("/api/embed/:id/config", (req, res) =>
  proxyJson(req, res, `/api/voice/public/agents/${encodeURIComponent(req.params.id)}`)
);
portalRouter.post("/api/embed/:id/session-token", (req, res) => {
  if (!allowPublicToken(req)) {
    res.status(429).json({ message: "Too many voice sessions. Please try again shortly." });
    return;
  }
  return proxyJson(
    req,
    res,
    `/api/voice/public/agents/${encodeURIComponent(req.params.id)}/session-token`,
  );
});

async function proxyJson(req: Request, res: Response, path: string): Promise<void> {
  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    if (req.method !== "GET" && req.method !== "HEAD") headers["content-type"] = "application/json";

    const response = await fetch(`${platformBaseUrl}${path}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body || {}),
    });
    const text = await response.text();
    res.status(response.status);
    res.type("application/json").send(text || "{}");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Main platform request failed";
    res.status(502).json({ message });
  }
}

function allowPublicToken(req: Request): boolean {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const current = publicTokenRequests.get(key);
  if (!current || current.resetAt <= now) {
    publicTokenRequests.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 20;
}
