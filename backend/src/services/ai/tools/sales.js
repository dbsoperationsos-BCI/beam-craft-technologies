const { likeLiteral } = require("../../wordChunks");
const prisma = require("../../../config/db");
const dataScope = require("../../dataScope.service");

// The session's grant on CRM Leads, on the lead's own reference columns: the same answer the board
// gets, so a tool cannot count what the screen would not list.
const leadScopeFor = (session) => dataScope.resolve({
  userId: session?.userId,
  module: "SALES",
  feature: "CRM Leads",
  columns: { branch: "branchId", employee: "ownerEmployeeId", user: "createdByUserId" },
});
const { getCrmLeadById } = require("../../../modules/sales/crm-leads/crmLeadService");
const { listLeadActivity } = require("../../../modules/sales/crm-leads/activityService");
const { listLeadCallLogs } = require("../../../modules/sales/crm-leads/callLogService");
const transcripts = require("../../../modules/sales/call-transcripts/repository");
const { buildCrmContext, renderCrmContext } = require("../crmContext");
const { redactSecrets } = require("../leadContext");

/**
 * A lead this session may read, or null - the CRM board's own rule: the grant's branch and owner
 * scope (`leadScopeFor`), then the vertical on screen. Out of scope reads as not found, as the
 * board's record endpoints do, so a tool can never confirm that a lead it may not show exists.
 */
async function visibleLead(id, session) {
  const [scope, record] = await Promise.all([leadScopeFor(session), getCrmLeadById(id)]);
  if (!record || !scope.allows(record.lead || {})) return null;
  if (session?.vertical && String(record.lead?.vertical || "").trim() !== session.vertical) return null;
  return record;
}

/**
 * Read-only tools for SALES / CRM Leads.
 *
 * Existing services are reused wherever one exists - `getCrmLeadById`, `listLeadActivity`,
 * `listLeadCallLogs`, the transcript repository - so a tool cannot drift from what the module's own
 * screens do.
 *
 * Searching is the exception, and it is worth saying why. `listCrmLeads()` takes no arguments,
 * loads all thirty-one thousand leads, and will call out to Google Sheets while doing it. That is
 * right for a table that paginates in the browser and impossible for a tool: the rows would go into
 * a prompt. So search is a bounded query written here, against the same table and the same columns,
 * with a limit that cannot be argued upwards.
 *
 * Two rules run through all of it.
 *
 * **Counted, never listed.** "How many leads are overdue" is answered by SQL aggregation, not by
 * fetching rows and counting them in the model's head. `crmContext.js` already does this.
 *
 * **Only the fields the question needs.** A lead row has seventy columns including bank details and
 * addresses. A tool that returns the row returns all of it, into a prompt, for a question about a
 * follow-up date.
 */

// What a search may return, however it is asked. The model does not get to raise this.
const MAX_ROWS = 50;
const DEFAULT_ROWS = 20;

function boundedLimit(value, max = MAX_ROWS) {
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked < 1) return DEFAULT_ROWS;
  return Math.min(Math.floor(asked), max);
}

/** A lead as the assistant needs it: enough to talk about, nothing more. */
function summariseLead(row) {
  return {
    enquiryId: row.enquiry_id ?? row.enquiryId,
    name: String(row.name || "").trim() || null,
    status: String(row.status || "").trim() || null,
    vertical: String(row.vertical || "").trim() || null,
    owner: String(row.crm || "").trim() || null,
    source: String(row.source || "").trim() || null,
    createdDate: String(row.created_date ?? row.createdDate ?? "").trim() || null,
    nextFollowUpDate: String(row.next_follow_up_date ?? row.nextFollowUpDate ?? "").trim() || null,
    eventType: String(row.event_planned_type ?? row.eventPlannedType ?? "").trim() || null,
    eventDate: String(row.event_planned_date ?? row.eventPlannedDate ?? "").trim() || null,
  };
}

