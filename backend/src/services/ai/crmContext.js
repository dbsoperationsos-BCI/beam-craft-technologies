const prisma = require("../../config/db");
const { listAllMeetings } = require("../../modules/sales/crm-meetings/service");
const { projectAccessWhere } = require("../projectScope");
const { formatAmount, parseAmount, daysBetween } = require("./money");

/**
 * The CRM as a whole, for the questions that are not about one lead.
 *
 * `leadContext.js` answers "what should I do with Priya?". This answers "how is the pipeline
 * doing?", "who has the most follow-ups overdue?", "where are leads actually coming from?" - the
 * questions about the module rather than a row in it.
 *
 * Two things shape it, and they are the same two that shape the lead context.
 *
 * Every number is counted in SQL. There are thirty thousand leads; no model is going to be shown
 * them, and none is going to be asked to add anything up. What goes into the prompt is a page of
 * totals that were already true before the model saw them.
 *
 * No client names, no phone numbers, no remarks. A pipeline question does not need to know who
 * anybody is, and a summary of the module should not carry thirty thousand people's details into a
 * prompt. The one exception is the follow-up list, which names leads because "eleven follow-ups are
 * overdue" is useless without saying which - and that list is short, capped, and scoped to what the
 * person asking is allowed to see.
 */

// The statuses the CRM actually issues. Anything else in the column is data, not a status - see
// `unrecognised` below.
const KNOWN_STATUSES = ["CNA", "Invalid", "Rejected", "Interested", "Followup", "Converted", "Converted & Followup"];

// Enough for a picture without turning the prompt into a report.
const LIMITS = { groups: 8, followUps: 12, recentDays: 30 };

/** What `scopedTo` says when no vertical was chosen. A constant, so the renderer compares rather than matches a sentence. */
const ALL_VERTICALS = "all verticals";

/**
 * What this context may count, as one clause every query below appends.
 *
 * Two separate narrowings, ANDed:
 *
 *   the **vertical** on screen - a filter, not a permission. The CRM is one module holding three
 *   businesses that have nothing to do with each other, and an assistant opened on the Qua Qua
 *   board answering about weddings is answering about somebody else's work.
 *
 *   the **data scope** of the reader's grant on `SALES / CRM Leads` - the same resolver, on the
 *   same columns, as the board itself. Without it the assistant counted every lead in the studio
 *   for a reader whose board shows a handful.
 *
 * `alias` prefixes the columns for a query that reaches the lead table under a name.
 */
function leadFilter({ verticals = [], scope = null, alias = "" } = {}) {
  const column = (name) => `${alias}\`${name}\``;
  const clauses = [];
  const values = [];

  const list = (Array.isArray(verticals) ? verticals : []).map((value) => String(value || "").trim()).filter(Boolean);
  if (list.length) {
    clauses.push(`${column("vertical")} IN (${list.map(() => "?").join(",")})`);
    values.push(...list);
  }

  if (scope) {
    const own = scope.sql({ branch: column("branch_id"), employee: column("owner_employee_id"), user: column("created_by_user_id") });
    if (own.clause !== "1=1") { clauses.push(own.clause); values.push(...own.params); }
  }

  if (!clauses.length) return null;
  return { clause: `AND ${clauses.join(" AND ")}`, values };
}

/**
 * One `GROUP BY` over the lead table, as [value, count] pairs.
 *
 * The column name is interpolated, so it is checked against a list rather than trusted - these are
 * raw queries and a column name cannot be a bound parameter.
 */
const GROUPABLE = new Set(["status", "vertical", "source", "crm", "event_planned_type", "city"]);

