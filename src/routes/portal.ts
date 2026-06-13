import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { verifyVoiceSessionToken } from "../services/sessionToken.js";
import { getOrCreateFlowAudioChunk, isVoiceCacheConfigured } from "../services/voiceFlowAudioCache.js";
import type { VoiceContext } from "../types.js";

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
portalRouter.post("/api/portal/agents/:id/starter-audio", async (req, res) => {
  try {
    if (!isVoiceCacheConfigured()) {
      res.status(400).json({
        message: "Starter audio cache requires DATABASE_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY.",
      });
      return;
    }
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    const input = z.object({ text: z.string().trim().min(1).max(500) }).parse(req.body);
    const tokenResponse = await fetch(`${platformBaseUrl}/api/voice/session-token`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ voiceAgentId: req.params.id, channel: "browser" }),
    });
    const tokenData = await tokenResponse.json() as { token?: string; message?: string };
    if (!tokenResponse.ok || !tokenData.token) {
      res.status(tokenResponse.status).json({ message: tokenData.message || "Could not authorize voice agent" });
      return;
    }

    const claims = verifyVoiceSessionToken(tokenData.token, "browser");
    const context: VoiceContext = {
      channel: "browser",
      sessionId: `widget-starter-${Date.now()}`,
      organizationId: claims.organizationId,
      userId: claims.userId,
      voiceAgentId: claims.voiceAgentId,
      voiceProfileId: claims.voiceProfileId,
    };
    const chunk = await getOrCreateFlowAudioChunk({
      organizationId: claims.organizationId,
      userId: claims.userId,
      flowId: `widget-${claims.voiceAgentId}`,
      flowVersion: 1,
      voiceProfileId: claims.voiceProfileId,
      nodeId: "starter",
      chunkIndex: 0,
      text: input.text,
    }, context);
    res.json({
      audioUrl: chunk.audio.audioUrl,
      mimeType: chunk.audio.mimeType || "audio/mpeg",
      cached: chunk.cached,
      text: input.text,
    });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({ message: error instanceof Error ? error.message : String(error) });
  }
});
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
