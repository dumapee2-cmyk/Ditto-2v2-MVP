import { Router } from "express";
import { prisma } from "../lib/db.js";

export const shareRouter = Router();

shareRouter.get("/:shortId", async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { short_id: req.params.shortId } });
  if (!agent) return res.status(404).json({ message: "Agent not found" });
  return res.json(agent);
});
