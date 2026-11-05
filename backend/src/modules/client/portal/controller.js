const prisma = require("../../../config/db");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { CLIENT_ROLE } = require("../../../services/loginCredentials");
const { projectStage } = require("../../sales/projects/stage");
const { GIFTS, readStatus } = require("../../project-management/client-gifts/service");
const { APPLICABILITY_ITEMS, isDraftQuotation, sendQuotationPdf } = require("../../sales/projects/controller");
const { signPrintPass } = require("../../../services/quotationPrintPass");
const { receiptFor, clientOwnName } = require("../../accounts/cash-entries/receipt");
const { renderReceiptPdf } = require("../../../services/paymentReceiptPdf");
const referrals = require("./referrals");
const clientOffers = require("../../sales/client-offers/service");
const clientAppSettings = require("../../sales/client-offers/settings");
const rewards = require("./rewards");
const { frontendOrigin } = require("../../../services/quotationPdfService");
const preProduction = require("./preProduction");
const clientRequests = require("../requests/service");
const gallery = require("../../image-selection/publication/service");
const { reachedConfigWhere } = require("../../image-selection/shoot-visibility");
const albumSecurity = require("../../image-selection/album-proofs/security");
const { CLIENT_STATUS_LABELS } = require("../../image-selection/album-proofs/client.service");
const { STEPS, STEP_TIME_FIELDS, stepIndex } = require("../../project-management/production/steps");
const { brandCodeFor, mergePdfAssets, resolveCoverSet } = require("../../sales/quotation-brands/defaults");

/*
 * The client portal (`/client`): what a client may read of their own project.
 *
 * A client account holds no IAM role, so no permission guard can admit it; the portal belongs to the
 * CLIENT role outright, and `requireClient` is its guard. `protect` has already refused a client
 * token every route not on its list (`CLIENT_ROUTES`) and re-read that the login still stands.
 *
 * The project is the one the account was made for - read from the account, never from an id in the
 * request, so there is nothing to change to reach somebody else's. And only the fields a client is
 * meant to see are selected: where the project stands - the stages exactly as the studio's own
 * Status tab works them out (`projectStage`), cut down to what a client is told - its basic details,
 * each shoot's production as far as the shoot itself (`shootProgress`), the two client gifts as
 * Client Gifts tracks them (where each is and when it went, not who sends
 * it), and the CRD document: where it stands, and while it is the client's to fill, its own link.
 * No money, remarks, update history, phone numbers or quotation leave `getClientProject`.
 *
 * The client's own money is answered separately, by `getClientPayments` and the two downloads: what
 * the project is signed for and what the client has paid, exactly as Edit Project → Payments adds
 * them up, plus their quotation and their payment receipts as files. Nothing the studio spent, no
 * entry descriptions or remarks, and no extra still waiting for a decision leave there either.
 */

/** Refuses anybody but a client - and anybody whose token carries no role at all. */
function requireClient(req, res, next) {
  if (!req.user || req.user.role !== CLIENT_ROLE) return res.status(403).json({ message: "This is for client accounts only." });
  return next();
}

/**
 * The client's WhatsApp group invite link, when the team has pasted one (https://chat.whatsapp.com/…)
 * into the project's WhatsApp Group Name. Only the link is sent - nothing else of that field, which
 * otherwise holds the studio's internal group name. Null when there is no link.
 */
function groupLinkOf(project) {
  // The link the team saved for the client on Pre Production -> General, else one pasted into the name.
  if (project?.whatsappGroupInviteLink) return project.whatsappGroupInviteLink;
  const match = String(project?.whatsappGroupName || "").match(/https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+/);
  return match ? match[0] : null;
}

// The people on the project, with the number a client may reach them on - read only for `teamOf`.
const employeeContact = { select: { employeeName: true, companyGivenNumber: true, contactNumber: true } };

/*
 * The project's team as the client app lists it, each with a number to call or WhatsApp: the
 * company-issued phone where the studio has given the person one, otherwise their own contact
 * number - the studio's choice, so every team member can be reached. Only someone linked to an
 * employee record has a number; a name typed by hand is listed without one.
 */
const TEAM_ROLES = [
  ["Project manager", "projectManager"],
  ["Pre-production coordinator", "preProductionCoordinator"],
  ["Creative manager", "creativeManager"],
  ["Production manager", "productionManager"],
  ["Post-production coordinator", "postProductionCoordinator"],
];
function teamOf(project) {
  return TEAM_ROLES.map(([role, key]) => {
    const employee = project[`${key}Employee`];
    const name = employee?.employeeName || project[key] || null;
    const phone = String(employee?.companyGivenNumber || employee?.contactNumber || "").trim() || null;
    return name ? { role, name, phone } : null;
  }).filter(Boolean);
}

/*
 * The production steps a client follows a shoot through, each by the crew's step it stands for:
 * the team leaving the studio, reaching the shoot place, starting, and the shoot completed (the
 * crew's Shoot status step, which only moves on once it is Completed). The crew's own steps either
 * side of these - the Pineapple meeting, back at the studio, the photo copy - are the studio's.
 */
const CLIENT_SHOOT_STEPS = [
  ["ON_THE_WAY", "STARTED_FROM_STUDIO"],
  ["REACHED", "REACHED_SHOOT_PLACE"],
  ["STARTED", "SHOOT_STARTED"],
  // Happy clients is the shoot being over, and the moment it happened.
  ["COMPLETED", "HAPPY_CLIENTS"],
];
const SHOOT_PROGRESS_TIMES = Object.fromEntries(CLIENT_SHOOT_STEPS.map(([, step]) => [STEP_TIME_FIELDS[step], true]));