async function groupCounts(column, filter) {
  if (!GROUPABLE.has(column)) throw new Error(`Not a groupable column: ${column}`);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(NULLIF(TRIM(\`${column}\`), ''), '(not set)') AS value, COUNT(*) AS total
       FROM sales_crm_lead
      WHERE deleted_at IS NULL ${filter?.clause || ""}
      GROUP BY value
      ORDER BY total DESC
      LIMIT ${LIMITS.groups}`,
    ...(filter?.values || []),
  );
  return rows.map((row) => ({ value: String(row.value), count: Number(row.total) }));
}

/**
 * Leads by status, separating the statuses the CRM issues from everything else in that column.
 *
 * This matters more than it looks. Most rows in this database arrived in a CSV import whose columns
 * were shifted, so their `status` holds a person's name. Counting those as statuses would produce a
 * confident pipeline summary that is mostly wrong, and the model would repeat it without hesitating.
 * Reporting them separately as unrecognised is the honest shape: the real pipeline is the first
 * list, and the second is a data problem worth naming.
 */
async function statusBreakdown(filter) {
  const all = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(NULLIF(TRIM(\`status\`), ''), '(not set)') AS value, COUNT(*) AS total
       FROM sales_crm_lead
      WHERE deleted_at IS NULL ${filter?.clause || ""}
      GROUP BY value`,
    ...(filter?.values || []),
  );

  const known = [];
  let unrecognisedCount = 0;
  let unrecognisedValues = 0;
  let notSet = 0;

  for (const row of all) {
    const value = String(row.value);
    const count = Number(row.total);
    if (value === "(not set)") { notSet += count; continue; }
    if (KNOWN_STATUSES.some((status) => status.toLowerCase() === value.toLowerCase())) {
      known.push({ value, count });
    } else {
      unrecognisedCount += count;
      unrecognisedValues += 1;
    }
  }

  known.sort((a, b) => b.count - a.count);
  return { known, notSet, unrecognised: { leads: unrecognisedCount, distinctValues: unrecognisedValues } };
}

/**
 * Follow-ups that are due or late, and who owns them.
 *
 * `next_follow_up_date` is text like every other column here, so only rows that look like a date are
 * considered - a column that has held anything at all over the years cannot be handed to MySQL's
 * date functions without a guard.
 */
async function followUps(filter, today) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`enquiry_id\`, \`name\`, \`crm\`, \`vertical\`, \`status\`, \`next_follow_up_date\`
       FROM sales_crm_lead
      WHERE deleted_at IS NULL
        AND \`next_follow_up_date\` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND \`next_follow_up_date\` <= ?
        ${filter?.clause || ""}
      ORDER BY \`next_follow_up_date\` ASC
      LIMIT 500`,
    today, ...(filter?.values || []),
  );

  const owners = new Map();
  for (const row of rows) {
    const owner = String(row.crm || "").trim() || "(unassigned)";
    owners.set(owner, (owners.get(owner) || 0) + 1);
  }

  return {
    total: rows.length,
    overdue: rows.filter((row) => String(row.next_follow_up_date) < today).length,
    dueToday: rows.filter((row) => String(row.next_follow_up_date) === today).length,
    byOwner: [...owners.entries()]
      .map(([owner, count]) => ({ owner, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, LIMITS.groups),
    // Named, because "eleven are overdue" cannot be acted on and "these eleven" can.
    oldest: rows.slice(0, LIMITS.followUps).map((row) => ({
      enquiryId: row.enquiry_id,
      name: String(row.name || "").trim() || "(no name)",
      owner: String(row.crm || "").trim() || "(unassigned)",
      status: String(row.status || "").trim(),
      due: String(row.next_follow_up_date),
      daysLate: daysBetween(`${row.next_follow_up_date}T00:00:00`, `${today}T00:00:00`),
    })),
  };
}

/** How many leads arrived recently, by day-bucket, from the text `created_date` column. */
async function intake(filter, today) {
  const [row] = await prisma.$queryRawUnsafe(
    `SELECT
        SUM(\`created_date\` = ?) AS today,
        SUM(\`created_date\` >= DATE_SUB(?, INTERVAL 7 DAY)) AS week,
        SUM(\`created_date\` >= DATE_SUB(?, INTERVAL 30 DAY)) AS month
       FROM sales_crm_lead
      WHERE deleted_at IS NULL
        AND \`created_date\` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        ${filter?.clause || ""}`,
    today, today, today, ...(filter?.values || []),
  );
  return { today: Number(row?.today || 0), last7Days: Number(row?.week || 0), last30Days: Number(row?.month || 0) };
}

/**
 * Conversions, from the projects table rather than the lead's status.
 *
 * A project is the thing that actually exists once a lead converts, so it is the more reliable of
 * the two - a status can be stale, a project cannot be created by accident.
 */
async function conversions(joinScope) {
  // The project rows are reached through the lead, so the caller passes the lead filter already
  // aliased onto the join rather than this rewriting a clause it did not build.

  const rows = await prisma.$queryRawUnsafe(
    `SELECT p.\`initial_converted_value\` AS value, p.\`created_at\` AS created
       FROM sales_project p
       JOIN sales_crm_lead l ON l.\`enquiry_id\` = p.\`enquiry_id\`
      WHERE p.\`deleted_at\` IS NULL AND l.\`deleted_at\` IS NULL ${joinScope?.clause || ""}`,
    ...(joinScope?.values || []),
  ).catch(() => []);

  const amounts = rows.map((row) => parseAmount(row.value)).filter((value) => value !== null);
  const total = amounts.reduce((sum, value) => sum + value, 0);
  const cutoff = new Date(Date.now() - LIMITS.recentDays * 86_400_000);

  return {
    projects: rows.length,
    valued: amounts.length,
    total: total || null,
    average: amounts.length ? Math.round(total / amounts.length) : null,
    last30Days: rows.filter((row) => row.created && new Date(row.created) >= cutoff).length,
    formatted: {
      total: formatAmount(total),
      average: amounts.length ? formatAmount(Math.round(total / amounts.length)) : "",
    },
  };
}

/** A count from a table the CRM creates at runtime, which may simply not exist yet. */
async function runtimeCount(sql, ...values) {
  try {
    const [row] = await prisma.$queryRawUnsafe(sql, ...values);
    return Number(row?.total || 0);
  } catch {
    // Never paired WhatsApp, never recorded a call. An absence, not a failure.
    return null;
  }
}

/** Today where the studio is, not where the server is. */
function studioToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/** The UTC window for one calendar day in the studio's timezone. */
function studioDayBounds(today) {
  return {
    from: new Date(`${today}T00:00:00+05:30`),
    to: new Date(`${today}T23:59:59.999+05:30`),
  };
}

/**
 * Counts what the studio calendar shows today, for the vertical on screen.
 *
 * The project side used to compare vertical *names* ("Dum Dum") against `sourceBranch` ("Erode TN")
 * and `vertical` ("WED"), so it counted zero for every scoped session however many projects there
 * were. It matches the vertical reference now, resolved from the name the session carries.
 */
async function scheduleToday(verticals, today, reader) {
  const selected = (Array.isArray(verticals) ? verticals : [])
    .map((vertical) => String(vertical || "").trim())
    .filter(Boolean);
  const { from, to } = studioDayBounds(today);
  const verticalIds = selected.length
    ? (await prisma.vertical.findMany({ where: { name: { in: selected } }, select: { id: true } })).map((row) => row.id)
    : null;

  const [meetings, projects] = await Promise.all([
    listAllMeetings({ from, to, includeCancelled: false, reader }),
    // The projects this person may read, not the studio's. Asked with the project register's own
    // permissions rather than the CRM's: somebody who may read leads and no projects is told
    // nothing about projects, which is the honest answer rather than a count they cannot open.
    prisma.salesProject.count({
      where: {
        deletedAt: null,
        mainEventDate: { gte: from, lte: to },
        ...(verticalIds ? { verticalId: { in: verticalIds } } : {}),
        AND: [await projectAccessWhere({ userId: reader?.userId })],
      },
    }),
  ]);

  return {
    meetings: meetings.filter((meeting) => !selected.length || selected.includes(String(meeting.lead?.vertical || "").trim())).length,
    projects,
  };
}

/**
 * The whole module, assembled for the model.
 *
 * `verticals` is the board on screen and `scope` is the reader's grant on `SALES / CRM Leads`,
 * both resolved by the caller. This module never decides who may see what: it only refuses to
 * count what it was not given.
 */
async function buildCrmContext({ verticals = [], scope = null, reader = null } = {}) {
  const filter = leadFilter({ verticals, scope });
  const today = studioToday();

  const [
    totalRow, deletedRow, statuses, byVertical, bySource, byOwner, byEvent,
    due, arrivals, converted, calls, transcripts, whatsapp, todaySchedule,
  ] = await Promise.all([
    prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM sales_crm_lead WHERE deleted_at IS NULL ${filter?.clause || ""}`, ...(filter?.values || [])),
    prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM sales_crm_lead WHERE deleted_at IS NOT NULL ${filter?.clause || ""}`, ...(filter?.values || [])),
    statusBreakdown(filter),
    groupCounts("vertical", filter),
    groupCounts("source", filter),
    groupCounts("crm", filter),
    groupCounts("event_planned_type", filter),
    followUps(filter, today),
    intake(filter, today),
    conversions(leadFilter({ verticals, scope, alias: "l." })),
    runtimeCount("SELECT COUNT(*) AS total FROM sales_crm_call_log"),
    runtimeCount("SELECT COUNT(*) AS total FROM sales_call_transcript WHERE status = 'COMPLETED'"),
    runtimeCount("SELECT COUNT(DISTINCT `enquiryId`) AS total FROM `SalesCrmWhatsAppMessage`"),
    scheduleToday(verticals, today, reader).catch(() => ({ meetings: null, projects: null })),
  ]);

  return {
    // What these figures cover, said out loud so the model cannot present a narrowed count as the
    // studio's. The vertical is the board on screen; `narrowed` is true when the reader's grant has
    // taken rows out as well, which is a different fact and not one to name a permission over.
    scopedTo: verticals.length ? verticals : ALL_VERTICALS,
    narrowed: Boolean(scope && !scope.unlimited),
    today,
    leads: { total: Number(totalRow[0]?.total || 0), deleted: Number(deletedRow[0]?.total || 0) },
    statuses,
    byVertical,
    bySource,
    byOwner,
    byEvent,
    followUps: due,
    intake: arrivals,
    conversions: converted,
    engagement: { callLogs: calls, transcripts, whatsappThreads: whatsapp },
    schedule: todaySchedule,
  };
}

/** A list of counts as one readable line each, or nothing when there is nothing to show. */
function countLines(rows) {
  return rows.map((row) => `- ${row.value}: ${row.count}`).join("\n");
}

/**
 * The module as text for the prompt.
 *
 * Compact, and every section omitted when empty - a heading with nothing under it invites the model
 * to invent something to put there.
 */
function renderCrmContext(context) {
  const lines = [];
  const push = (heading, body) => { if (body) lines.push(`## ${heading}\n${body}`); };

  /*
   * Every figure says what period it covers, and no line carries two numbers.
   *
   * Both halves of that were learned from wrong answers. `Leads: 5` sat directly under
   * `Today: 2026-08-28`, and asked "how many leads are today" the model answered "Today, there are
   * 5 leads" - reading the total as a figure for today, on a day when nothing had come in. And
   * `New leads: 0 today, 5 in 7 days, 5 in 30 days` put three numbers in one line, which is the
   * shape this model reliably picks the wrong one out of.
   *
   * So the total is labelled "all time", the daily figure has a line to itself, and the word
   * "today" appears against exactly one number on the page.
   */
  push("CRM overview", [
    `Today's date: ${context.today}`,
    context.scopedTo === ALL_VERTICALS ? "Covering every vertical." : `Covering: ${[].concat(context.scopedTo).join(", ")}`,
    context.narrowed ? "These figures cover only the records this person may see, not the whole studio." : "",
    "",
    "Lead counts:",
    // Today first, because "today" is what most questions ask about and the model favours what it
    // reads first when two lines could both answer.
    `- New leads added today: ${context.intake.today}`,
    `- Total leads, all time: ${context.leads.total}${context.leads.deleted ? ` (plus ${context.leads.deleted} deleted)` : ""}`,
    `- New leads added in the last 7 days: ${context.intake.last7Days}`,
    `- New leads added in the last 30 days: ${context.intake.last30Days}`,
    /*
     * Spelled out when the two could be confused, which is most days.
     *
     * A stated fact, not an instruction - the same move as writing "Overdue: 0" instead of omitting
     * the section. Asked "how many leads are today" the model answered "Today's leads: 5", reading
     * the all-time total as a figure for today. Saying plainly that they are different numbers is
     * something it can read; hoping it infers the distinction from two labels is not.
     */
    context.intake.today !== context.leads.total
      ? `\nNote: ${context.intake.today} lead(s) came in today. The figure ${context.leads.total} is the all-time total and is not a figure for today.`
      : "",
  ].filter((line) => line !== null && line !== undefined).join("\n"));

  /*
   * The total is given rather than left to be worked out. Asked how the pipeline was doing, the
   * model summed the four statuses itself - correctly that time, which is the problem: an answer
   * that happens to be right is indistinguishable from one that is not, and there is no reason to
   * find out the hard way on a number that SQL already knows.
   */
  const inPipeline = context.statuses.known.reduce((sum, row) => sum + row.count, 0);
  push("Pipeline by status", context.statuses.known.length
    ? `${countLines(context.statuses.known)}\nTotal in pipeline: ${inPipeline}`
    : "");

  /*
   * Said plainly, because it changes how every other number should be read. A model told only the
   * good numbers will describe a healthy pipeline over a table that is mostly unusable.
   */
  const odd = context.statuses.unrecognised;
  if (odd.leads || context.statuses.notSet) {
    push("Status data quality", [
      context.statuses.notSet ? `${context.statuses.notSet} lead(s) have no status set.` : "",
      odd.leads
        ? `${odd.leads} lead(s) hold a value in the status column that is not a CRM status, across ` +
          `${odd.distinctValues} distinct value(s) - these came from an import whose columns did not line up. ` +
          "They are excluded from the pipeline counts above. Do not describe them as a pipeline stage."
        : "",
    ].filter(Boolean).join("\n"));
  }

  push("By vertical", countLines(context.byVertical));
  push("By source", countLines(context.bySource));
  push("By owner", countLines(context.byOwner));
  push("By event type", countLines(context.byEvent));

  const schedule = context.schedule || {};
  push("Calendar today", [
    schedule.meetings === null ? "Meetings today: unavailable" : `Meetings today: ${schedule.meetings}`,
    schedule.projects === null ? "Projects today: unavailable" : `Projects today: ${schedule.projects}`,
  ].join("\n"));

  /*
   * One fact per line, never two in a sentence.
   *
   * This read "17 due up to today - 17 overdue, 0 due today", which is accurate and which the model
   * turned into "17 leads due today and 17 overdue". A compound sentence is an invitation to pick
   * the wrong number out of it; a label and a number is not.
   */
  const due = context.followUps;
  /*
   * Written even when there are none, and that omission was a real wrong answer.
   *
   * The section used to be skipped when nothing was outstanding, so a CRM with an empty follow-up
   * list simply said nothing about follow-ups - and asked "who is behind on follow-ups" the model
   * reached for the nearest number it could see and answered "5 leads", which was the total lead
   * count. Absence reads as "unknown" and gets filled in; an explicit zero cannot be.
   */
  if (!due.total) {
    push("Follow-ups due or overdue", "None. Overdue: 0. Due today: 0. Nobody is behind on follow-ups.");
  } else {
    push("Follow-ups due or overdue", [
      `Overdue: ${due.overdue}`,
      `Due today: ${due.dueToday}`,
      `Total outstanding: ${due.total}`,
      due.byOwner.length ? `By owner:\n${due.byOwner.map((row) => `- ${row.owner}: ${row.count}`).join("\n")}` : "",
      due.oldest.length
        ? `Longest waiting:\n${due.oldest.map((row) =>
            `- ${row.name} (${row.enquiryId}) owned by ${row.owner}, due ${row.due}` +
            `${row.daysLate > 0 ? `, ${row.daysLate} day(s) late` : ""}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n"));
  }

  const won = context.conversions;
  // Same reasoning as the follow-ups above: a missing section is a number waiting to be invented.
  if (!won.projects) {
    push("Conversions", "None. No leads have been converted into projects.");
  } else {
    push("Conversions", [
      `${won.projects} project(s) created from leads, ${won.last30Days} in the last 30 days.`,
      won.formatted.total ? `Recorded value: ${won.formatted.total} across ${won.valued} project(s).` : "",
      won.formatted.average ? `Average: ${won.formatted.average}.` : "",
    ].filter(Boolean).join("\n"));
  }

  /*
   * Each count on its own line for the same reason. Given "Completed transcripts: 0" and "WhatsApp
   * threads: 3" on consecutive lines the model still answered "no completed transcripts or WhatsApp
   * threads", so the zero is spelled out as a sentence of its own rather than left as a digit to be
   * carried across the line break.
   */
  const engaged = context.engagement;
  const engagementLine = (label, value) => {
    if (value === null) return "";
    return value === 0 ? `${label}: none recorded` : `${label}: ${value}`;
  };
  push("Engagement", [
    engagementLine("Call logs", engaged.callLogs),
    engagementLine("Completed call transcripts", engaged.transcripts),
    engagementLine("WhatsApp threads", engaged.whatsappThreads),
  ].filter(Boolean).join("\n"));

  return lines.join("\n\n");
}

module.exports = { buildCrmContext, renderCrmContext, KNOWN_STATUSES, LIMITS };
