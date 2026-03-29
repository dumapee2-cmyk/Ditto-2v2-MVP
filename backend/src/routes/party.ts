/**
 * Party API — double date lobby system
 *
 * POST   /api/party           — create a new party (after a match is made)
 * GET    /api/party/:code      — get party state by code
 * POST   /api/party/:code/join — join an open slot
 */
import { Router } from "express";
import { prisma } from "../lib/db.js";

export const partyRouter = Router();

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// ---------------------------------------------------------------------------
// POST / — create a new party with two matched hosts
// ---------------------------------------------------------------------------
partyRouter.post("/", async (req, res) => {
  try {
    const { guy_name, guy_phone, girl_name, girl_phone } = req.body;

    if (!guy_name || !guy_phone || !girl_name || !girl_phone) {
      return res.status(400).json({ ok: false, error: "guy_name, guy_phone, girl_name, girl_phone required" });
    }

    const guyNorm = normalizePhone(guy_phone);
    const girlNorm = normalizePhone(girl_phone);
    if (!guyNorm || !girlNorm) {
      return res.status(400).json({ ok: false, error: "invalid phone number" });
    }

    // Generate unique code
    let code = generateCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.party.findUnique({ where: { code } });
      if (!existing) break;
      code = generateCode();
      attempts++;
    }

    const party = await prisma.party.create({
      data: {
        code,
        slots: {
          create: [
            { role: "guy", is_host: true, name: guy_name.trim(), phone: guyNorm, filled: true, position: 0 },
            { role: "guy", is_host: false, filled: false, position: 1 },
            { role: "girl", is_host: true, name: girl_name.trim(), phone: girlNorm, filled: true, position: 2 },
            { role: "girl", is_host: false, filled: false, position: 3 },
          ],
        },
      },
      include: { slots: { orderBy: { position: "asc" } } },
    });

    console.log(`[Party] Created party ${code} — ${guy_name} + ${girl_name}`);

    return res.json({
      ok: true,
      code: party.code,
      party: sanitizeParty(party),
    });
  } catch (e) {
    console.error("[Party] Create error:", e);
    return res.status(500).json({ ok: false, error: "something went wrong" });
  }
});

// ---------------------------------------------------------------------------
// GET /:code — get party state
// ---------------------------------------------------------------------------
partyRouter.get("/:code", async (req, res) => {
  const party = await prisma.party.findUnique({
    where: { code: req.params.code.toUpperCase() },
    include: { slots: { orderBy: { position: "asc" } } },
  });

  if (!party) {
    return res.status(404).json({ ok: false, error: "party not found" });
  }

  return res.json({ ok: true, party: sanitizeParty(party) });
});

// ---------------------------------------------------------------------------
// POST /:code/join — join an open slot
// ---------------------------------------------------------------------------
partyRouter.post("/:code/join", async (req, res) => {
  try {
    const { name, phone, role } = req.body;

    if (!name || !phone || !role) {
      return res.status(400).json({ ok: false, error: "name, phone, and role required" });
    }

    if (role !== "guy" && role !== "girl") {
      return res.status(400).json({ ok: false, error: "role must be 'guy' or 'girl'" });
    }

    const normalized = normalizePhone(phone);
    if (!normalized) {
      return res.status(400).json({ ok: false, error: "invalid phone number" });
    }

    const party = await prisma.party.findUnique({
      where: { code: req.params.code.toUpperCase() },
      include: { slots: { orderBy: { position: "asc" } } },
    });

    if (!party) {
      return res.status(404).json({ ok: false, error: "party not found" });
    }

    if (party.status === "full") {
      return res.status(400).json({ ok: false, error: "party is already full" });
    }

    // Check if phone already in this party
    const alreadyIn = party.slots.some(s => s.phone === normalized);
    if (alreadyIn) {
      return res.status(409).json({ ok: false, error: "you're already in this party" });
    }

    // Find open slot for the role
    const openSlot = party.slots.find(s => s.role === role && !s.filled);
    if (!openSlot) {
      return res.status(400).json({ ok: false, error: `no open ${role} slot` });
    }

    // Fill the slot
    await prisma.partySlot.update({
      where: { id: openSlot.id },
      data: { name: name.trim(), phone: normalized, filled: true },
    });

    // Check if party is now full
    const updatedSlots = await prisma.partySlot.findMany({
      where: { party_id: party.id },
      orderBy: { position: "asc" },
    });
    const allFilled = updatedSlots.every(s => s.filled);

    if (allFilled) {
      await prisma.party.update({
        where: { id: party.id },
        data: { status: "full" },
      });
    }

    const updatedParty = await prisma.party.findUnique({
      where: { id: party.id },
      include: { slots: { orderBy: { position: "asc" } } },
    });

    console.log(`[Party] ${name} joined party ${party.code} as ${role}`);

    return res.json({ ok: true, party: sanitizeParty(updatedParty!) });
  } catch (e) {
    console.error("[Party] Join error:", e);
    return res.status(500).json({ ok: false, error: "something went wrong" });
  }
});

// Strip phone numbers from public responses (only show first name + filled status)
function sanitizeParty(party: any) {
  return {
    code: party.code,
    status: party.status,
    created_at: party.created_at,
    slots: party.slots.map((s: any) => ({
      position: s.position,
      role: s.role,
      is_host: s.is_host,
      name: s.name,
      filled: s.filled,
    })),
  };
}