const TOOLS = [
  {
    name: "sales.getPipeline",
    module: "SALES",
    risk: "READ",
    // The module's standing summary: run before the question, so figures never have to be guessed.
    summary: true,
    /*
     * Rendered as the same readable page the CRM panel has always used.
     *
     * `renderCrmContext` states one fact per line - "Overdue: 17", "Due today: 0" - because a
     * compound sentence is where this model picks the wrong number out. It is already proven in the
     * lead panel, so the summary and the panel cannot drift.
     */
    renderSummary: (result) => result.rendered || "",
    // The headline only, for a cross-module briefing.
    renderBrief: (result) => [
      `Leads: ${result.leads.total}`,
      `In pipeline: ${result.statuses.known.reduce((sum, row) => sum + row.count, 0)}`,
      `Follow-ups overdue: ${result.followUps.overdue}`,
      `New leads in 30 days: ${result.intake.last30Days}`,
    ].join("\n"),
    description:
      "The state of the CRM as totals: leads by status, follow-ups due and overdue with their owners, "
      + "new leads today and this month, sources, owners, conversions and engagement. Use this for any "
      + "question about how many, rather than searching and counting.",
    schema: { type: "object", properties: {} },
    execute: async (_args, session) => {
      /*
       * Counted for the vertical on screen, not the whole CRM.
       *
       * `buildCrmContext` already filters by branch; the vertical is the CRM's own branch column.
       * Without this, someone on the Qua Qua board asking "how is my pipeline" is told about
       * 31,000 leads that are mostly not theirs.
       */
      const context = await buildCrmContext({ ...(session?.vertical ? { verticals: [session.vertical] } : {}), scope: await leadScopeFor(session), reader: { userId: session?.userId, permissions: { module: "SALES", feature: "CRM Leads" } } });
      return {
        // The readable form travels with the figures, for the pre-fetch path.
        rendered: renderCrmContext(context),
        today: context.today,
        leads: context.leads,
        statuses: context.statuses,
        followUps: {
          overdue: context.followUps.overdue,
          dueToday: context.followUps.dueToday,
          total: context.followUps.total,
          byOwner: context.followUps.byOwner,
        },
        intake: context.intake,
        bySource: context.bySource,
        byOwner: context.byOwner,
        byVertical: context.byBranch,
        conversions: context.conversions,
        engagement: context.engagement,
      };
    },
  },

  {
    name: "sales.searchLeads",
    module: "SALES",
    risk: "READ",
    description:
      "Find leads by name, phone or enquiry id, optionally filtered by status, owner or vertical. "
      + "Returns a bounded list of summaries - use sales.getPipeline for counts.",
    schema: {
      type: "object",
      properties: {
        // Named "search", not "query": an argument called query on a tool reads like SQL in a
        // log, and this takes a fragment of a name. The sibling image-selection tool matches.
        search: { type: "string", description: "Part of a name, phone number or enquiry id." },
        status: { type: "string", description: "CNA, Invalid, Rejected, Interested, Followup, Converted." },
        owner: { type: "string", description: "The CRM owner's name." },
        vertical: { type: "string", description: "Dum Dum, Qua Qua or Corp." },
        limit: { type: "integer", description: `Up to ${MAX_ROWS}; defaults to ${DEFAULT_ROWS}.` },
      },
    },
    execute: async (args, session) => {
      const where = ["deleted_at IS NULL"];
      const values = [];

      const search = String(args.search || "").trim();
      if (search) {
        // Parameterised, always. The model supplies the value and never any part of the statement.
        where.push("(`name` LIKE ? OR `phone` LIKE ? OR `enquiry_id` LIKE ?)");
        // `%`, `_` and `\` in the phrase are matched as themselves, never as wildcards.
        const like = `%${likeLiteral(search)}%`;
        values.push(like, like, like);
      }
      for (const [column, value] of [["status", args.status], ["crm", args.owner]]) {
        const wanted = String(value || "").trim();
        if (wanted) { where.push(`\`${column}\` = ?`); values.push(wanted); }
      }

      /*
       * The session's vertical wins over anything the model asked for.
       *
       * It is the board the person is looking at. A model that decides to search Dum Dum from a Qua
       * Qua session is not being helpful, it is answering about somebody else's work - so the
       * argument is ignored rather than merged.
       */
      const vertical = session?.vertical || String(args.vertical || "").trim();
      if (vertical) { where.push("`vertical` = ?"); values.push(vertical); }

      /*
       * Only the leads this person may see on the board: the grant's branch and owner scope, as SQL
       * on the lead's own reference columns - the same limbs the board's page query carries.
       */
      const scope = (await leadScopeFor(session)).sql({ branch: "`branch_id`", employee: "`owner_employee_id`", user: "`created_by_user_id`" });
      where.push(scope.clause);
      values.push(...scope.params);

      const limit = boundedLimit(args.limit);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT enquiry_id, name, status, vertical, crm, source, created_date, next_follow_up_date,
                event_planned_type, event_planned_date
           FROM sales_crm_lead
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT ${limit}`,
        ...values,
      );

      return {
        // Said explicitly so the model reports "the first 20" rather than implying it saw everything.
        count: rows.length,
        limit,
        truncated: rows.length === limit,
        items: rows.map(summariseLead),
      };
    },
  },

  {
    name: "sales.getLead",
    module: "SALES",
    risk: "READ",
    description: "One lead in full: its details, current status, budget on record and remarks.",
    schema: {
      type: "object",
      properties: { enquiryId: { type: "string", description: "The lead's enquiry id." } },
      required: ["enquiryId"],
    },
    execute: async (args, session) => {
      const id = String(args.enquiryId || "").trim();
      if (!id) throw new Error("An enquiry id is required.");

      // Out of this person's scope, or another vertical: not found, rather than returned.
      const record = await visibleLead(id, session);
      if (!record) return { found: false };

      const lead = record.lead || {};
      const details = record.details || {};
      return {
        found: true,
        lead: summariseLead(lead),
        preferredBudget: lead.preferredBudget || null,
        expectedBudget: lead.expectedBudget || null,
        city: lead.city || null,
        lastFollowUpDate: details.lastFollowUpDate || null,
        // Remarks are free text somebody typed, and people paste things. Cleaned before it can
        // reach a prompt - see `redactSecrets`.
        remarks: (Array.isArray(details.remarkEntries) ? details.remarkEntries : [])
          .slice(-15)
          .map((entry) => ({ text: redactSecrets(String(entry?.text || "").trim()), at: entry?.createdAt || null }))
          .filter((entry) => entry.text),
      };
    },
  },

  {
    name: "sales.getFollowUps",
    module: "SALES",
    risk: "READ",
    description: "Leads whose follow-up date has passed or falls today, oldest first, with their owners.",
    schema: {
      type: "object",
      properties: { limit: { type: "integer", description: `Up to ${MAX_ROWS}; defaults to ${DEFAULT_ROWS}.` } },
    },
    execute: async (args, session) => {
      const context = await buildCrmContext({ ...(session?.vertical ? { verticals: [session.vertical] } : {}), scope: await leadScopeFor(session), reader: { userId: session?.userId, permissions: { module: "SALES", feature: "CRM Leads" } } });
      const limit = boundedLimit(args.limit);
      return {
        overdue: context.followUps.overdue,
        dueToday: context.followUps.dueToday,
        total: context.followUps.total,
        byOwner: context.followUps.byOwner,
        items: context.followUps.oldest.slice(0, limit),
      };
    },
  },

  {
    name: "sales.getLeadActivity",
    module: "SALES",
    risk: "READ",
    description: "What has changed on one lead - status changes, reassignments and edits - newest first.",
    schema: {
      type: "object",
      properties: {
        enquiryId: { type: "string" },
        limit: { type: "integer", description: `Up to ${MAX_ROWS}; defaults to ${DEFAULT_ROWS}.` },
      },
      required: ["enquiryId"],
    },
    execute: async (args, session) => {
      const id = String(args.enquiryId || "").trim();
      if (!id) throw new Error("An enquiry id is required.");
      if (!await visibleLead(id, session)) return { found: false };
      const limit = boundedLimit(args.limit);
      // The module's own service, so the assistant sees exactly what the Activity Logs tab shows.
      const rows = await listLeadActivity(id, limit);
      return {
        count: rows.length,
        items: rows.map((row) => ({
          action: row.action,
          field: row.fieldLabel || row.field || null,
          from: row.fromValue || null,
          to: row.toValue || null,
          by: row.actorName || null,
          at: row.createdAt,
        })),
      };
    },
  },

  {
    name: "sales.getCallLogs",
    module: "SALES",
    risk: "READ",
    description: "Calls made to or from one lead, with who called, how long and the outcome.",
    schema: {
      type: "object",
      properties: {
        enquiryId: { type: "string" },
        limit: { type: "integer", description: `Up to ${MAX_ROWS}; defaults to ${DEFAULT_ROWS}.` },
      },
      required: ["enquiryId"],
    },
    execute: async (args, session) => {
      const id = String(args.enquiryId || "").trim();
      if (!id) throw new Error("An enquiry id is required.");
      if (!await visibleLead(id, session)) return { found: false };
      const limit = boundedLimit(args.limit);
      const rows = await listLeadCallLogs(id, limit);
      return {
        count: rows.length,
        items: rows.map((row) => ({
          type: row.callType,
          at: row.calledAt,
          seconds: row.durationSeconds,
          employee: row.employeeName || null,
          outcome: row.crmStatus || null,
          note: redactSecrets(String(row.note || "").trim()) || null,
        })),
      };
    },
  },

  {
    name: "sales.getCallTranscripts",
    module: "SALES",
    risk: "READ",
    description:
      "Summaries of recorded calls for one lead. Calls held in Tamil or another language are "
      + "machine-translated into English, so expect mis-heard words.",
    schema: {
      type: "object",
      properties: {
        enquiryId: { type: "string" },
        limit: { type: "integer", description: "Up to 10; defaults to 5." },
      },
      required: ["enquiryId"],
    },
    execute: async (args, session) => {
      const id = String(args.enquiryId || "").trim();
      if (!id) throw new Error("An enquiry id is required.");
      if (!await visibleLead(id, session)) return { found: false };
      const limit = boundedLimit(args.limit, 10);
      const rows = await transcripts.listForLead(id, limit);
      return {
        count: rows.length,
        items: rows
          .filter((row) => row.status === "COMPLETED")
          .map((row) => ({
            at: row.createdAt,
            // The summary, never the full transcript: minutes of speech would fill the prompt.
            summary: redactSecrets(String(row.summary || "").trim()) || null,
            outcome: row.callOutcome || null,
            sentiment: row.sentiment || null,
            spokenLanguage: row.language || null,
            translated: Boolean(row.language) && row.language !== "en",
          })),
      };
    },
  },
];

module.exports = { TOOLS, MAX_ROWS, DEFAULT_ROWS, boundedLimit, summariseLead, visibleLead };
