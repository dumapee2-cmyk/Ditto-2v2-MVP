import type { PipelineContext, StateTransition } from "../types.js";
import { reasonAgent } from "../../agentReasoner.js";

/**
 * REASONING state: extract structured AgentIntent from user prompt
 * using Kimi K2.5 via agentReasoner.
 */
export async function handleReasoning(ctx: PipelineContext): Promise<StateTransition> {
  ctx.onProgress?.({ type: "status", message: "Designing agent personality..." });

  try {
    const intent = await reasonAgent(
      ctx.prompt,
      ctx.webSearchContext,
      ctx.onProgress,
    );

    ctx.intent = intent;
    ctx.agentName = intent.agent_name;

    ctx.onProgress?.({
      type: "narrative",
      message: `Designed "${intent.agent_name}" — ${intent.domain} agent with ${intent.capabilities.length} capabilities`,
    });

    return { nextState: "PLANNING" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[reasoning] Agent reasoner failed: ${msg}`);

    // Degrade gracefully — build a minimal intent from the prompt
    ctx.degraded = true;
    ctx.intent = {
      agent_name: "SMS Agent",
      domain: "general",
      personality_brief: "A helpful and friendly SMS assistant",
      capabilities: [
        {
          name: "respond",
          description: "Respond to user messages with helpful information",
          trigger_phrases: ["help", "hi", "hello"],
        },
      ],
      input_types: ["text"],
      data_fields: [],
      example_conversations: [],
      tools_needed: [],
    };
    ctx.agentName = ctx.intent.agent_name;

    ctx.errors.push({
      state: "REASONING",
      message: `Reasoner failed, using fallback intent: ${msg}`,
      timestamp: Date.now(),
    });

    return { nextState: "PLANNING" };
  }
}
