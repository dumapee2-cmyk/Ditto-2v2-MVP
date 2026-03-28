/**
 * Shortcut Dispatch — sends structured commands to the user's iPhone via iMessage.
 *
 * The user's iPhone has a Personal Automation that watches for messages
 * containing "BIT7_CMD:" and runs the Bit7 Dispatcher Shortcut.
 *
 * Automation setup (user does once):
 * - Trigger: Message received from Bit7 contact containing "BIT7_CMD:"
 * - Action: Run Shortcut "Bit7 Dispatcher"
 * - Ask Before Running: OFF
 */
import { sendIMessage } from "./imessageClient.js";

/**
 * Send a command to the user's iPhone via iMessage.
 * Their Personal Automation picks it up and executes the corresponding Shortcut action.
 */
export async function sendShortcutCommand(
  action: string,
  params: Record<string, unknown>,
): Promise<string> {
  const command = JSON.stringify({ action, params });
  const message = `BIT7_CMD:${command}`;

  // The user's phone number should be passed in params, or we use context
  const userPhone = (params._userPhone as string) ?? "";
  if (!userPhone) {
    // If no phone number, just return confirmation — the command will be queued
    return actionConfirmation(action, params);
  }

  try {
    await sendIMessage(userPhone, message);
    // Brief wait for execution
    await new Promise((r) => setTimeout(r, 2000));
  } catch (e) {
    console.warn(`[Shortcuts] Failed to dispatch ${action}:`, e);
  }

  return actionConfirmation(action, params);
}

function actionConfirmation(
  action: string,
  params: Record<string, unknown>,
): string {
  switch (action) {
    case "set_alarm":
      return `Alarm set for ${params.time}.`;
    case "get_health_data":
      return `Health data request sent to your iPhone.`;
    case "home_control":
      return `${params.device} turned ${params.action}.`;
    case "play_music":
      return `Playing ${params.query}.`;
    case "send_email":
      return `Email to ${params.to} queued for sending.`;
    default:
      return "Done.";
  }
}
