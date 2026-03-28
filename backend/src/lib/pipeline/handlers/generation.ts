import type { PipelineContext, StateTransition } from "../types.js";
import { generateAgentSpec } from "../../agentCodeGenerator.js";

/**
 * GENERATING state: fallback/retry generation.
 *
 * If planning already produced agent code, pass through.
 * If validation sends us back here (quality gate regen), regenerate with "balanced" profile.
 */
export async function handleGeneration(ctx: PipelineContext): Promise<StateTransition> {
  ctx.onProgress?.({ type: "status", message: "Refining agent code..." });

  // Normal pass-through — planning already produced code
  if (ctx.agentCode && ctx.qualityRegenAttempt === 0) {
    return { nextState: "VALIDATING" };
  }

  // Quality gate regen — validation sent us back for a retry
  if (ctx.intent && ctx.qualityRegenAttempt > 0) {
    ctx.onProgress?.({
      type: "narrative",
      message: `Regenerating agent (attempt ${ctx.qualityRegenAttempt + 1})...`,
    });

    try {
      const result = await generateAgentSpec(ctx.intent, "balanced", ctx.onProgress);
      ctx.agentSpec = result.spec;
      ctx.agentCode = result.rawCode;
      ctx.agentConfig = result.config;
      ctx.agentName = result.spec.name;
      return { nextState: "VALIDATING" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ctx.errors.push({
        state: "GENERATING",
        message: `Regen failed: ${msg}`,
        timestamp: Date.now(),
      });
      // Continue with existing code if any, otherwise fail
      if (ctx.agentCode) {
        return { nextState: "VALIDATING" };
      }
      return { nextState: "FAILED" };
    }
  }

  // No code at all — fail
  ctx.errors.push({
    state: "GENERATING",
    message: "No agent code produced by planning stage",
    timestamp: Date.now(),
  });
  return { nextState: "FAILED" };
}
