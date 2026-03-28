import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/db.js";
import { z } from "zod";
import { getUnifiedClient } from "../lib/unifiedClient.js";

export const chatRouter = Router();

const chatRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `chat:${String((req.params as Record<string, string>)["id"] ?? "")}`,
  validate: false,
  message: { message: "Too many AI requests. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatRequestSchema = z.object({
  system: z.string().min(1).max(4000),
  message: z.string().min(1).max(10000),
});

chatRouter.post("/:id/chat", chatRateLimiter, async (req, res) => {
  const id = String(req.params["id"]);

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return res.status(404).json({ message: "Agent not found" });

  let body: z.infer<typeof chatRequestSchema>;
  try {
    body = chatRequestSchema.parse(req.body);
  } catch {
    return res.status(400).json({ message: "Invalid request body" });
  }
  const client = getUnifiedClient();
  const startTime = Date.now();

  try {
    const response = await client.messages.create({
      model: process.env.AI_MODEL_FAST || "gemini-flash-lite-latest",
      max_tokens: 1500,
      system: body.system,
      messages: [{ role: "user", content: body.message }],
    });

    const duration_ms = Date.now() - startTime;
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");

    const tokens_used = response.usage.input_tokens + response.usage.output_tokens;

    return res.json({ text, tokens_used, duration_ms });
  } catch (e) {
    console.error("Chat AI error:", e);
    return res.status(502).json({ message: "AI request failed. Please try again." });
  }
});