/** A shoot's own details for the client: code, place, session and how many crew are on it. */
function shootDetails(shoot) {
  const crew = new Set((shoot?.production?.serviceCrew || [])
    .map((member) => (member.employeeId ? `e${member.employeeId}` : member.vendorId ? `v${member.vendorId}` : null))
    .filter(Boolean));
  const hours = shoot?.sessionDurationHours || 0;
  const minutes = shoot?.sessionDurationMinutes || 0;
  return {
    code: shoot?.shootId || null,
    place: shoot?.shootPlace || null,
    session: shoot?.sessionTiming || null,
    duration: hours || minutes ? `${hours ? `${hours} hr` : ""}${hours && minutes ? " " : ""}${minutes ? `${minutes} min` : ""}` : null,
    crewCount: crew.size || null,
  };
}

/**
 * Each shoot's cover picture for the client app: the cover photograph the studio uploads per group
 * of shoots in Settings -> Quotation Settings -> PDF Content, picked for the shoot exactly as a
 * quotation picks it (`resolveCoverSet`, the shoot as its own main event). The brand is the signed
 * quotation's, else the project's vertical's, and its settings are read live, so a cover the studio
 * changes reaches the app at once. A shoot with no cover to show gets null - the app then shows its
 * own example picture.
 */
async function shootCovers(project) {
  const covers = new Map();
  const quotation = project.quotationId
    ? await prisma.salesQuotation.findUnique({ where: { quotationId: project.quotationId }, select: { quotationBrand: true } })
    : null;
  const code = quotation?.quotationBrand || brandCodeFor(project.vertical);
  const brand = code ? await prisma.salesQuotationBrand.findUnique({ where: { code }, select: { pdfAssets: true } }) : null;
  if (!brand) return covers;
  const assets = mergePdfAssets(brand.pdfAssets);
  for (const shoot of project.shoots) {
    const set = resolveCoverSet(assets.coverSets, [{ shoot: shoot.shoot, isMainEvent: true }]);
    covers.set(shoot.id, set?.coverImageUrl || assets.coverImageUrl || null);
  }
  return covers;
}

const CLIENT_PROJECT_SELECT = {
  // Read only for the group's invite link (`groupLinkOf`) - the name itself is the studio's working
  // code and never leaves.
  whatsappGroupName: true,
  whatsappGroupInviteLink: true,
  projectStatus: true,
  eventId: true,
  // Read to find the brand whose cover pictures the shoots show (`shootCovers`).
  quotationId: true,
  // Read only to work out the client's own name (`clientNameFor`) - never sent: the WhatsApp group
  // name is the studio's working code ("WED 4t4 Erode TN … | NSM | …"), not something a client sees.
  enquiryId: true,
  groupNameGeneratorJson: true,
  mainEventDateKnown: true,
  mainEventDate: true,
  // What `projectStage` reads, less what a client is never shown (the converted value, who
  // converted and recorded the sale, the stage update history) - so it is not even read.
  sourceBranch: true,
  vertical: true,
  branch: { select: { name: true } },
  verticalRef: { select: { name: true } },
  projectManager: true,
  preProductionCoordinator: true,
  creativeManager: true,
  productionManager: true,
  postProductionCoordinator: true,
  projectManagerEmployee: employeeContact,
  preProductionCoordinatorEmployee: employeeContact,
  creativeManagerEmployee: employeeContact,
  productionManagerEmployee: employeeContact,
  postProductionCoordinatorEmployee: employeeContact,
  shoots: {
    where: { deletedAt: null },
    orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { createdAt: "asc" }],
    select: {
      id: true, shoot: true, dateCreated: true,
      // What the client's Home card says about a shoot: its code, place and session.
      shootId: true, shootPlace: true, sessionTiming: true, sessionDurationHours: true, sessionDurationMinutes: true,
      production: {
        select: {
          planSubmittedAt: true, currentStep: true, shootStatus: true, ...SHOOT_PROGRESS_TIMES,
          // Who is on the shoot, to say how many - never their names or numbers.
          serviceCrew: { select: { employeeId: true, vendorId: true } },
        },
      },
    },
  },
  // Each gift's own columns, named by Client Gifts (`GIFTS`) - never its assignee.
  ...Object.fromEntries(Object.values(GIFTS).flatMap((gift) => [gift.gift, gift.status, gift.sentAt, gift.receivedAt].map((column) => [column, true]))),
  crdDocumentStatus: true,
  crdDocument: { select: { status: true, publicToken: true, submittedAt: true } },
};

/** A stored day as `YYYY-MM-DD`, sliced rather than put through a timezone. */
const dayOf = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null);

/*
 * The facts of a stage a client is told: where, what kind of event, when, and who is looking after
 * it. The Status tab's others - the converted value, who converted and recorded the sale, the
 * enquiry - are the studio's.
 */
const CLIENT_FACTS = new Set([
  "Branch", "Vertical", "Main event date", "Project manager",
  "Pre-production coordinator", "Creative manager", "Production plans submitted",
  "Production manager", "Shoots finished", "Post-production coordinator",
]);

/** A stored moment as an ISO string, or null - the portal words and places it in the client's time. */
const momentOf = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);

/**
 * How far a shoot's production has come, as the client follows it: its plan, then each of
 * `CLIENT_SHOOT_STEPS` - done once the crew has moved past it, with the moment it happened. Keys, not
 * the crew's step names: the portal words them for the client. A shoot with no production raised yet
 * is still to be planned. The shoot runs to Happy clients and nothing stops it part-way, so there is
 * no halted state for the client to be shown.
 */
function shootProgress(production) {
  const planned = Boolean(production?.planSubmittedAt);
  const at = planned ? stepIndex(production.currentStep) : -1;
  return {
    steps: [
      { key: "PLAN", done: planned, at: momentOf(production?.planSubmittedAt) },
      ...CLIENT_SHOOT_STEPS.map(([key, step]) => {
        const done = at > STEPS.indexOf(step);
        return { key, done, at: done ? momentOf(production[STEP_TIME_FIELDS[step]]) : null };
      }),
    ],
  };
}

/**
 * The studio's stages (`projectStage`), as a client sees them: the same states and counts, the facts
 * above, and each shoot as planned / finished with its day and its `progress` - the client's steps,
 * never the crew's own names for them. `productions` is each shoot's production record, by shoot.
 */
