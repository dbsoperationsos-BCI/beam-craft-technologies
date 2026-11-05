const prisma = require("../config/db");
const iamService = require("./iam.service");
const dataScope = require("./dataScope.service");
const { userNamesById } = require("./userNames");
const { listLeadActivity } = require("../modules/sales/crm-leads/activityService");
const { listLeadCallLogs } = require("../modules/sales/crm-leads/callLogService");
const { boardWhere: productionBoardWhere } = require("../modules/project-management/production/access");
const { feedbackScope } = require("../modules/project-management/feedback/service");
const { projectAccessWhere } = require("./projectScope");
const { scopeWhere: cashScopeWhere } = require("../modules/accounts/cash-entries/read.service");
/*
 * Two screens' own narrowing rules, required when first asked for rather than at load: both live in
 * large controllers that sit on the same routers as the callers of this service, and reading them
 * here keeps one rule for each rather than a copy.
 */
const cashScopeColumns = () => require("../modules/accounts/cash-entries/controller").CASH_SCOPE_COLUMNS;
const narrowQuotations = (...args) => require("../modules/sales/projects/controller").narrowQuotations(...args);

/**
 * A project's whole history in one list - the Activity tab of a project wherever its panel is shown
 * (Projects, Pre Production, Production, Post Production, Bookings & Converted). From the enquiry that
 * started it to the gallery and the feedback, newest first: `{ id, stage, at, title, detail, by, shoot }`.
 *
 * Each stage is read from the records that stage already keeps; nothing is copied into a log of its
 * own for this. **A stage is shown only to somebody holding that stage's own permission** - the
 * permission its own screen and endpoints answer to - and narrowed the way that screen narrows it
 * (the lead by its CRM Leads scope, production by its board, feedback by `feedbackScope`). The route
 * decides whether the project may be read at all; this decides which of its lines.
 *
 * BOOKING needs nothing beyond the route: whoever may open the project may see that it was booked.
 */
const STAGE_PERMISSIONS = {
  ENQUIRY: [{ module: "SALES", feature: "CRM Leads" }],
  QUOTATION: [{ module: "SALES", feature: "Quotation Management" }],
  BOOKING: [],
  PAYMENTS: [{ module: "ACCOUNTS", feature: "Cash Management" }],
  PROJECT: [{ module: "PROJECT", feature: "Projects" }, { module: "PROJECT", feature: "Show All Projects" }],
  PRE_PRODUCTION: [{ module: "PROJECT", feature: "Pre Production" }],
  PRODUCTION: [{ module: "PROJECT", feature: "Production" }],
  IMAGE_SELECTION: [{ module: "IMAGE_SELECTION", feature: "Project Management" }],
  FEEDBACK: [{ module: "PROJECT", feature: "Feedback" }],
  GIFTS: [{ module: "PROJECT", feature: "Client Gifts" }],
};
const STAGES = Object.keys(STAGE_PERMISSIONS);
const QUOTATION_PERMISSION = { module: "SALES", feature: "Quotation Management" };
const CASH_PERMISSION = { module: "ACCOUNTS", feature: "Cash Management" };
// Extra quotations are their own screen's, under PROJECT / Projects, reached through the project.
const EXTRAS_PERMISSION = { module: "PROJECT", feature: "Projects" };
// The most lines one answer carries, and the most any one source contributes to it.
const FLOW_LIMIT = 1000;
const PER_SOURCE = 500;

// Project Activity lines that are about the booking rather than the plan, and about money.
const BOOKING_ACTIONS = new Set(["PROJECT_CREATED", "SALE_EDITED", "SENT_BACK", "SEND_BACK_RESOLVED"]);
const PAYMENT_ACTIONS = new Set(["ADVANCE_RECORDED"]);
// Lead log rows written by an import that never became the lead's history.
const LEAD_NOISE = /^(SKIPPED_|FAILED$)/;
const LEAD_SCOPE_COLUMNS = { branch: "branchId", employee: "ownerEmployeeId", user: "createdByUserId" };
/*
 * Lead fields whose values a project's history never repeats: a number, an email, an address or a
 * link is personal or a key, and the flow is read far more widely than the lead itself. A change to
 * one reads "<Label> changed" with no from / to.
 */
