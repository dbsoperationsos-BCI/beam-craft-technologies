const prisma = require("../../config/db");
const { getCrmLeadById, listCrmLeadProjects } = require("../../modules/sales/crm-leads/crmLeadService");
const { listLeadActivity } = require("../../modules/sales/crm-leads/activityService");
const { listLeadCallLogs } = require("../../modules/sales/crm-leads/callLogService");
const transcripts = require("../../modules/sales/call-transcripts/repository");
const { leadValue, daysBetween } = require("./money");
const { verticalFor } = require("./verticals");

/**
 * Everything about one lead that the model is allowed to see, and nothing else.
 *
 * Two rules shape this.
 *
 * One lead only. Every query below is filtered by that lead's enquiry id, so an analysis of one
 * client can never be answered using another client's conversation. That is a privacy property,
 * not a performance one, and it is why nothing here takes a list.
 *
 * Bounded. A lead with two hundred WhatsApp messages and forty calls would produce a prompt no
 * small model can hold, and the tail of it would be silently dropped by whatever ran out of room
 * first. The caps below are chosen so the most recent and most useful material survives, and the
 * counts are reported so the model knows it is seeing a window rather than the whole history.
 *
 * The numbers are computed in `money.js` and handed over as results. The model is never asked to
 * add anything up.
 */

// Enough for a picture of the relationship, small enough for a 1.7B model's context.
const LIMITS = {
  activity: 25,
  callLogs: 15,
  transcripts: 5,
  transcriptChars: 4000,
  whatsapp: 40,
  remarks: 15,
};

/** The WhatsApp thread on this lead, if the studio has one. */
async function whatsappMessages(enquiryId) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT `direction`, `body`, `mediaType`, `sentAt` FROM `SalesCrmWhatsAppMessage`" +
      " WHERE `enquiryId` = ? AND (`revokedAt` IS NULL) ORDER BY `sentAt` DESC LIMIT ?",
      String(enquiryId), LIMITS.whatsapp,
    );
    // Newest first out of the database, oldest first into the prompt: a conversation reads forwards.
    return rows.reverse().map((row) => ({
      from: row.direction === "OUT" ? "studio" : "client",
      text: redactSecrets(String(row.body || "").trim()) || (row.mediaType ? `[${row.mediaType}]` : ""),
      at: row.sentAt,
    })).filter((message) => message.text);
  } catch {
    // The WhatsApp tables are created at runtime; a studio that has never paired has none of them.
    // That is an absence, not a failure.
    return [];
  }
}

/*
 * Credentials, taken out before anything is sent to a model.
 *
 * People paste things into WhatsApp. A `.env` file turned up in a real lead's thread here, database
 * password and JWT secret included, and the context builder would have forwarded it verbatim.
 *
 * With Ollama that stays on this machine, which is one of the reasons to run it locally - but the
 * provider is a setting, and the day it points at a hosted model the same thread would leave the
 * building. Redacting at the source means neither engine ever sees it.
 *
 * Deliberately blunt: a false positive costs the model a line of context it did not need, and a
 * miss costs a credential.
 */
const SECRET_PATTERNS = [
  // KEY="value" / KEY=value, for the names that carry secrets.
  /\b([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)[A-Z0-9_]*)\s*=\s*\S+/gi,
  // Any connection string with a password in its authority.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@\S+/gi,
  // A PEM block, however it is wrapped.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Long hex, which is what every secret in this project looks like.
  /\b[0-9a-f]{40,}\b/gi,
];

