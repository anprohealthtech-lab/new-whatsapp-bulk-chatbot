import { requireDatabase } from "../db.js";
import type { VoiceContext } from "../types.js";
import type { VoiceFlow } from "./flowRunner.js";

interface FlowRow {
  id: string;
  flow_key: string;
  version: number;
  definition: VoiceFlow;
  voice_profile_id: string | null;
}

export async function createVoiceFlowDraft(input: {
  organizationId: string;
  userId: string;
  voiceAgentId?: string;
  flowKey: string;
  name: string;
  description?: string;
  definition: VoiceFlow;
  voiceProfileId?: string;
}): Promise<{ id: string; version: number }> {
  validateFlow(input.definition, input.flowKey);
  const db = requireDatabase();
  const versions = await db<Array<{ version: number }>>`
    SELECT COALESCE(MAX(version), 0)::int AS version
    FROM voice_flows
    WHERE organization_id = ${input.organizationId}
      AND user_id = ${input.userId}
      AND flow_key = ${input.flowKey}
  `;
  const version = Number(versions[0]?.version || 0) + 1;
  const rows = await db<Array<{ id: string; version: number }>>`
    INSERT INTO voice_flows (
      organization_id, user_id, voice_agent_id, flow_key, name, description,
      version, status, start_node, definition, voice_profile_id, updated_at
    ) VALUES (
      ${input.organizationId}, ${input.userId}, ${input.voiceAgentId || null},
      ${input.flowKey}, ${input.name}, ${input.description || null}, ${version},
      'draft', ${input.definition.startNode}, ${JSON.stringify(input.definition)},
      ${input.voiceProfileId || null}, now()
    )
    RETURNING id, version
  `;
  return rows[0];
}

export async function publishVoiceFlow(input: {
  organizationId: string;
  userId: string;
  flowId: string;
}): Promise<boolean> {
  const db = requireDatabase();
  const rows = await db<Array<{ id: string }>>`
    UPDATE voice_flows
    SET status = 'published', published_at = now(), updated_at = now()
    WHERE id = ${input.flowId}
      AND organization_id = ${input.organizationId}
      AND user_id = ${input.userId}
      AND status = 'draft'
    RETURNING id
  `;
  return rows.length === 1;
}

export async function listPublishedVoiceFlows(input: {
  organizationId: string;
  userId: string;
}): Promise<Array<{ id: string; flowKey: string; name: string; version: number }>> {
  const db = requireDatabase();
  const rows = await db<Array<{ id: string; flow_key: string; name: string; version: number }>>`
    SELECT DISTINCT ON (flow_key) id, flow_key, name, version
    FROM voice_flows
    WHERE organization_id = ${input.organizationId}
      AND user_id = ${input.userId}
      AND status = 'published'
    ORDER BY flow_key, version DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    flowKey: row.flow_key,
    name: row.name,
    version: row.version
  }));
}

export async function getPublishedVoiceFlow(
  context: VoiceContext,
  flowKey: string,
  requestedVersion?: number
): Promise<{ flow: VoiceFlow; version: number; voiceProfileId?: string }> {
  const db = requireDatabase();
  const rows = requestedVersion
    ? await db<FlowRow[]>`
        SELECT id, flow_key, version, definition, voice_profile_id
        FROM voice_flows
        WHERE organization_id = ${context.organizationId}
          AND user_id = ${context.userId}
          AND flow_key = ${flowKey}
          AND (${context.voiceAgentId || null}::text IS NULL OR voice_agent_id = ${context.voiceAgentId || null})
          AND version = ${requestedVersion}
          AND status = 'published'
        LIMIT 1
      `
    : await db<FlowRow[]>`
        SELECT id, flow_key, version, definition, voice_profile_id
        FROM voice_flows
        WHERE organization_id = ${context.organizationId}
          AND user_id = ${context.userId}
          AND flow_key = ${flowKey}
          AND (${context.voiceAgentId || null}::text IS NULL OR voice_agent_id = ${context.voiceAgentId || null})
          AND status = 'published'
        ORDER BY version DESC
        LIMIT 1
      `;

  const row = rows[0];
  if (!row) {
    throw new Error(`Published voice flow not found: ${flowKey}`);
  }
  validateFlow(row.definition, flowKey);
  return {
    flow: row.definition,
    version: row.version,
    voiceProfileId: row.voice_profile_id || undefined
  };
}

function validateFlow(flow: VoiceFlow, flowKey: string): void {
  if (!flow || typeof flow !== "object" || !flow.startNode || !flow.nodes) {
    throw new Error(`Voice flow ${flowKey} has an invalid definition`);
  }
  if (!flow.nodes[flow.startNode]) {
    throw new Error(`Voice flow ${flowKey} start node does not exist`);
  }
}
