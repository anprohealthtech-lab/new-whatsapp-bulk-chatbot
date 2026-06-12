import crypto from "node:crypto";
import { config } from "../config.js";
import type { VoiceContext } from "../types.js";

interface VoiceSessionClaims {
  organizationId: string;
  userId: string;
  voiceAgentId: string;
  flowId?: string;
  flowVersion?: number;
  voiceProfileId?: string;
  channel?: VoiceContext["channel"];
  type: "voice_session";
  iss?: string;
  aud?: string | string[];
  exp: number;
}

export function verifyVoiceSessionToken(token: string, expectedChannel: VoiceContext["channel"]): VoiceSessionClaims {
  const secret = config.VOICE_SESSION_TOKEN_SECRET || config.PLATFORM_AGENT_SECRET;
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Voice session token is malformed");

  const [headerValue, payloadValue, signatureValue] = parts;
  const header = JSON.parse(Buffer.from(headerValue, "base64url").toString("utf8")) as { alg?: string };
  if (header.alg !== "HS256") throw new Error("Voice session token algorithm is not supported");

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${headerValue}.${payloadValue}`)
    .digest();
  const actualSignature = Buffer.from(signatureValue, "base64url");
  if (
    actualSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error("Voice session token signature is invalid");
  }

  const claims = JSON.parse(Buffer.from(payloadValue, "base64url").toString("utf8")) as VoiceSessionClaims;
  if (claims.type !== "voice_session") throw new Error("Invalid voice session token type");
  if (claims.iss !== "anpro-main-app") throw new Error("Invalid voice session token issuer");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes("voice-agent-service")) throw new Error("Invalid voice session token audience");
  if (!claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Voice session token has expired");
  if (!claims.organizationId || !claims.userId || !claims.voiceAgentId) {
    throw new Error("Voice session token is missing tenant claims");
  }
  if (claims.channel && claims.channel !== expectedChannel) {
    throw new Error("Voice session token channel does not match");
  }
  return claims;
}
