import type { PipelineContext, StateTransition } from "../types.js";
import { generateMultipleCandidates, generateAgentSpec } from "../../agentCodeGenerator.js";
import type { AgentCodeGenResult } from "../../agentCodeGenerator.js";

/**
 * PLANNING state: generate AgentSpec(s) from the reasoned intent.
 *
 * Multi-candidate mode: generates 1-3 candidates in parallel,
 * picks the best one (longest system_prompt as proxy until Phase 3 scorer).
 */
export async function handlePlanning(ctx: PipelineContext): Promise<StateTransition> {
  ctx.onProgress?.({ type: "status", message: "Generating agent logic..." });

  if (!ctx.intent) {
    ctx.errors.push({
      state: "PLANNING",
      message: "No intent available — reasoning must complete first",
      timestamp: Date.now(),
    });
    return { nextState: "FAILED" };
  }

  try {
    const candidateCount = ctx.config.candidateCount;
    let candidates: AgentCodeGenResult[];

    if (candidateCount > 1) {
      candidates = await generateMultipleCandidates(
        ctx.intent,
        candidateCount,
        ctx.onProgress,
      );
    } else {
      const single = await generateAgentSpec(ctx.intent, "balanced", ctx.onProgress);
      candidates = [single];
    }

    // Pick the best candidate — use system_prompt richness as a heuristic
    // (Phase 3 will replace this with real quality scoring)
    const best = candidates.reduce((a, b) =>
      a.spec.system_prompt.length >= b.spec.system_prompt.length ? a : b,
    );

    ctx.agentSpec = best.spec;
    ctx.agentCode = best.rawCode;
    ctx.agentConfig = best.config;
    ctx.agentName = best.spec.name;

    ctx.onProgress?.({
      type: "narrative",
      message: `Generated ${candidates.length} variant${candidates.length > 1 ? "s" : ""}, selected "${best.candidateId}" profile`,
    });

    return { nextState: "GENERATING" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[planning] Agent code generation failed: ${msg}`);

    ctx.errors.push({
      state: "PLANNING",
      message: `Code generation failed: ${msg}`,
      timestamp: Date.now(),
    });

    // If we have intent, try single fallback candidate
    if (!ctx.agentSpec) {
      ctx.degraded = true;
      try {
        const fallback = await generateAgentSpec(ctx.intent!, "balanced", ctx.onProgress);
        ctx.agentSpec = fallback.spec;
        ctx.agentCode = fallback.rawCode;
        ctx.agentConfig = fallback.config;
        ctx.agentName = fallback.spec.name;
        return { nextState: "GENERATING" };
      } catch {
        return { nextState: "FAILED" };
      }
    }

    return { nextState: "FAILED" };
  }
}
