import type { PipelineContext, StateTransition } from "../types.js";
import { reviewAgent } from "../../agentReviewer.js";
import { repairAgentSpec } from "../../agentCodeRepair.js";

/** Maximum repair attempts before accepting with issues. */
const MAX_REPAIR_ATTEMPTS = 1;

/**
 * REVIEWING state: three-layer review (static + simulated conversation + LLM critic)
 * with targeted repair for critical issues.
 */
export async function handleReview(ctx: PipelineContext): Promise<StateTransition> {
  ctx.onProgress?.({ type: "status", message: "Testing conversations..." });

  if (!ctx.config.enableReview) {
    ctx.reviewResult = { passed: true, issues: [], criticalCount: 0, warningCount: 0 };
    return { nextState: "FINALIZING" };
  }

  if (!ctx.agentSpec || !ctx.agentCode) {
    ctx.errors.push({
      state: "REVIEWING",
      message: "No agent spec/code to review",
      timestamp: Date.now(),
    });
    return { nextState: "FAILED" };
  }

  try {
    const result = await reviewAgent(ctx.agentSpec, ctx.onProgress);
    ctx.reviewResult = result;

    ctx.onProgress?.({
      type: "narrative",
      message: `Review: ${result.criticalCount} critical, ${result.warningCount} warnings, ${result.issues.length - result.criticalCount - result.warningCount} info`,
    });

    // Attempt repair if there are critical issues and we have budget
    if (result.criticalCount > 0 && ctx.reviewRepairAttempt < MAX_REPAIR_ATTEMPTS) {
      ctx.reviewRepairAttempt += 1;

      ctx.onProgress?.({
        type: "narrative",
        message: `Found ${result.criticalCount} critical issue${result.criticalCount > 1 ? "s" : ""}, attempting repair...`,
      });

      const repairResult = await repairAgentSpec(
        ctx.agentSpec,
        result.issues,
        ctx.onProgress,
      );

      if (repairResult.fixedIssues.length > 0) {
        ctx.agentSpec = repairResult.spec;
        ctx.agentCode = repairResult.rawCode;

        ctx.onProgress?.({
          type: "narrative",
          message: `Repaired ${repairResult.fixedIssues.length} issue${repairResult.fixedIssues.length > 1 ? "s" : ""}`,
        });

        // Update pipeline summary
        if (ctx.pipelineSummary) {
          ctx.pipelineSummary += ` [repaired ${repairResult.fixedIssues.length} issues]`;
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[review] Agent review failed: ${msg}`);
    ctx.errors.push({
      state: "REVIEWING",
      message: `Review failed: ${msg}`,
      timestamp: Date.now(),
    });
    // Continue without review — don't block the pipeline
    ctx.reviewResult = { passed: true, issues: [], criticalCount: 0, warningCount: 0 };
  }

  return { nextState: "FINALIZING" };
}