function clientStages(stage, productions, details = new Map()) {
  return stage.stages.map((item) => ({
    id: item.id,
    label: item.label,
    state: item.state,
    done: item.done ?? null,
    total: item.total ?? null,
    facts: (item.facts || []).filter((fact) => CLIENT_FACTS.has(fact.label)).map((fact) => ({
      label: fact.label,
      value: fact.kind === "date" ? dayOf(fact.value) : fact.value,
    })),
    ...(item.shoots ? {
      shoots: item.shoots.map((shoot) => ({ id: shoot.id, name: shoot.name, date: dayOf(shoot.date), planned: shoot.planned, plannedOn: dayOf(shoot.plannedAt), finished: shoot.done, progress: shootProgress(productions.get(shoot.id)), ...(details.get(shoot.id) || {}) })),
    } : {}),
  }));
}

/**
 * One gift as Client Gifts tracks it, or `null` for a project not giving it: Not Applicable is no
 * gift, not one still to come. The status is read the way Client Gifts reads it (`readStatus`).
 */
function giftOf(project, key) {
  const gift = GIFTS[key];
  if (project[gift.gift] !== "Applicable") return null;
  return { status: readStatus(project[gift.status]), sentOn: dayOf(project[gift.sentAt]), receivedOn: dayOf(project[gift.receivedAt]) };
}

/**
 * The CRD document as the client is to see it, or `null` for a project that needs none.
 *
 *   notStarted - no document yet, or one the studio has not sent: no link is given, since the
 *                studio has not asked for it yet.
 *   awaiting   - sent, and nothing saved yet: the link, for the client to fill it in.
 *   inProgress - a draft saved through the link: the link again, to finish it.
 *   submitted  - done, with the day; the link is no longer offered, the form refuses a second go.
 *
 * The link is the one the studio sends on WhatsApp (`/crd/<publicToken>`), handed to the signed-in
 * client of this project only.
 */
function crdOf(project) {
  if (!APPLICABILITY_ITEMS.crdDocumentStatus(project.crdDocumentStatus)) return null;
  const document = project.crdDocument;
  if (document?.submittedAt || document?.status === "Submitted") return { state: "submitted", submittedOn: dayOf(document.submittedAt) };
  if (!document || document.status === "Not Sent") return { state: "notStarted" };
  return { state: document.status === "In Progress" ? "inProgress" : "awaiting", fillPath: `/crd/${document.publicToken}` };
}

/**
 * The client's own name - "Vikram and Harini", "Keerthana Sharma" - worked out exactly as their
 * invoice names them (`clientOwnName`): the enquiry's names, then the group name generator's. Null
 * when neither holds one; never the WhatsApp group name, which is the studio's internal code.
 */
async function clientNameFor(project) {
  const lead = project.enquiryId
    ? await prisma.salesCrmLead.findFirst({
      where: { enquiryId: project.enquiryId, deletedAt: null },
      select: { name: true, groomName: true, brideName: true, companyName: true, primaryDecisionMaker: true, babyOrMotherName: true },
    })
    : null;
  return clientOwnName(project, lead) || null;
}

async function getClientProject(req, res) {
  try {
    // The client's own project (or the event asked for - `ownProjectWhere`), read at the top level so
    // the people's names come back as the register has them now (`resolvedNames`).
    const project = await prisma.salesProject.findFirst({
      where: await ownProjectWhere(req),
      select: CLIENT_PROJECT_SELECT,
    });
    res.set("Cache-Control", "no-store");
    if (!project) return res.status(404).json({ message: "Your project could not be found. Please contact the studio." });
    const stage = projectStage(project);
    const covers = await shootCovers(project);
    return res.json({
      data: {
        projectStatus: stage.projectStatus,
        // On Hold, Rejected and the like stop a project rather than move it - said beside the stages.
        flag: stage.flag,
        eventId: project.eventId,
        clientName: await clientNameFor(project),
        stages: clientStages(
          stage,
          new Map(project.shoots.map((shoot) => [shoot.id, shoot.production])),
          new Map(project.shoots.map((shoot) => [shoot.id, { ...shootDetails(shoot), coverUrl: covers.get(shoot.id) ?? null }])),
        ),
        welcomeGift: giftOf(project, "welcome"),
        shootCompletedGift: giftOf(project, "shoot-completed"),
        crdDocument: crdOf(project),
        team: teamOf(project),
        whatsappGroupLink: groupLinkOf(project),
      },
    });
  } catch (error) {
    console.error("Unable to read the client's project:", error);
    return res.status(500).json({ message: "Unable to load your project. Please try again." });
  }
}

const lastTenDigits = (value) => String(value || "").replace(/\D/g, "").slice(-10);

/**
 * Every project the signed-in client may read: the one its login was made for, and every other
 * project the studio saved with the same Client Main Number. One person comes back for another
 * event - a wedding after an engagement - and the studio creates a new Event ID with the same number;
 * the client keeps the one login and sees each event. Matched on the number alone (its last ten
 * digits, the login's username), so a project with another number is never theirs.
 */
async function clientProjectIds(req) {
  const account = await prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { username: true, clientProjectId: true } });
  if (!account) return [];
  const digits = lastTenDigits(account.username);
  const sameNumber = digits.length === 10
    // Narrowed in the query by the last four digits (a saved number may hold spaces), then held to all ten.
    ? (await prisma.salesProject.findMany({ where: { deletedAt: null, clientMainNumber: { contains: digits.slice(-4) } }, select: { id: true, clientMainNumber: true } }))
      .filter((project) => lastTenDigits(project.clientMainNumber) === digits)
      .map((project) => project.id)
    : [];
  return [...new Set([account.clientProjectId, ...sameNumber].filter(Boolean))];
}

/**
 * The project a client request is about - found through the account, never a raw id. With
 * `?event=<Event ID>` it is that event, if it is one of the client's own (`clientProjectIds`);
 * without it, the project the login was made for, as before.
 */
