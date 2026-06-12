import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { splitIntoVoicePhrases } from "../services/flowRunner.js";
import { getPublishedVoiceFlow, listPublishedVoiceFlows } from "../services/flowRepository.js";
import { getOrCreateFlowAudioChunk, isVoiceCacheConfigured, listFlowAudioChunks } from "../services/voiceFlowAudioCache.js";
import type { VoiceContext } from "../types.js";

export const voiceFlowCacheRouter = Router();

const tenantSchema = z.object({
  organizationId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  flowId: z.string().trim().default("health_camp_reminder")
});

voiceFlowCacheRouter.get("/api/voice-flows", async (req, res) => {
  try {
    requireCacheAdmin(req.headers.authorization);
    const params = tenantSchema.omit({ flowId: true }).parse(req.query);
    const flows = await listPublishedVoiceFlows(params);
    res.json({ flows, cacheConfigured: isVoiceCacheConfigured() });
  } catch (error) {
    sendRouteError(res, error);
  }
});

voiceFlowCacheRouter.get("/api/voice-flow-audio", async (req, res) => {
  try {
    requireCacheAdmin(req.headers.authorization);
    const params = tenantSchema.parse(req.query);
    const chunks = await listFlowAudioChunks(params);
    res.json({ chunks });
  } catch (error) {
    sendRouteError(res, error);
  }
});

voiceFlowCacheRouter.post("/api/voice-flow-audio/generate", async (req, res) => {
  try {
    requireCacheAdmin(req.headers.authorization);
    if (!isVoiceCacheConfigured()) {
      return res.status(400).json({
        message: "Voice audio cache is not configured. Set DATABASE_URL, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY."
      });
    }

    const params = tenantSchema.parse(req.body);
    const context: VoiceContext = {
      channel: "browser",
      sessionId: `cache-${Date.now()}`,
      organizationId: params.organizationId,
      userId: params.userId
    };
    const published = await getPublishedVoiceFlow(context, params.flowId);
    const flow = published.flow;
    context.flowId = flow.id;
    context.flowVersion = published.version;
    context.voiceProfileId = published.voiceProfileId;

    const generated = [];
    for (const node of Object.values(flow.nodes)) {
      const text = node.type === "speak" ? node.text : node.type === "listen" ? node.prompt : "";
      if (!text) continue;

      const phrases = splitIntoVoicePhrases(text);
      for (let chunkIndex = 0; chunkIndex < phrases.length; chunkIndex++) {
        const startedAt = Date.now();
        const chunk = await getOrCreateFlowAudioChunk({
          organizationId: params.organizationId,
          userId: params.userId,
          flowId: flow.id,
          flowVersion: published.version,
          voiceProfileId: published.voiceProfileId,
          nodeId: node.id,
          chunkIndex,
          text: phrases[chunkIndex]
        }, context);

        generated.push({
          nodeId: node.id,
          chunkIndex,
          text: phrases[chunkIndex],
          cached: chunk.cached,
          audioUrl: chunk.audio.audioUrl,
          mimeType: chunk.audio.mimeType,
          elapsedMs: Date.now() - startedAt
        });
      }
    }

    res.json({ flowId: flow.id, generated });
  } catch (error) {
    sendRouteError(res, error);
  }
});

function requireCacheAdmin(authorizationHeader: string | undefined): void {
  if (!config.VOICE_CACHE_ADMIN_TOKEN) return;
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "").trim();
  if (token !== config.VOICE_CACHE_ADMIN_TOKEN) {
    const error = new Error("Invalid voice cache admin token");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
}

function sendRouteError(res: import("express").Response, error: unknown): void {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status: unknown }).status)
    : error instanceof z.ZodError
      ? 400
      : 500;
  const message = error instanceof Error ? error.message : String(error);
  res.status(status || 500).json({ message });
}