const SENSITIVE_LEAD_FIELDS = new Set([
  "phone", "whatsappNumber", "contactNumber", "alternateMobileNumber", "groomContact", "brideContact", "referenceContact",
  "officialEmailId", "companyWebsite", "location", "groomLocation", "brideLocation", "attachments",
]);

const rupees = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "";
};
const shootLabel = (shoot) => (shoot ? [shoot.shootId, shoot.shoot].filter(Boolean).join(" - ") || null : null);
const humanize = (action) => {
  const words = String(action || "").toLowerCase().replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
};
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : "");
const dayLabel = (value) => (value ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "");
const duration = (seconds) => {
  const total = Number(seconds) || 0;
  if (!total) return "";
  const minutes = Math.floor(total / 60);
  return minutes ? `${minutes}m ${total % 60}s` : `${total}s`;
};

/**
 * Which stages this user may see - each asked of its own permission at READ, answered from one read
 * of the user's permissions (a Super Admin's come back as every permission at Read / Write).
 */
async function visibleStages(userId) {
  const permissions = await iamService.getUserPermissions(userId).catch((error) => {
    console.error("Unable to read permissions for a project's flow:", error.message);
    return [];
  });
  const readable = new Set(permissions
    .filter((one) => one.accessLevel === "READ" || one.accessLevel === "READ_WRITE")
    .map((one) => `${one.module}:${one.feature}`));
  return new Set(STAGES.filter((stage) => {
    const wanted = STAGE_PERMISSIONS[stage];
    return !wanted.length || wanted.some((one) => readable.has(`${one.module}:${one.feature}`));
  }));
}

/**
 * The flow of one project for one reader. `projectId` must already be one the reader may open -
 * the caller asks that (`reachableProject` / the board's own reach) before calling this.
 */