async function ownProjectWhere(req) {
  const event = typeof req.query?.event === "string" ? req.query.event.trim() : "";
  if (!event) return { deletedAt: null, clientLogin: { is: { id: Number(req.user.id) } } };
  return { deletedAt: null, eventId: event, id: { in: await clientProjectIds(req) } };
}

/** The client's events, oldest first: what the app lists, one card each. */
async function getClientProjects(req, res) {
  try {
    const projects = await prisma.salesProject.findMany({
      where: { deletedAt: null, id: { in: await clientProjectIds(req) } },
      select: { eventId: true },
      orderBy: { createdAt: "asc" },
    });
    res.set("Cache-Control", "no-store");
    return res.json({ data: { events: projects.map((project) => project.eventId).filter(Boolean) } });
  } catch (error) {
    console.error("Unable to list the client's projects:", error);
    return res.status(500).json({ message: "Unable to load your bookings. Please try again." });
  }
}

/**
 * The quotation the project was signed on (`SalesProject.quotationId`, one version), or null when
 * the project names none, or names one that was deleted or is still a draft.
 */
async function signedQuotationOf(project) {
  if (!project?.quotationId) return null;
  const quotation = await prisma.salesQuotation.findUnique({ where: { quotationId: project.quotationId } });
  return quotation && !quotation.deletedAt && !isDraftQuotation(quotation) ? quotation : null;
}

/**
 * The client's money: what the project is signed for and what they have paid.
 *
 * Added up exactly as Edit Project → Payments does (`listProjectPayments`), so the client and the
 * studio never see two figures: the quotation is the project's Initial Converted Value, the extras
 * are the extra work its manager has approved, and received is every Received cash entry. Only what
 * belongs to the client leaves: no Spent entries, no entry descriptions or remarks, no pending
 * extras, no handler, and the receipts by their own number for the receipt download.
 */
/*
 * What the client's booking includes, shoot by shoot: the services (who and what covers the day -
 * "Semi Candid Photo", "Traditional Video") and the deliverables (what they receive - "Signature Album,
 * 60 photos", "Retouches, 25"), as Project Management holds them now. What was sold, in the client's
 * words: no prices, no team, nothing the studio wrote for itself (`remarks`).
 */
const shootOrder = (a, b) => (a.dateCreated?.getTime() ?? Infinity) - (b.dateCreated?.getTime() ?? Infinity);

