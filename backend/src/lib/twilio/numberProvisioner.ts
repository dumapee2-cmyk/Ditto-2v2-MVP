/**
 * Number Provisioner — buys, assigns, and releases Twilio phone numbers
 * for SMS agents.
 */
import { getClient } from "./twilioClient.js";
import { prisma } from "../db.js";

const WEBHOOK_BASE_URL = process.env.TWILIO_WEBHOOK_BASE_URL ?? "https://localhost:4000";

export interface ProvisionResult {
  phoneNumber: string;
  sid: string;
}

/**
 * Provision a new phone number for an agent.
 * 1. Buy a number from Twilio with SMS capability
 * 2. Configure the webhook URL
 * 3. Save to PhoneNumber table and update Agent record
 */
export async function provisionNumber(agentId: string): Promise<ProvisionResult> {
  const client = getClient();

  // Check agent exists and doesn't already have a number
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent.phone_number) throw new Error(`Agent ${agentId} already has number ${agent.phone_number}`);

  // Check for an available pre-purchased number
  const available = await prisma.phoneNumber.findFirst({
    where: { status: "available", agent_id: null },
  });

  let phoneNumber: string;
  let sid: string;

  if (available) {
    // Reuse existing number
    phoneNumber = available.number;
    sid = available.sid;

    // Update webhook URL
    await client.incomingPhoneNumbers(sid).update({
      smsUrl: `${WEBHOOK_BASE_URL}/api/webhook/twilio`,
      smsMethod: "POST",
    });

    await prisma.phoneNumber.update({
      where: { id: available.id },
      data: { agent_id: agentId, status: "assigned" },
    });
  } else {
    // Buy a new number
    const numbers = await client.availablePhoneNumbers("US").local.list({
      smsEnabled: true,
      limit: 1,
    });

    if (numbers.length === 0) {
      throw new Error("No phone numbers available for purchase");
    }

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: numbers[0].phoneNumber,
      smsUrl: `${WEBHOOK_BASE_URL}/api/webhook/twilio`,
      smsMethod: "POST",
    });

    phoneNumber = purchased.phoneNumber;
    sid = purchased.sid;

    await prisma.phoneNumber.create({
      data: {
        number: phoneNumber,
        sid,
        agent_id: agentId,
        status: "assigned",
      },
    });
  }

  // Update agent with phone number and activate
  await prisma.agent.update({
    where: { id: agentId },
    data: { phone_number: phoneNumber, active: true },
  });

  return { phoneNumber, sid };
}

/**
 * Release a phone number from an agent.
 * Does NOT delete the Twilio number — marks it as available for reuse.
 */
export async function releaseNumber(agentId: string): Promise<void> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent?.phone_number) return;

  // Mark phone number as available
  await prisma.phoneNumber.updateMany({
    where: { agent_id: agentId },
    data: { agent_id: null, status: "available" },
  });

  // Deactivate agent
  await prisma.agent.update({
    where: { id: agentId },
    data: { phone_number: null, active: false },
  });
}
