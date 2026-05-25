import { config } from "../config.js";
import type { AgentReply, VoiceContext } from "../types.js";

export async function askPlatformAgent(
  text: string,
  context: VoiceContext
): Promise<AgentReply> {
  const response = await fetch(config.PLATFORM_AGENT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-voice-agent-secret": config.PLATFORM_AGENT_SECRET
    },
    body: JSON.stringify({
      text,
      channel: context.channel,
      sessionId: context.sessionId,
      callerId: context.callerId,
      organizationId: context.organizationId,
      userId: context.userId
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Platform agent failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as Partial<AgentReply>;
  const replyText = typeof data.text === "string" ? data.text.trim() : "";
  if (!replyText) {
    throw new Error("Platform agent returned an empty reply");
  }

  return { text: replyText, metadata: data.metadata };
}