async function getClientPackage(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const project = await prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } });
    if (!project) return res.status(404).json({ message: "Your project could not be found. Please contact the studio." });
    const [shoots, services, deliverables] = await Promise.all([
      prisma.projectShoot.findMany({ where: { projectId: project.id, deletedAt: null }, select: { id: true, shoot: true, dateCreated: true } }),
      prisma.projectPostProductionAllocation.findMany({
        where: { projectId: project.id, deletedAt: null },
        select: { id: true, shootId: true, serviceName: true, serviceDetails: true, quantity: true, quantitySessionTiming: true, durationHours: true, durationMinutes: true, workDays: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.projectShootDeliverable.findMany({
        where: { projectId: project.id, deletedAt: null },
        select: { id: true, shootId: true, deliverableName: true, quantity: true, numberOfPhotos: true, size: true, frameInches: true, videoLength: true, brandName: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const hours = (row) => [row.durationHours ? `${row.durationHours} hr${row.durationHours === 1 ? "" : "s"}` : null, row.durationMinutes ? `${row.durationMinutes} min` : null].filter(Boolean).join(" ");
    const data = [...shoots].sort(shootOrder).map((shoot) => ({
      id: shoot.id,
      name: shoot.shoot,
      date: shoot.dateCreated ? shoot.dateCreated.toISOString().slice(0, 10) : null,
      services: services.filter((row) => row.shootId === shoot.id).map((row) => ({
        id: row.id,
        name: row.serviceName,
        quantity: row.quantity ?? 1,
        // How long or how much: a session ("Full day"), hours, or days of work.
        timing: [row.quantitySessionTiming, hours(row), row.workDays ? `${row.workDays} day${row.workDays === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || null,
        details: row.serviceDetails || null,
      })),
      deliverables: deliverables.filter((row) => row.shootId === shoot.id).map((row) => ({
        id: row.id,
        name: row.deliverableName,
        quantity: row.quantity ?? 1,
        photos: row.numberOfPhotos ?? null,
        // What tells this one apart: its brand, size, frame or length, as it was sold.
        details: [row.brandName, row.size, row.frameInches ? `${row.frameInches} frame` : null, row.videoLength].filter(Boolean).join(" · ") || null,
      })),
    }));
    return res.json({ data: { shoots: data } });
  } catch (error) {
    console.error("Unable to read the client's package:", error);
    return res.status(500).json({ message: "Unable to load your services and deliverables. Please try again." });
  }
}

async function getClientPayments(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: await ownProjectWhere(req),
      select: { id: true, quotationId: true, initialConvertedValue: true },
    });
    res.set("Cache-Control", "no-store");
    if (!project) return res.status(404).json({ message: "Your project could not be found. Please contact the studio." });

    const [received, extras, quotation] = await Promise.all([
      prisma.cashEntry.findMany({
        where: { projectId: project.id, deletedAt: null, entryType: "Received" },
        select: { entryId: true, category: true, amount: true, entryDate: true, paymentMode: true, paymentModeOther: true },
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      }),
      prisma.projectExtraQuotation.findMany({
        where: { projectId: project.id, status: "APPROVED", deletedAt: null },
        select: { requestCode: true, service: true, amount: true, decidedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      signedQuotationOf(project),
    ]);
    // The changes the studio has published on the quotation (Sale Extras), as the client's link shows them.
    const saleExtras = await prisma.projectSaleExtra.findMany({
      where: { projectId: project.id, status: "PUBLISHED", parentExtraId: null },
      select: { code: true, itemName: true, amount: true, publishedRevision: { select: { publishedAt: true } } },
      orderBy: { changedAt: "desc" },
    });

    const total = (rows) => rows.reduce((sum, row) => sum + Number(row.amount), 0);
    const totalQuotation = Number(project.initialConvertedValue || 0);
    const totalExtra = total(extras) + total(saleExtras);
    return res.json({
      data: {
        summary: { totalQuotation, totalExtra, totalSigned: totalQuotation + totalExtra, totalReceived: total(received) },
        quotation: quotation ? {
          id: quotation.quotationId,
          date: dayOf(quotation.quotationDate || quotation.createdAt),
          // A signed-in client may always have their own signed quotation as a file (see below).
          downloadable: true,
        } : null,
        extras: [...saleExtras.map((extra) => ({
          id: extra.code,
          service: extra.itemName,
          amount: Number(extra.amount),
          approvedOn: dayOf(extra.publishedRevision?.publishedAt),
        })), ...extras.map((extra) => ({
          id: extra.requestCode,
          service: extra.service,
          amount: Number(extra.amount),
          approvedOn: dayOf(extra.decidedAt || extra.createdAt),
        }))],
        received: received.map((entry) => ({
          id: entry.entryId,
          category: entry.category,
          date: dayOf(entry.entryDate),
          amount: Number(entry.amount),
          mode: entry.paymentMode === "Other" && entry.paymentModeOther ? entry.paymentModeOther : entry.paymentMode,
        })),
      },
    });
  } catch (error) {
    console.error("Unable to read the client's payments:", error);
    return res.status(500).json({ message: "Unable to load your payments. Please try again." });
  }
}

/**
 * The signed quotation as a PDF - the same file the client's quotation link downloads.
 *
 * Unlike that link, not refused when the link has lapsed or the brand keeps client downloads off:
 * this is the signed-in client's own signed quotation, a document they agreed to. The brand setting
 * still governs the public link. A lapsed link is printed with a one-time pass for this quotation
 * (`signPrintPass`), so the link itself stays lapsed and nothing is renewed.
 */
async function getClientQuotationPdf(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const project = await prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true, quotationId: true } });
    const quotation = await signedQuotationOf(project);
    if (!quotation) return res.status(404).json({ message: "No quotation is available for your project yet." });
    return await sendQuotationPdf(res, quotation, { printPass: signPrintPass(quotation.publicToken) });
  } catch (error) {
    console.error("Unable to render the client's quotation PDF:", error);
    if (res.headersSent) return undefined;
    return res.status(500).json({ message: "The quotation could not be prepared. Please try again in a moment." });
  }
}

/**
 * The client's signed quotation to read in their app: the quotation page itself (`/q/<token>`, the
 * page the studio shared) and a pass for it. The pass is the print pass the PDF uses, here valid for
 * half an hour, so the page opens though its public link has long lapsed - for this signed-in
 * client and this quotation only; the link stays lapsed for anybody else and nothing is renewed.
 */
const QUOTATION_VIEW_SECONDS = 30 * 60;
async function getClientQuotationView(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const project = await prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true, quotationId: true } });
    const quotation = await signedQuotationOf(project);
    if (!quotation?.publicToken) return res.status(404).json({ message: "No quotation is available for your project yet." });
    return res.json({ data: {
      id: quotation.quotationId,
      url: `${frontendOrigin()}/q/${encodeURIComponent(quotation.publicToken)}`,
      pass: signPrintPass(quotation.publicToken, QUOTATION_VIEW_SECONDS),
    } });
  } catch (error) {
    console.error("Unable to open the client's quotation:", error);
    return res.status(500).json({ message: "The quotation could not be opened. Please try again in a moment." });
  }
}

/**
 * One payment's receipt as a PDF - the same invoice the studio downloads from Cash Received, and
 * the studio's own document as it already gives it to clients (so it names who received the money,
 * which the JSON above does not).
 *
 * Asked for by the receipt's number (`?entry=DBS-MR-…`) and answered only for money Received on
 * the client's own project; any other number answers 404, so numbers cannot be tried for others'.
 * A query rather than a path segment so the route stays one exact line in `CLIENT_ROUTES`.
 */
async function getClientReceipt(req, res) {
  res.set("Cache-Control", "no-store");
  const entryId = String(req.query?.entry || "").trim();
  if (!/^[A-Za-z0-9-]{1,30}$/.test(entryId)) return res.status(404).json({ message: "Receipt not found." });
  try {
    const project = await prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } });
    const entry = project ? await prisma.cashEntry.findFirst({
      where: { entryId, projectId: project.id, deletedAt: null, entryType: "Received" },
      include: { handler: { select: { employeeName: true } } },
    }) : null;
    if (!entry) return res.status(404).json({ message: "Receipt not found." });
    const receipt = await receiptFor(entry);
    if (!receipt) return res.status(404).json({ message: "Receipt not found." });
    const pdf = await renderReceiptPdf(receipt);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Invoice-${entryId.replace(/[^A-Za-z0-9-]/g, "")}.pdf"`);
    res.setHeader("Content-Length", pdf.length);
    return res.end(pdf);
  } catch (error) {
    console.error("Unable to render the client's receipt:", error);
    if (res.headersSent) return undefined;
    return res.status(500).json({ message: "The receipt could not be prepared. Please try again in a moment." });
  }
}

/**
 * The studio's offers for the Home page of the client's app (Sales -> Client Offers): the live ones,
 * and the WhatsApp number an offer is asked about (and claimed) on - the one set in Client app
 * settings, or the phone of the client's own branch while none is set.
 */
async function getClientOffers(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const [offers, project, settings] = await Promise.all([
      clientOffers.liveOffers(),
      prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { sourceBranch: true } }),
      clientAppSettings.getSettings(),
    ]);
    const branch = !settings.offersWhatsapp && project?.sourceBranch ? await prisma.branch.findFirst({ where: { name: project.sourceBranch }, select: { phone: true } }) : null;
    return res.json({ data: { offers, whatsapp: settings.offersWhatsapp || branch?.phone || null } });
  } catch (error) {
    console.error("Unable to read the client's offers:", error);
    return res.status(500).json({ message: "Unable to load offers." });
  }
}

/** The client's own project for the chats (`chats/controller.js`): the same rule as every client route. */
async function ownChatProject(req) {
  return prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } });
}

/**
 * The client's referrals: `GET` lists the friends they have referred and where each stands; `POST`
 * refers one (`{ name, phone, choices: [{ kind, shoots }], note }`) - a CRM lead for each kind, with
 * the client as its reference, filed in their own branch for their project's CRM. See `./referrals.js`.
 */
async function getClientReferrals(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const [user, project, settings, offers, shootTypes] = await Promise.all([
      prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { username: true } }),
      prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } }),
      clientAppSettings.getSettings(),
      clientOffers.liveOffers("referral"),
      referrals.shootChoices(),
    ]);
    // Coins first, so a referral that has just booked shows what it earned.
    const coins = project ? await rewards.coinsFor(project.id, user?.username) : { balance: 0, entries: [] };
    const earned = new Map(coins.entries.map((entry) => [entry.referralId, entry.coins]));
    // One friend once, however many kinds of shoot they were referred for (a lead a kind in the CRM).
    const list = referrals.groupByFriend((await referrals.listReferrals(user?.username)).map((referral) => ({ ...referral, coins: earned.get(referral.id) ?? null })));
    return res.json({
      data: {
        referrals: list,
        coins: coins.balance,
        coinsPerBooking: settings.coinsPerBooking,
        // The studio's referral offers (Client Offers -> Referral offers), shown above the form.
        offers,
        // The shoots a referral may name, for each kind ({ wedding: [...], baby: [...], corporate: [...] }).
        shootTypes,
      },
    });
  } catch (error) {
    console.error("Unable to read the client's referrals:", error);
    return res.status(500).json({ message: "Unable to load your referrals. Please try again." });
  }
}

