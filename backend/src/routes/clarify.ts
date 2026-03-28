import { Router } from "express";
import { z } from "zod";
import { clarifyPrompt } from "../lib/clarifier.js";

export const clarifyRouter = Router();

const clarifyBodySchema = z.object({
  prompt: z.string().min(1).max(4000),
});

clarifyRouter.post("/", async (req, res) => {
  try {
    const body = clarifyBodySchema.parse(req.body);
    const result = await clarifyPrompt(body.prompt);
    return res.json(result);
  } catch (error) {
    console.error("Clarify error:", error);
    // On failure, just treat as clear so the user can proceed
    return res.json({ clear: true });
  }
});
