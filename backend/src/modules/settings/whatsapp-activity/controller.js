const { z } = require("zod");
const activity = require("../../../services/whatsappActivity");
const { listGroupFailures } = require("./groupFailures");

/*
 * Settings → User Settings → WhatsApp Activity Log: the HTTP face of `services/whatsappActivity.js`.
 *
 * Reads answer the table, its tiles and one message's attempts; the one write is Resend, which goes
 * back through the service so the eligibility, the claim and the gates are the service's and not
 * repeated here. Everything the service answers is already shaped for a viewer - no raw recipient,
 * no unsafe error - so nothing is filtered on the way out.
 */

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  // Each list filter is what the table's multi-select box reports, comma-joined; the service keeps only known values.
  mode: z.string().trim().max(40).optional(),
  status: z.string().trim().max(120).optional(),
  module: z.string().trim().max(200).optional(),
  trigger: z.string().trim().max(1000).optional(),
  recipient: z.string().trim().max(2000).optional(),
  sender: z.string().trim().max(2000).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  sentFrom: z.string().trim().max(40).optional(),
  sentTo: z.string().trim().max(40).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const resendSchema = z.object({ confirmAmbiguous: z.boolean().optional() });
const facetsSchema = z.object({ column: z.enum(activity.FACET_COLUMNS) });

function answerError(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
  console.error(`[whatsapp-activity] ${fallback}:`, error);
  return res.status(500).json({ message: fallback });
}

async function list(req, res) {
  const parsed = listSchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "Those filters are not understood.", errors: parsed.error.flatten() });
  try {
    const result = await activity.list(parsed.data);
    return res.json(result);
  } catch (error) {
    return answerError(res, error, "Unable to load the WhatsApp activity log.");
  }
}

async function summary(req, res) {
  const parsed = listSchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "Those filters are not understood.", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await activity.summary(parsed.data) });
  } catch (error) {
    return answerError(res, error, "Unable to count the WhatsApp activity.");
  }
}

function options(_req, res) {
  return res.json({ data: activity.options() });
}

/** The values one filter box may offer: those the log holds, with the labels the table shows. */
async function facets(req, res) {
  const parsed = facetsSchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "That column has no list to offer.", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await activity.facets(parsed.data.column) });
  } catch (error) {
    return answerError(res, error, "Unable to list the values for that column.");
  }
}

async function detail(req, res) {
  try {
    return res.json({ data: await activity.detail(String(req.params.id || "")) });
  } catch (error) {
    return answerError(res, error, "Unable to load this message.");
  }
}

async function resend(req, res) {
  const parsed = resendSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "That request is not understood.", errors: parsed.error.flatten() });
  try {
    const result = await activity.resend(String(req.params.id || ""), { requestedByUserId: req.user.id, confirmAmbiguous: Boolean(parsed.data.confirmAmbiguous) });
    const message = result.sent ? "Sent again." : result.queued ? "Queued to be sent again." : `Not sent: ${result.failure?.reason || "the send failed"}.`;
    return res.json({ message, data: result.activity, sent: result.sent, queued: result.queued });
  } catch (error) {
    return answerError(res, error, "Unable to send this message again.");
  }
}

/**
 * The messages waiting on a WhatsApp group, for the notice above the log.
 *
 * Grouped by the job rather than by the message: one project with six shoots is six failed messages
 * and one thing to fix. Each group carries where its messages' Retry lives and the permission that
 * guards it, so the notice draws a button only for somebody who may actually press it.
 */
async function groupFailures(req, res) {
  try {
    return res.json({ data: await listGroupFailures({ user: req.user }) });
  } catch (error) {
    return answerError(res, error, "Unable to read the messages waiting on a WhatsApp group.");
  }
}

module.exports = { list, summary, options, facets, detail, resend, groupFailures, listSchema, resendSchema, facetsSchema };