/** The client's coins (earned for referrals that booked): the balance, and what each was for. */
async function getClientCoins(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const [user, project] = await Promise.all([
      prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { username: true } }),
      prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } }),
    ]);
    return res.json({ data: project ? await rewards.coinsFor(project.id, user?.username) : { balance: 0, entries: [] } });
  } catch (error) {
    console.error("Unable to read the client's coins:", error);
    return res.status(500).json({ message: "Unable to load your coins." });
  }
}

async function createClientReferral(req, res) {
  try {
    const project = await prisma.salesProject.findFirst({
      where: await ownProjectWhere(req),
      select: { id: true, eventId: true, sourceBranch: true, crmName: true, enquiryId: true, groupNameGeneratorJson: true },
    });
    if (!project) return res.status(404).json({ message: "Your project could not be found. Please contact the studio." });
    const [user, lead] = await Promise.all([
      prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { username: true } }),
      project.enquiryId ? prisma.salesCrmLead.findUnique({ where: { enquiryId: project.enquiryId }, select: { name: true, groomName: true, brideName: true, companyName: true, babyOrMotherName: true } }) : null,
    ]);
    const result = await referrals.createReferral({ project, client: { name: clientOwnName(project, lead), mobile: user?.username }, input: req.body });
    if (result.error) return res.status(result.status).json({ message: result.error });
    // The first referral filed (as before), every lead filed - one a kind - and the kinds left out as
    // already in touch with the studio.
    return res.status(201).json({ data: { ...result.referral, referrals: result.referrals, already: result.already } });
  } catch (error) {
    console.error("Unable to save the client's referral:", error);
    return res.status(500).json({ message: "Your referral could not be sent. Please try again." });
  }
}

/** A decrypted PIN, or null when there is none or it cannot be read - as the studio's own screens treat it. */
function pinOf(decrypt, cipher) {
  if (!cipher) return null;
  try { return decrypt(cipher); } catch { return null; }
}

/*
 * What is waiting for the signed-in client to act on, each with the link and PIN the studio already
 * sends them on WhatsApp, so the client app can open it:
 *
 *   images - a published Image Selection gallery (not lapsed, `expiryOf`) - `state` "waiting" until
 *            the client submits, then "submitted" - with each item's chosen count, limit and
 *            submission, and `progress`: shared, first opened, last activity, submitted, and when
 *            the studio downloaded the selection (`selectedDownloadedAt`).
 *   album  - an Album Proofing album in CLIENT_REVIEW ("Ready for Your Review") with a live client
 *            publication: its version and correction round.
 *
 * The review itself happens on those existing client pages (`/g/<code>`, `/p/<code>`); this only says
 * that it is waiting. Found through the client's own project, never an id in the request. Read-only:
 * nothing here revokes, re-codes or otherwise writes, unlike the studio-side `status()` helpers.
 */
