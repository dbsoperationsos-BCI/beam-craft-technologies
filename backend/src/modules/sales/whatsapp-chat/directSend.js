const { isChatEnabled, isChatEnabledForUser } = require("./repository");
const { MAX_MESSAGE_LENGTH } = require("./security");
const { sendMessageToPerson } = require("./sessionManager");

/**
 * Sending one message, from the signed-in user's own WhatsApp, to somebody who is not a lead.
 *
 * ── Why this exists rather than the lead route ────────────────────────────────────────────────
 *
 * `POST /whatsapp-chat/leads/:id/messages` is the studio writing to a **client**: it needs an
 * enquiry id, it files the message in that lead's thread, and its whole router answers for
 * `SALES / CRM Leads`. None of that fits HR handing a candidate their onboarding link or a new
 * joiner their login - there is no lead, the message must not land in the CRM, and the person
 * sending it holds `HRM / Employee Management`, not CRM Leads.
 *
 * ── What it is deliberately not ───────────────────────────────────────────────────────────────
 *
 * **Not an endpoint.** There is no "send WhatsApp to this number" route anywhere, and there must
 * not be: that is a way for anybody who can sign in to message any number in the world from the
 * studio's own paired account, which is how that account gets banned and how it gets used to spam.
 * This is a function, called by a feature that has already decided *who* it is writing to - and
 * each caller reads the number off the record it is about rather than taking one from the request.
 *
 * ── The two switches ──────────────────────────────────────────────────────────────────────────
 *
 * Both are asked here, so a new caller cannot forget one. The studio-wide switch is how an
 * administrator stops all WhatsApp at once - usually because the number is at risk - and the
 * per-user switch is how they stop one person's. A send that ignored either would be the one
 * message that goes out after somebody pulled the handle.
 */
async function sendWhatsAppToPerson({ userId, phone, body, noNumberMessage = "There is no WhatsApp number to send this to." }) {
  if (!(await isChatEnabled())) {
    const error = new Error("WhatsApp chat is switched off for the studio. An administrator has to switch it back on before anything can be sent.");
    error.status = 403;
    throw error;
  }
  if (!(await isChatEnabledForUser(userId))) {
    const error = new Error("Your WhatsApp chat has been switched off by an administrator.");
    error.status = 403;
    throw error;
  }

  // The number comes from the caller's own record, so an empty one is a record with nothing to
  // send to rather than a bad request - and it is said in the caller's words, because "this
  // candidate has no WhatsApp number" and "this employee has no WhatsApp number" are different
  // things to go and fix.
  if (!String(phone || "").trim()) {
    const error = new Error(noNumberMessage);
    error.status = 400;
    throw error;
  }

  const text = String(body || "").trim();
  if (!text) {
    const error = new Error("Write a message before sending.");
    error.status = 400;
    throw error;
  }
  // Refused here rather than at the socket: WhatsApp would reject it anyway, and a rejected send
  // still counts against an account that is being watched for behaving like a robot.
  if (text.length > MAX_MESSAGE_LENGTH) {
    const error = new Error(`A WhatsApp message cannot be longer than ${MAX_MESSAGE_LENGTH} characters.`);
    error.status = 400;
    throw error;
  }

  return sendMessageToPerson({ userId, phone, body: text });
}

module.exports = { sendWhatsAppToPerson };