function redactSecrets(text) {
  let out = String(text || "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}

/** The remarks already on the lead, newest last so they read as a running note. */
function remarksFrom(details) {
  const entries = Array.isArray(details?.remarkEntries) ? details.remarkEntries : [];
  return entries
    .slice(-LIMITS.remarks)
    .map((entry) => ({ text: redactSecrets(String(entry?.text || "").trim()), at: entry?.createdAt || "" }))
    .filter((entry) => entry.text);
}

/**
 * One lead, assembled for the model.
 *
 * Throws when the lead does not exist, so a caller cannot quietly analyse nothing.
 */
async function buildLeadContext(enquiryId) {
  const id = String(enquiryId || "").trim();
  if (!id) throw new Error("A lead id is required.");

  const record = await getCrmLeadById(id);
  if (!record) throw new Error("That lead no longer exists.");

  const [activity, callLogs, callTranscripts, projects, whatsapp] = await Promise.all([
    listLeadActivity(id, LIMITS.activity).catch(() => []),
    // By the client's number as well as the lead's id, so the assistant sees the same call history
    // the Call Logs tab shows - including calls that reached the CRM before this lead existed.
    listLeadCallLogs(id, { limit: LIMITS.callLogs, phone: record.lead?.contactNumber || record.lead?.phone || "" }).catch(() => []),
    transcripts.listForLead(id, LIMITS.transcripts).catch(() => []),
    listCrmLeadProjects(id).catch(() => []),
    whatsappMessages(id),
  ]);

  const lead = record.lead || {};
  const details = record.details || {};

  // Counted here, not by the model: "no contact for 12 days" is a fact or it is nothing.
  const lastCall = callLogs[0]?.calledAt || null;
  const daysSinceLastCall = lastCall ? daysBetween(lastCall) : null;

  return {
    lead: {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      // Corp leads carry an address on the row; wedding and newborn leads generally do not, so a
      // meeting request usually supplies one in the message. Either is fine - see meetingIntent.
      email: lead.officialEmailId || "",
      vertical: lead.vertical,
      status: details.leadStatus || lead.status || "",
      crm: lead.crm,
      source: lead.source,
      referredFrom: lead.referredFrom,
      createdDate: lead.createdDate,
      eventPlannedType: lead.eventPlannedType,
      eventPlannedDate: lead.eventPlannedDate,
      city: lead.city,
      contactRepeated: lead.contactRepeated,
      nextFollowUpDate: details.nextFollowUpDate || "",
      lastFollowUpDate: details.lastFollowUpDate || "",
    },
    // Every figure already worked out. The model reads them; it does not compute them.
    money: leadValue({
      preferredBudget: lead.preferredBudget,
      expectedBudget: lead.expectedBudget,
      projects,
    }),
    timing: { lastCallAt: lastCall, daysSinceLastCall },
    remarks: remarksFrom(details),
    activity: activity.slice(0, LIMITS.activity).map((row) => ({
      action: row.action, field: row.fieldLabel || row.field || "",
      from: row.fromValue || "", to: row.toValue || "", by: row.actorName || "", at: row.createdAt,
    })),
    callLogs: callLogs.map((row) => ({
      type: row.callType, at: row.calledAt, seconds: row.durationSeconds,
      employee: row.employeeName || "", note: row.note || "", outcome: row.crmStatus || "",
    })),
    transcripts: callTranscripts
      .filter((row) => row.status === "COMPLETED" && row.summary)
      .map((row) => ({
        at: row.createdAt, summary: row.summary, outcome: row.callOutcome || "",
        sentiment: row.sentiment || "", language: row.language || "",
      })),
    whatsapp,
    projects: projects.map((project) => ({
      eventId: project.eventId, name: project.whatsappGroupName || "",
      status: project.status, createdAt: project.createdAt,
    })),
    // So the model knows it is looking through a window rather than at everything.
    counts: {
      activity: activity.length, callLogs: callLogs.length,
      transcripts: callTranscripts.length, whatsapp: whatsapp.length, projects: projects.length,
    },
  };
}

/**
 * The context as text for the prompt.
 *
 * Compact on purpose: a 1.7B model has a small window, and JSON braces spend it on punctuation.
 * Empty sections are left out entirely rather than sent as "none" - a heading with nothing under
 * it invites the model to invent something to put there.
 */
function renderLeadContext(context) {
  const lines = [];
  const push = (heading, body) => { if (body) lines.push(`## ${heading}\n${body}`); };

  const lead = context.lead;
  const vertical = verticalFor(lead.vertical);
  push("Lead", [
    `Name: ${lead.name || "unknown"}`,
    `Status: ${lead.status || "unset"}`,
    // The vertical says what this lead is even for. Spelled out rather than left as a branch name
    // the model would have to interpret - "Qua Qua" means nothing to it on its own.
    vertical ? `Vertical: ${vertical.name} - ${vertical.shoots} only` : (lead.vertical && `Vertical: ${lead.vertical}`),
    lead.crm && `Handled by: ${lead.crm}`,
    lead.source && `Source: ${lead.source}`,
    lead.createdDate && `Created: ${lead.createdDate}`,
    lead.eventPlannedType && `Event: ${lead.eventPlannedType}`,
    lead.eventPlannedDate && `Event date: ${lead.eventPlannedDate}`,
    lead.city && `Location: ${lead.city}`,
    lead.nextFollowUpDate && `Next follow-up: ${lead.nextFollowUpDate}`,
  ].filter(Boolean).join("\n"));

  const money = context.money.formatted;
  push("Budget on record", [
    money.preferredBudget && `Preferred: ${money.preferredBudget}`,
    money.expectedBudget && `Expected: ${money.expectedBudget}`,
    money.convertedTotal && `Converted so far: ${money.convertedTotal} across ${context.money.convertedCount} project(s)`,
  ].filter(Boolean).join("\n"));

  if (context.timing.daysSinceLastCall !== null) {
    push("Timing", `Last call was ${context.timing.daysSinceLastCall} day(s) ago.`);
  }

  push("Remarks", context.remarks.map((entry) => `- ${entry.text}`).join("\n"));
  push("Calls", context.callLogs.map((call) =>
    `- ${call.type || "Call"} ${call.seconds ? `${call.seconds}s` : ""} by ${call.employee || "unknown"}${call.note ? `: ${call.note}` : ""}`).join("\n"));
  push("Call transcripts", context.transcripts
    .map((row) => `- ${row.summary}${row.outcome ? ` (outcome: ${row.outcome})` : ""}`)
    .join("\n").slice(0, LIMITS.transcriptChars));
  push("WhatsApp", context.whatsapp.map((message) => `${message.from}: ${message.text}`).join("\n"));
  push("Converted projects", context.projects.map((project) => `- ${project.eventId} ${project.name} (${project.status})`).join("\n"));

  return lines.join("\n\n");
}

module.exports = { buildLeadContext, renderLeadContext, redactSecrets, LIMITS };