async function buildProjectFlow({ projectId, userId, client = prisma }) {
  const viewer = Number(userId);
  const stages = await visibleStages(viewer);
  const project = await client.salesProject.findFirst({
    where: { id: String(projectId || ""), deletedAt: null },
    select: {
      id: true, eventId: true, enquiryId: true, createdAt: true, createdByUserId: true, initialConvertedValue: true, crmName: true,
      sentBackAt: true, sentBackByUserId: true,
      welcomeGift: true, welcomeGiftSentAt: true, welcomeGiftReceivedAt: true,
      shootCompletedGift: true, shootCompletedGiftSentAt: true, shootCompletedGiftReceivedAt: true,
      lead: { select: { enquiryId: true, createdAt: true, source: true, createdByUserId: true, branchId: true, ownerEmployeeId: true, phone: true, contactNumber: true, deletedAt: true } },
    },
  });
  if (!project) return [];

  const lines = [];
  // `byUserId` is resolved to a name once, for every line together, at the end.
  const add = (line) => { if (line.at && stages.has(line.stage)) lines.push(line); };
  const enquiryId = project.enquiryId || null;

  const sources = [];

  // ---- ENQUIRY: the lead, its log, its calls and its meetings - inside the reader's CRM Leads scope ----
  if (stages.has("ENQUIRY") && project.lead && !project.lead.deletedAt) {
    sources.push((async () => {
      const scope = await dataScope.resolve({ userId: viewer, module: "SALES", feature: "CRM Leads", columns: LEAD_SCOPE_COLUMNS, level: "READ" });
      if (!scope.allows(project.lead)) return;
      const lead = project.lead;
      const [log, calls, meetings] = await Promise.all([
        listLeadActivity(lead.enquiryId, 300).catch((error) => { console.error("Unable to read a lead's log for a project's flow:", error.message); return []; }),
        listLeadCallLogs(lead.enquiryId, { phone: lead.contactNumber || lead.phone || "", limit: 200 }).catch((error) => { console.error("Unable to read a lead's calls for a project's flow:", error.message); return []; }),
        client.salesCrmMeeting.findMany({
          where: { enquiryId: lead.enquiryId },
          select: { id: true, title: true, startAt: true, status: true, createdAt: true, createdByUserId: true },
          orderBy: { createdAt: "desc" },
          take: PER_SOURCE,
        }),
      ]);
      const created = log.find((row) => row.action === "CREATED");
      add({ id: `lead-${lead.enquiryId}`, stage: "ENQUIRY", at: created?.createdAt || lead.createdAt, title: `Enquiry ${lead.enquiryId} came in`, detail: lead.source ? `Source: ${lead.source}` : null, by: created?.actorName || null, byUserId: created?.actorName ? null : lead.createdByUserId });
      for (const row of log) {
        if (row.action === "CREATED" || LEAD_NOISE.test(row.action || "")) continue;
        const label = row.fieldLabel || row.field || "Lead";
        let title; let detail = null;
        if (row.action === "REMARK_ADDED") { title = "Remark added"; detail = row.toValue || null; }
        else if (row.action === "STATUS_CHANGED") { title = `Lead status: ${row.toValue || "cleared"}`; detail = row.fromValue ? `Was ${row.fromValue}` : null; }
        else if (row.action === "FOLLOWUP_CHANGED") { title = `${label}: ${row.toValue || "cleared"}`; }
        else { title = `${label} changed`; detail = SENSITIVE_LEAD_FIELDS.has(row.field) ? null : `${row.fromValue || "—"} → ${row.toValue || "—"}`; }
        add({ id: `lead-log-${row.id}`, stage: "ENQUIRY", at: row.createdAt, title, detail, by: row.actorName || null });
      }
      for (const call of calls) {
        const kind = call.callType ? `${call.callType} call` : "Call";
        add({ id: `lead-call-${call.id}`, stage: "ENQUIRY", at: call.calledAt, title: [kind, duration(call.durationSeconds)].filter(Boolean).join(" · "), detail: call.note || call.crmStatus || null, by: call.employeeName || null });
      }
      for (const meeting of meetings) {
        add({ id: `lead-meeting-${meeting.id}`, stage: "ENQUIRY", at: meeting.createdAt, title: `Meeting scheduled: ${meeting.title}`, detail: `For ${dayLabel(meeting.startAt)}${meeting.status ? ` · ${meeting.status}` : ""}`, byUserId: meeting.createdByUserId });
      }
    })());
  }

  // ---- QUOTATION: every version raised for the enquiry, narrowed as the Quotations register is ----
  if (stages.has("QUOTATION") && enquiryId) {
    sources.push(client.salesQuotation.findMany({
      where: { enquiryId, deletedAt: null },
      select: { id: true, quotationId: true, quotationNumber: true, enquiryId: true, branchId: true, ownerEmployeeId: true, version: true, amount: true, status: true, createdAt: true, createdByUserId: true, linkRenewedAt: true },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    }).then((found) => narrowQuotations(found, { user: { id: viewer }, permission: QUOTATION_PERMISSION })).then(({ rows }) => {
      for (const row of rows) {
        add({ id: `quotation-${row.id}`, stage: "QUOTATION", at: row.createdAt, title: `Quotation ${row.quotationId} raised${row.version > 1 ? ` (version ${row.version})` : ""}`, detail: [rupees(row.amount), row.status].filter(Boolean).join(" · ") || null, byUserId: row.createdByUserId });
        if (row.linkRenewedAt) add({ id: `quotation-renewed-${row.id}`, stage: "QUOTATION", at: row.linkRenewedAt, title: `Quotation ${row.quotationId} link renewed` });
      }
    }));
  }

  // ---- PROJECT / BOOKING / PAYMENTS / PRE_PRODUCTION: what each screen logged ----
  const areas = ["PROJECT", "PRE_PRODUCTION"].filter((area) => stages.has(area) || (area === "PROJECT" && (stages.has("BOOKING") || stages.has("PAYMENTS"))));
  const logged = areas.length ? client.projectActivity.findMany({
    where: { projectId: project.id, area: { in: areas } },
    select: { id: true, area: true, action: true, detail: true, createdAt: true, userId: true, shoot: { select: { shootId: true, shoot: true } } },
    orderBy: { createdAt: "desc" },
    take: PER_SOURCE,
  }) : Promise.resolve([]);
  sources.push(logged.then((rows) => {
    for (const row of rows) {
      const stage = row.area === "PRE_PRODUCTION" ? "PRE_PRODUCTION" : BOOKING_ACTIONS.has(row.action) ? "BOOKING" : PAYMENT_ACTIONS.has(row.action) ? "PAYMENTS" : "PROJECT";
      add({ id: `activity-${row.id}`, stage, at: row.createdAt, title: row.detail || humanize(row.action), byUserId: row.userId, shoot: shootLabel(row.shoot) });
    }
    // The booking and the send back for a project from before the screens logged them.
    if (!rows.some((row) => row.action === "PROJECT_CREATED")) {
      add({ id: `booking-${project.id}`, stage: "BOOKING", at: project.createdAt, title: `Booked as ${project.eventId}`, detail: [rupees(project.initialConvertedValue) && `Converted value ${rupees(project.initialConvertedValue)}`, project.crmName && `CRM ${project.crmName}`].filter(Boolean).join(" · ") || null, byUserId: project.createdByUserId });
    }
    if (project.sentBackAt && !rows.some((row) => row.action === "SENT_BACK")) {
      add({ id: `sent-back-${project.id}`, stage: "BOOKING", at: project.sentBackAt, title: "Sent back to Bookings & Converted", byUserId: project.sentBackByUserId });
    }
  }));

  if (stages.has("PROJECT")) {
    sources.push(Promise.all([
      client.projectStageUpdate.findMany({ where: { projectId: project.id }, select: { id: true, stage: true, remark: true, userId: true, userName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
      client.projectApplicabilityChange.findMany({ where: { projectId: project.id }, select: { id: true, item: true, fromValue: true, toValue: true, remarks: true, changedByUserId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: PER_SOURCE }),
    ]).then(([updates, changes]) => {
      for (const row of updates) add({ id: `stage-update-${row.id}`, stage: "PROJECT", at: row.createdAt, title: `${row.stage} update`, detail: row.remark || null, by: row.userId ? null : row.userName, byUserId: row.userId });
      for (const row of changes) add({ id: `applicability-${row.id}`, stage: "PROJECT", at: row.createdAt, title: `${row.item}: ${row.fromValue || "—"} → ${row.toValue || "—"}`, detail: row.remarks || null, byUserId: row.changedByUserId });
    }));
  }

  // ---- PAYMENTS: the project's cash entries (Cash Management's own scope) and its extra quotations (theirs) ----
  if (stages.has("PAYMENTS")) {
    sources.push(Promise.all([
      dataScope.resolve({ userId: viewer, ...CASH_PERMISSION, columns: cashScopeColumns(), level: "READ" }),
      projectAccessWhere({ userId: viewer, permissions: EXTRAS_PERMISSION }),
    ]).then(([cashScope, extrasProject]) => Promise.all([
      client.cashEntry.findMany({
        where: { projectId: project.id, deletedAt: null, ...cashScopeWhere(cashScope) },
        select: { id: true, entryId: true, entryType: true, category: true, amount: true, entryDate: true, paymentMode: true, createdAt: true, createdBy: true, shoot: { select: { shootId: true, shoot: true } } },
        orderBy: { createdAt: "desc" },
        take: PER_SOURCE,
      }),
      client.projectExtraQuotation.findMany({
        where: { projectId: project.id, deletedAt: null, AND: [{ project: extrasProject }] },
        select: { id: true, requestCode: true, service: true, amount: true, status: true, remarks: true, decisionRemarks: true, requestedById: true, requestedByName: true, addedAt: true, decidedById: true, decidedAt: true, shoot: { select: { shootId: true, shoot: true } } },
        orderBy: { addedAt: "desc" },
        take: PER_SOURCE,
      }),
    ])).then(([cash, extras]) => {
      for (const row of cash) {
        const verb = row.entryType === "Received" ? "received" : row.entryType === "Spent" ? "paid" : String(row.entryType || "").toLowerCase();
        const dated = day(row.entryDate) && day(row.entryDate) !== day(row.createdAt) ? `Dated ${dayLabel(row.entryDate)}` : null;
        add({ id: `cash-${row.id}`, stage: "PAYMENTS", at: row.createdAt, title: `${row.category || "Payment"} ${rupees(row.amount)} ${verb}`.trim(), detail: [row.entryId, row.paymentMode, dated].filter(Boolean).join(" · ") || null, byUserId: row.createdBy, shoot: shootLabel(row.shoot) });
      }
      for (const row of extras) {
        add({ id: `extra-${row.id}`, stage: "PAYMENTS", at: row.addedAt, title: `Extra ${row.service} ${rupees(row.amount)} requested`, detail: [row.requestCode, row.remarks].filter(Boolean).join(" · ") || null, by: row.requestedByName || null, shoot: shootLabel(row.shoot) });
        if (row.decidedAt) add({ id: `extra-decided-${row.id}`, stage: "PAYMENTS", at: row.decidedAt, title: `Extra ${row.service} ${String(row.status || "decided").toLowerCase()}`, detail: row.decisionRemarks || null, byUserId: row.decidedById, shoot: shootLabel(row.shoot) });
      }
    }));
  }

  // ---- PRODUCTION: each shoot's production log, within the reader's Production board ----
  if (stages.has("PRODUCTION")) {
    sources.push(productionBoardWhere(viewer).then((board) => client.projectProductionActivity.findMany({
      where: { production: { salesProjectId: project.id, shoot: { deletedAt: null }, AND: [board] } },
      select: { id: true, action: true, detail: true, userId: true, userName: true, createdAt: true, production: { select: { shoot: { select: { shootId: true, shoot: true } } } } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    })).then((rows) => {
      for (const row of rows) add({ id: `production-${row.id}`, stage: "PRODUCTION", at: row.createdAt, title: row.detail || humanize(row.action), by: row.userId ? null : row.userName, byUserId: row.userId, shoot: shootLabel(row.production?.shoot) });
    }));
  }

  // ---- IMAGE_SELECTION: the linked gallery project and what its client did ----
  if (stages.has("IMAGE_SELECTION")) {
    sources.push(client.imageSelectionProject.findMany({
      where: { salesProjectId: project.id, deletedAt: null },
      select: {
        id: true, projectName: true, createdAt: true, createdByUserId: true, archivedAt: true, disabledAt: true, disabledByUserId: true, selectedDownloadedAt: true,
        galleryPublication: { select: { publishedAt: true, publishedByUserId: true, revokedAt: true, revokedReason: true, galleryFirstOpenedAt: true, selectionSubmittedAt: true } },
      },
      take: 20,
    }).then((rows) => {
      for (const row of rows) {
        const name = row.projectName;
        add({ id: `gallery-${row.id}`, stage: "IMAGE_SELECTION", at: row.createdAt, title: `Image Selection project created: ${name}`, byUserId: row.createdByUserId });
        const publication = row.galleryPublication;
        if (publication) {
          add({ id: `gallery-published-${row.id}`, stage: "IMAGE_SELECTION", at: publication.publishedAt, title: "Gallery published to the client", detail: name, byUserId: publication.publishedByUserId });
          add({ id: `gallery-opened-${row.id}`, stage: "IMAGE_SELECTION", at: publication.galleryFirstOpenedAt, title: "Client opened the gallery", detail: name });
          add({ id: `gallery-submitted-${row.id}`, stage: "IMAGE_SELECTION", at: publication.selectionSubmittedAt, title: "Client submitted the selection", detail: name });
          add({ id: `gallery-revoked-${row.id}`, stage: "IMAGE_SELECTION", at: publication.revokedAt, title: "Gallery link revoked", detail: [name, publication.revokedReason].filter(Boolean).join(" · ") });
        }
        add({ id: `gallery-downloaded-${row.id}`, stage: "IMAGE_SELECTION", at: row.selectedDownloadedAt, title: "Selected photos downloaded", detail: name });
        add({ id: `gallery-disabled-${row.id}`, stage: "IMAGE_SELECTION", at: row.disabledAt, title: "Image Selection project disabled", detail: name, byUserId: row.disabledByUserId });
        add({ id: `gallery-archived-${row.id}`, stage: "IMAGE_SELECTION", at: row.archivedAt, title: "Image Selection project archived", detail: name });
      }
    }));
  }

  // ---- FEEDBACK: the project's reviews, within the reader's feedback scope ----
  if (stages.has("FEEDBACK")) {
    sources.push(feedbackScope(viewer).then((scope) => client.projectFeedback.findMany({
      where: { projectId: project.id, AND: [scope] },
      select: { id: true, feedbackCode: true, stage: true, review: true, feedback: true, createdAt: true, createdByUserId: true, issueResolvedAt: true, issueResolvedByUserId: true, issueRemarks: true, shoot: { select: { shootId: true, shoot: true } } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
    })).then((rows) => {
      for (const row of rows) {
        add({ id: `feedback-${row.id}`, stage: "FEEDBACK", at: row.createdAt, title: `${humanize(row.stage)} feedback: ${row.review}`, detail: [row.feedbackCode, row.feedback].filter(Boolean).join(" · ") || null, byUserId: row.createdByUserId, shoot: shootLabel(row.shoot) });
        add({ id: `feedback-resolved-${row.id}`, stage: "FEEDBACK", at: row.issueResolvedAt, title: "Feedback issue resolved", detail: row.issueRemarks || null, byUserId: row.issueResolvedByUserId, shoot: shootLabel(row.shoot) });
      }
    }));
  }

  // ---- GIFTS: the two gifts the project owes its client ----
  if (stages.has("GIFTS")) {
    const gifts = [["welcome", "Welcome gift", project.welcomeGift, project.welcomeGiftSentAt, project.welcomeGiftReceivedAt], ["shoot-completed", "Shoot completed gift", project.shootCompletedGift, project.shootCompletedGiftSentAt, project.shootCompletedGiftReceivedAt]];
    for (const [key, label, gift, sentAt, receivedAt] of gifts) {
      add({ id: `gift-${key}-sent-${project.id}`, stage: "GIFTS", at: sentAt, title: `${label} sent`, detail: gift || null });
      add({ id: `gift-${key}-received-${project.id}`, stage: "GIFTS", at: receivedAt, title: `${label} received by the client`, detail: gift || null });
    }
  }

  await Promise.all(sources);

  const names = await userNamesById(lines.map((line) => line.byUserId), { client });
  return lines
    .map(({ byUserId, ...line }) => ({ ...line, at: new Date(line.at).toISOString(), by: line.by || names.get(Number(byUserId)) || null, detail: line.detail || null, shoot: line.shoot || null }))
    .sort((left, right) => (left.at < right.at ? 1 : left.at > right.at ? -1 : 0))
    .slice(0, FLOW_LIMIT);
}

module.exports = { buildProjectFlow, visibleStages, STAGE_PERMISSIONS, STAGES, FLOW_LIMIT };