async function getClientReviews(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const project = await prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } });
    if (!project) return res.status(404).json({ message: "Your project could not be found. Please contact the studio." });

    const now = new Date();
    const moment = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);
    const selectionProjects = await prisma.imageSelectionProject.findMany({
      where: { salesProjectId: project.id, deletedAt: null },
      select: { id: true, albumProofing: true },
    });
    const galleryIds = selectionProjects.filter((row) => !row.albumProofing).map((row) => row.id);
    const albumIds = selectionProjects.filter((row) => row.albumProofing).map((row) => row.id);
    const reviews = [];

    if (galleryIds.length) {
      // Live galleries and submitted ones: a submitted selection stays listed (state "submitted") so
      // the client can follow it on to the studio. A lapsed or revoked gallery never submitted is gone.
      const publications = await prisma.imageSelectionGalleryPublication.findMany({
        where: {
          projectId: { in: galleryIds },
          shortCode: { not: null },
          OR: [{ status: "PUBLISHED" }, { selectionSubmittedAt: { not: null } }],
        },
        select: {
          id: true, projectId: true, shortCode: true, pinCipher: true, status: true, publishedAt: true, expiresAt: true,
          selectionSubmittedAt: true, galleryFirstOpenedAt: true, lastClientActivityAt: true,
        },
      });
      const downloadedAt = new Map((await prisma.imageSelectionProject.findMany({
        where: { id: { in: galleryIds } },
        select: { id: true, selectedDownloadedAt: true },
      })).map((row) => [row.id, row.selectedDownloadedAt]));
      for (const publication of publications) {
        const expiresAt = gallery.expiryOf(publication);
        const submitted = Boolean(publication.selectionSubmittedAt);
        if (!submitted && (publication.status !== "PUBLISHED" || !(expiresAt > now))) continue;
        const items = await prisma.imageSelectionDeliverableConfig.findMany({
          // An item whose shoot has not reached its day is not offered yet, so it is not listed either.
          where: { imageSelectionProjectId: publication.projectId, enabled: true, inactiveAt: null, ...reachedConfigWhere(now) },
          select: {
            name: true, manualShootName: true, selectionLimitOverride: true, selectionSubmittedAt: true,
            manualShootFolder: { select: { id: true, name: true } },
            shootDeliverable: { select: { deliverableName: true, selectionLimit: true, shoot: { select: { id: true, shoot: true } } } },
            _count: { select: { photoSelections: true } },
          },
          orderBy: { createdAt: "asc" },
        });
        // The photos there are to choose from, per shoot: the shoot's folder and the folders inside it,
        // as the gallery groups them. An item whose shoot has none yet has nothing to choose. The shoot's folder is found by id: a manual
        // item's own root folder, or the folder made for a Project Management shoot; only a hand-made
        // folder standing in for a shoot is still matched by name.
        const folders = await prisma.imageSelectionFolder.findMany({
          where: { projectId: publication.projectId },
          select: { id: true, name: true, parentId: true, projectShootId: true, _count: { select: { uploads: true } } },
        });
        const roots = folders.filter((folder) => !folder.parentId);
        const rootsOf = (item) => {
          if (item.manualShootFolder) return roots.filter((folder) => folder.id === item.manualShootFolder.id);
          const shoot = item.shootDeliverable?.shoot;
          if (shoot) {
            const byId = roots.filter((folder) => folder.projectShootId === shoot.id);
            if (byId.length) return byId;
          }
          const name = shoot?.shoot || item.manualShootName || null;
          return roots.filter((folder) => !name || folder.name.trim().toLowerCase() === name.trim().toLowerCase());
        };
        const photosOf = (item) => {
          const ids = new Set(rootsOf(item).map((folder) => folder.id));
          return folders.filter((folder) => ids.has(folder.id) || ids.has(folder.parentId)).reduce((sum, folder) => sum + folder._count.uploads, 0);
        };
        // Each item the client chooses for, with how far they have got: chosen so far, the limit, and
        // when they sent it - and how many photos there are for it.
        const named = items.map((item) => ({
          name: item.shootDeliverable?.deliverableName || item.name || "Selection",
          shoot: item.shootDeliverable?.shoot?.shoot || item.manualShootFolder?.name || item.manualShootName || null,
          photos: photosOf(item),
          chosen: item._count.photoSelections,
          limit: item.selectionLimitOverride ?? item.shootDeliverable?.selectionLimit ?? null,
          submittedAt: moment(item.selectionSubmittedAt),
        }));
        const studioReceivedAt = moment(downloadedAt.get(publication.projectId));
        reviews.push({
          id: `gallery-${publication.id}`,
          kind: "images",
          title: "Image Selection",
          event: [...new Set(named.map((item) => item.shoot).filter(Boolean))].join(", ") || null,
          items: named,
          version: null,
          round: null,
          state: submitted ? "submitted" : "waiting",
          status: studioReceivedAt ? "Received by the studio" : submitted ? "Selection submitted" : "Waiting for your selection",
          progress: {
            sharedAt: moment(publication.publishedAt),
            firstOpenedAt: moment(publication.galleryFirstOpenedAt),
            lastActivityAt: moment(publication.lastClientActivityAt),
            submittedAt: moment(publication.selectionSubmittedAt),
            studioReceivedAt,
          },
          sharedAt: moment(publication.publishedAt),
          expiresAt: moment(expiresAt),
          url: `${gallery.galleryBaseUrl()}/${publication.shortCode}`,
          pin: pinOf(gallery.decryptValue, publication.pinCipher),
        });
      }
    }

    if (albumIds.length) {
      const albums = await prisma.albumProof.findMany({
        where: { projectId: { in: albumIds }, deletedAt: null, archivedAt: null, status: "CLIENT_REVIEW" },
        select: {
          id: true, name: true, albumType: true, revisionLimit: true,
          publications: {
            where: { revokedAt: null, shortCode: { not: null } },
            orderBy: { publishedAt: "desc" },
            take: 1,
            select: { shortCode: true, pinCipher: true, publishedAt: true, expiresAt: true, revisionNumber: true, version: { select: { versionNumber: true } } },
          },
        },
      });
      for (const album of albums) {
        const publication = album.publications[0];
        if (!publication || (publication.expiresAt && publication.expiresAt <= now)) continue;
        reviews.push({
          id: `album-${album.id}`,
          kind: "album",
          state: "waiting",
          title: album.name,
          event: album.albumType || null,
          items: [],
          version: publication.version?.versionNumber ?? null,
          round: { number: publication.revisionNumber, max: album.revisionLimit ?? null },
          status: CLIENT_STATUS_LABELS.CLIENT_REVIEW || "Ready for your review",
          sharedAt: moment(publication.publishedAt),
          expiresAt: moment(publication.expiresAt),
          url: `${frontendOrigin()}/p/${publication.shortCode}`,
          pin: pinOf(albumSecurity.decryptValue, publication.pinCipher),
        });
      }
    }

    // The studio's answers to the client's requests, until they open them.
    for (const answer of await clientRequests.unseenAnswers(project.id).catch(() => [])) {
      reviews.push({
        id: `request-${answer.id}`,
        kind: "request",
        state: "waiting",
        title: answer.status === "answered" ? "The studio answered your question" : answer.status === "declined" ? "About your request" : "Added to your booking",
        event: [answer.shootName, `${answer.itemName}${answer.quantity > 1 ? ` x${answer.quantity}` : ""}`].filter(Boolean).join(" · "),
        items: [],
        version: null,
        round: null,
        status: answer.status === "accepted" ? (answer.price ? `Accepted - Rs ${Number(answer.price).toLocaleString("en-IN")}` : "Accepted - no extra charge") : answer.status === "declined" ? "Declined" : "Answered",
        reply: answer.reply || "",
        shootId: answer.shootId,
        sharedAt: answer.decidedAt,
        expiresAt: null,
        url: null,
        pin: null,
      });
    }

    reviews.sort((a, b) => String(b.sharedAt).localeCompare(String(a.sharedAt)));
    return res.json({ data: { reviews } });
  } catch (error) {
    console.error("Unable to read the client's reviews:", error);
    return res.status(500).json({ message: "Unable to load what needs your review. Please try again." });
  }
}

