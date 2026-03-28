import type { PipelineContext, StateTransition } from "../types.js";
import { classifyIntent } from "./intentClassifier.js";

/**
 * INTAKE state: validate the prompt, classify intent, check safety, verify cost budget.
 */
export async function handleIntake(ctx: PipelineContext): Promise<StateTransition> {
  ctx.onProgress?.({ type: "status", message: "Validating request..." });

  // Validate prompt length
  if (!ctx.prompt || ctx.prompt.trim().length < 10) {
    ctx.errors.push({
      state: "INTAKE",
      message: "Prompt too short (minimum 10 characters)",
      timestamp: Date.now(),
    });
    return { nextState: "FAILED" };
  }

  if (ctx.prompt.length > 4000) {
    ctx.errors.push({
      state: "INTAKE",
      message: "Prompt too long (maximum 4000 characters)",
      timestamp: Date.now(),
    });
    return { nextState: "FAILED" };
  }

  // Cost budget check
  try {
    const { getDailySpend, getDailyCap } = await import("../../costTracker.js");
    const spent = getDailySpend();
    const cap = getDailyCap();
    if (spent >= cap) {
      ctx.errors.push({
        state: "INTAKE",
        message: `Daily spend cap reached ($${spent.toFixed(2)} / $${cap.toFixed(2)})`,
        timestamp: Date.now(),
      });
      return { nextState: "FAILED" };
    }
  } catch {
    // Cost tracking not available — proceed anyway
  }

  // Intent classification (lightweight Haiku call)
  const classified = await classifyIntent(ctx.prompt);
  console.log(`Intent: ${classified.classification} (confidence: ${classified.confidence}), constraints: [${classified.constraints.join(', ')}]`);

  switch (classified.classification) {
    case "build_new":
      return { nextState: "RESEARCHING" };

    case "modify_existing":
      // Still proceed — the generator will build something new based on the prompt
      // The frontend can use this signal to suggest refinement instead
      console.warn("Modification request detected — proceeding as build_new");
      return { nextState: "RESEARCHING" };

    case "ambiguous":
      // Too vague — but we still try (the reasoner may clarify)
      console.warn("Ambiguous prompt — proceeding with best effort");
      ctx.onProgress?.({ type: "status", message: "Interpreting request..." });
      return { nextState: "RESEARCHING" };

    case "out_of_scope":
      ctx.errors.push({
        state: "INTAKE",
        message: classified.rejection_reason ?? "This doesn't appear to be an SMS agent request. Try describing what kind of agent you'd like to build.",
        timestamp: Date.now(),
      });
      return { nextState: "FAILED" };

    default:
      return { nextState: "RESEARCHING" };
  }
}
