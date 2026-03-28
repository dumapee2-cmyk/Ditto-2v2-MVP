import { Router } from "express";
import { ZodError, z } from "zod";
import { generateFromPrompt } from "../lib/generator.js";
import { generateRateLimiter, checkContentSafety } from "../lib/safety.js";
import { canSpend, getDailySpend, getDailyCap } from "../lib/costTracker.js";
import type { ProgressCallback } from "../lib/progressEmitter.js";
import { resolveModel } from "../lib/modelResolver.js";

export const generateRouter = Router();

const generateBodySchema = z.object({
  prompt: z.string().min(10).max(4000),
  model: z.enum(["auto", "gemini", "sonnet", "opus"]).optional().default("auto"),
});

generateRouter.post("/", generateRateLimiter, async (req, res) => {
  try {
    const body = generateBodySchema.parse(req.body);

    const safety = checkContentSafety(body.prompt);
    if (!safety.safe) {
      return res.status(400).json({ message: safety.reason });
    }

    if (!canSpend()) {
      return res.status(429).json({
        message: `Daily API spend cap reached ($${getDailySpend().toFixed(2)} / $${getDailyCap()} limit). Try again tomorrow or raise BIT7_DAILY_SPEND_CAP_USD.`,
      });
    }

    const wantsSSE = req.headers.accept?.includes("text/event-stream");

    if (wantsSSE) {
      // SSE streaming mode
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
      }, 15000);

      const abortController = new AbortController();
      let disconnected = false;
      req.on("close", () => {
        disconnected = true;
        abortController.abort();
        clearInterval(heartbeat);
      });

      const onProgress: ProgressCallback = (event) => {
        if (!disconnected && !res.writableEnded) {
          try {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          } catch (e) {
            disconnected = true;
            console.warn("SSE write failed:", e instanceof Error ? e.message : e);
          }
        }
      };

      try {
        const result = await generateFromPrompt(body.prompt, body.model, onProgress, abortController.signal);
        if (!disconnected) {
          if (result.generated_code) {
            res.write(`data: ${JSON.stringify({
              type: "done",
              message: "Complete",
              data: {
                ...result,
                model_resolved: resolveModel("standard"),
                provider_resolved: "gemini",
              },
            })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify({ type: "error", message: "Generation completed but no agent was produced.", error_code: "NO_CODE_PRODUCED" })}\n\n`);
          }
        }
      } catch (error) {
        if (!disconnected) {
          let msg = "Generation failed";
          let errorCode = "GENERATION_FAILED";
          if (error instanceof ZodError) {
            msg = "Agent configuration error — please try a different prompt";
            errorCode = "VALIDATION_ERROR";
          } else if (error instanceof Error) {
            msg = error.message;
            if (msg.includes("timed out")) errorCode = "PROVIDER_TIMEOUT";
            else if (msg.includes("NO_CODE_PRODUCED")) errorCode = "NO_CODE_PRODUCED";
            else if (msg.includes("connection pool")) errorCode = "DB_CONNECTION_ERROR";
          }
          res.write(`data: ${JSON.stringify({ type: "error", message: msg, error_code: errorCode })}\n\n`);
        }
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
    } else {
      // Standard JSON mode
      const routeTimeoutMs = Number(process.env.BIT7_ROUTE_TIMEOUT_MS ?? 300000);
      const result = await Promise.race([
        generateFromPrompt(body.prompt, body.model),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Generation timed out after ${routeTimeoutMs}ms`)), routeTimeoutMs),
        ),
      ]);
      if (!result.generated_code) {
        return res.status(502).json({ message: "Generation completed but no agent was produced", error_code: "NO_CODE_PRODUCED" });
      }
      return res.status(201).json({
        ...result,
        model_resolved: resolveModel("standard"),
        provider_resolved: "gemini",
      });
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ message: "Invalid request", issues: error.issues });
    }
    if (error instanceof Error && error.message.includes("timed out")) {
      return res.status(504).json({ message: error.message });
    }
    console.error("Generation error:", error);
    return res.status(500).json({ message: "Generation failed" });
  }
});