/**
 * The app on this phone registers for push notifications (`ClientPushToken`): the Expo push token
 * and the platform. A token signed in again with another login moves to it - one phone, one client.
 */
const PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;
async function registerPushToken(req, res) {
  const token = String(req.body?.token || "").trim();
  const platform = ["android", "ios"].includes(req.body?.platform) ? req.body.platform : null;
  if (!PUSH_TOKEN.test(token)) return res.status(400).json({ message: "Not a push token." });
  try {
    const userId = Number(req.user.id);
    await prisma.clientPushToken.upsert({ where: { token }, create: { token, platform, userId }, update: { platform, userId } });
    return res.status(204).end();
  } catch (error) {
    console.error("Unable to save the push token:", error);
    return res.status(500).json({ message: "Unable to turn on notifications." });
  }
}

/**
 * `GET /api/client/pre-production?event=`: the event's shoots the team has sent the client to fill
 * in, each with its questions, what is answered (and locked) and what is still owed.
 * `PATCH /api/client/pre-production/:shootId`: saves some answers - any number at a time.
 */
async function getClientPreProduction(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const project = await prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } });
    if (!project) return res.status(404).json({ message: "Your project could not be found. Please contact the studio." });
    return res.json({ data: { shoots: await preProduction.formsOfProject(project.id) } });
  } catch (error) {
    console.error("Unable to read the client's shoot details:", error);
    return res.status(500).json({ message: "Unable to read your shoot details." });
  }
}

async function saveClientPreProduction(req, res) {
  try {
    const result = await preProduction.saveAnswers(await clientProjectIds(req), String(req.params.shootId || ""), req.body);
    if (result.status !== 200) return res.status(result.status).json({ message: result.message, errors: result.errors });
    return res.json({ data: result.form });
  } catch (error) {
    console.error("Unable to save the client's shoot details:", error);
    return res.status(500).json({ message: "Unable to save your answers. Please try again." });
  }
}

/**
 * `GET /api/client/crd?event=`: the event's CRD document, once the studio has sent its link - the
 * link to DBS's own form (filled and submitted there, read by the studio under View), its status and
 * when it was submitted. `null` while there is none or it was never sent.
 */
async function getClientCrd(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const project = await prisma.salesProject.findFirst({ where: await ownProjectWhere(req), select: { id: true } });
    if (!project) return res.status(404).json({ message: "Your project could not be found. Please contact the studio." });
    const document = await prisma.salesProjectCrdDocument.findUnique({ where: { projectId: project.id }, select: { publicToken: true, status: true, submittedAt: true, updatedAt: true } });
    if (!document || document.status === "Not Sent") return res.json({ data: null });
    return res.json({ data: { url: `${frontendOrigin()}/crd/${document.publicToken}`, status: document.status, submittedAt: document.submittedAt?.toISOString() ?? null, sentAt: document.updatedAt.toISOString() } });
  } catch (error) {
    console.error("Unable to read the client's CRD document:", error);
    return res.status(500).json({ message: "Unable to read your CRD document." });
  }
}

/**
 * `GET /api/client/notifications`: what DBS pushed to this client that no project record stands for
 * (photos sent, an album published, the password changed) - for any of their events or for their
 * login, newest first. The app lists them in its bell beside what it reads from the projects.
 */
async function getClientNotifications(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const projectIds = await clientProjectIds(req);
    const rows = await prisma.clientNotification.findMany({
      where: { OR: [{ userId: Number(req.user.id) }, ...(projectIds.length ? [{ salesProjectId: { in: projectIds } }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, salesProjectId: true, type: true, title: true, body: true, createdAt: true },
    });
    const events = new Map((await prisma.salesProject.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.salesProjectId).filter(Boolean))] } }, select: { id: true, eventId: true } })).map((project) => [project.id, project.eventId]));
    return res.json({ data: { notifications: rows.map(({ salesProjectId, createdAt, ...row }) => ({ ...row, eventId: events.get(salesProjectId) ?? null, at: createdAt.toISOString() })) } });
  } catch (error) {
    console.error("Unable to read the client's notifications:", error);
    return res.status(500).json({ message: "Unable to read your notifications." });
  }
}

/** Signing out of the app on this phone: its token stops receiving this client's notifications. */
async function removePushToken(req, res) {
  const token = String(req.body?.token || "").trim();
  try {
    if (token) await prisma.clientPushToken.deleteMany({ where: { token, userId: Number(req.user.id) } });
    return res.status(204).end();
  } catch (error) {
    console.error("Unable to remove the push token:", error);
    return res.status(500).json({ message: "Unable to turn off notifications." });
  }
}

module.exports = { getClientPreProduction, saveClientPreProduction, getClientCrd, getClientNotifications, registerPushToken, removePushToken, requireClient, getClientProject, getClientProjects, getClientPackage, getClientPayments, getClientQuotationPdf, getClientQuotationView, getClientReceipt, getClientOffers, ownChatProject, getClientReferrals, getClientCoins, createClientReferral, getClientReviews, clientProjectIds, CLIENT_PROJECT_SELECT };
