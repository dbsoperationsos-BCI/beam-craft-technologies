const prisma = require("../../../config/db");
const { createCrmLead, findVerticalDuplicate } = require("../../sales/crm-leads/crmLeadService");
const { nextLeadId } = require("../../sales/crm-leads/csvImportService");
const { recordLeadActivity } = require("../../sales/crm-leads/activityService");
const { notifyLeadAssigned } = require("../../sales/crm-leads/leadNotifications");
const quotationBrands = require("../../sales/quotation-brands/service");

/*
 * A client's referrals, from their app: a friend's name and number become a CRM lead the way any
 * referral does - source "Referral", the client as its reference (`referenceName`, and their own
 * mobile as `referenceContact`), filed in the client's own branch and handed to their project's CRM.
 * `referredFrom` says it came from the app, which is also how the client's own list is found again:
 * their number as the reference, from the app. Nothing of the lead goes back to the client beyond its
 * name, what it was for, when, and where it stands in plain words.
 */

const FROM_APP = "Client app";
// What the client picks - `label` as the lead says it, `short` as the app shows it - the vertical it
// is filed under, and the brand whose shoots it offers.
const KINDS = {
  wedding: { label: "Wedding", short: "Wedding", vertical: "Dum Dum", brand: "DUM_DUM" },
  baby: { label: "Baby / kids / family", short: "Baby / Kids", vertical: "Qua Qua", brand: "QUA_QUA" },
  corporate: { label: "Corporate event", short: "Corporate", vertical: "Corp", brand: "CORP" },
};
// The most shoots one referral names.
const MAX_SHOOTS = 12;

/**
 * The shoots the client may name for each kind: the brand's own list, Settings -> Fields -> Shoot
 * Types - what the CRM's Add Lead and the Quotation Generator offer - so a referral names a shoot the
 * studio sells, spelled its way. A brand that cannot be read offers none (the kind alone still files).
 */
/** The shoots a referral names that `offered` holds, each once, in the client's order, at most MAX_SHOOTS. */
function namedShoots(given, offered) {
  return [...new Set((Array.isArray(given) ? given : []).map((shoot) => String(shoot || "").trim()).filter((shoot) => offered.has(shoot)))].slice(0, MAX_SHOOTS);
}

async function shootChoices() {
  const entries = await Promise.all(Object.entries(KINDS).map(async ([key, kind]) => [key, (await quotationBrands.brandShoots(kind.brand).catch(() => null)) || []]));
  return Object.fromEntries(entries);
}

/** Where a referral stands, in the client's words, from the lead's status. */
function stageOf(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value.startsWith("converted")) return "booked";
  if (["rejected", "invalid", "not interested", "lost", "closed"].some((word) => value.startsWith(word))) return "closed";
  if (!value || value === "yet to connect") return "new";
  return "talking";
}

const tenDigits = (value) => String(value || "").replace(/\D/g, "").slice(-10);

/** The client's referrals, newest first. */
async function listReferrals(clientMobile) {
  const mobile = tenDigits(clientMobile);
  if (!mobile) return [];
  const rows = await prisma.salesCrmLead.findMany({
    where: { referredFrom: FROM_APP, referenceContact: { contains: mobile }, deletedAt: null },
    select: { enquiryId: true, name: true, phone: true, vertical: { select: { code: true, name: true } }, eventPlannedType: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.enquiryId,
    name: row.name || "",
    // The number the client gave for their friend, and what the referral is for ("Wedding") - the
    // kind its vertical files under - beside the shoots named. Nothing the studio wrote on the lead.
    phone: row.phone || "",
    forKind: Object.values(KINDS).find((kind) => kind.brand === row.vertical?.code || kind.vertical === row.vertical?.name)?.short || "",
    kind: row.eventPlannedType || "",
    stage: stageOf(row.status),
    referredAt: row.createdAt ? row.createdAt.toISOString() : null,
  }));
}

// How far a referral has gone, furthest last: a friend is as far as their furthest lead.
const STAGE_ORDER = ["closed", "new", "talking", "booked"];

/**
 * The client's referrals as they think of them - one friend once. A friend referred for more than one
 * kind of shoot is a lead a kind in the CRM; here they are one entry with `parts` (each kind, its
 * shoots, where it stands and what it earned), gone as far as their furthest part, referred when the
 * first was, and the coins of all of them. Friends are told apart by their number. Each entry keeps
 * the fields of a single referral (`id`, `kind`, `stage`, `referredAt`, `coins`) for an app that reads
 * only those.
 */
function groupByFriend(list) {
  const friends = new Map();
  for (const referral of list) {
    const key = tenDigits(referral.phone) || referral.id;
    const friend = friends.get(key) || { id: referral.id, name: referral.name, phone: referral.phone, parts: [] };
    friend.parts.push({ id: referral.id, forKind: referral.forKind, kind: referral.kind, stage: referral.stage, referredAt: referral.referredAt, coins: referral.coins ?? null });
    friends.set(key, friend);
  }
  return [...friends.values()].map((friend) => {
    const parts = [...friend.parts].sort((a, b) => String(a.referredAt).localeCompare(String(b.referredAt)));
    const earned = parts.reduce((sum, part) => sum + (Number(part.coins) || 0), 0);
    return {
      ...friend,
      parts,
      kind: parts.map((part) => part.forKind || part.kind).filter(Boolean).join(", "),
      stage: parts.reduce((best, part) => (STAGE_ORDER.indexOf(part.stage) > STAGE_ORDER.indexOf(best) ? part.stage : best), "closed"),
      referredAt: parts[0]?.referredAt ?? null,
      coins: earned || null,
    };
  });
}

/**
 * What the friend's shoot is for: one kind or several, each with the shoots named for it. Read from
 * `choices` ([{ kind, shoots }]), or the single `kind` and `shoots` an earlier app sends. Unknown kinds
 * and a kind given twice are dropped; each kind keeps only its brand's own shoots.
 */
async function choicesOf(input) {
  const given = Array.isArray(input?.choices) ? input.choices : [{ kind: input?.kind, shoots: input?.shoots }];
  const choices = [];
  for (const choice of given.slice(0, Object.keys(KINDS).length)) {
    const key = String(choice?.kind || "");
    const kind = KINDS[key];
    if (!kind || choices.some((known) => known.key === key)) continue;
    const offered = new Set((await quotationBrands.brandShoots(kind.brand).catch(() => null)) || []);
    choices.push({ key, kind, shoots: namedShoots(choice?.shoots, offered) });
  }
  return choices;
}

/**
 * Files a referral. `project` is the client's own (its branch and CRM); `client` their name and
 * mobile. A lead belongs to one vertical, so a friend planning shoots of more than one kind - a
 * wedding and a baby shoot - becomes one lead a kind, each with its own shoots, each for that
 * vertical's team. A kind the friend is already in touch with the studio about is not filed twice.
 * Answers `{ referral, referrals, already }` - what was filed, and the kinds left out as already in
 * touch - or `{ error, status }` when nothing could be filed.
 */
async function createReferral({ project, client, input }) {
  const name = String(input?.name || "").trim().slice(0, 120);
  const phone = tenDigits(input?.phone);
  const note = String(input?.note || "").trim().slice(0, 500);
  const choices = await choicesOf(input);
  if (name.length < 2) return { status: 400, error: "Please enter your friend's name." };
  if (phone.length !== 10) return { status: 400, error: "Please enter your friend's 10-digit mobile number." };
  if (!choices.length) return { status: 400, error: "Please choose what the shoot is for." };
  if (phone === tenDigits(client.mobile)) return { status: 400, error: "That is your own number - please enter your friend's." };
  if (!project?.sourceBranch) return { status: 409, error: "Your booking has no branch yet. Please ask your project manager." };

  const filed = [];
  const already = [];
  for (const { kind, shoots } of choices) {
    if (await findVerticalDuplicate({ phone, vertical: kind.vertical })) {
      already.push(kind.label);
      continue;
    }
    filed.push(await fileLead({ project, client, name, phone, note, kind, shoots }));
  }
  if (!filed.length) return { status: 409, error: "This friend is already in touch with the studio. Thank you for thinking of us!" };
  return { referral: filed[0], referrals: filed, already };
}

/** One referral's lead, for one kind: filed, logged, and its CRM told. Answers the referral as the client lists it. */
async function fileLead({ project, client, name, phone, note, kind, shoots }) {
  const enquiryId = await nextLeadId({ vertical: kind.vertical, branch: project.sourceBranch });
  const remarks = [`Referred by ${client.name || "a client"} (${project.eventId}) from the client app.`, note].filter(Boolean).join(" ");
  // The shoots the friend is planning, when named ("Engagement, Reception"); otherwise the kind.
  const planned = shoots.length ? shoots.join(", ") : kind.label;
  const record = {
    lead: {
      id: enquiryId,
      name,
      phone,
      whatsappNumber: phone,
      vertical: kind.vertical,
      assignedBranch: project.sourceBranch,
      crm: project.crmName || "",
      source: "Referral",
      referredFrom: FROM_APP,
      referenceName: client.name || "",
      referenceContact: tenDigits(client.mobile),
      eventPlannedType: planned,
      remarks,
    },
    details: {},
  };
  const created = await createCrmLead(record);
  const id = created?.lead?.id || enquiryId;
  await recordLeadActivity(id, [{ action: "CREATED", fieldLabel: "Lead" }], { actorName: `${client.name || "Client"} (client app)` }).catch(() => {});
  // The project's CRM is told it is theirs, as for any lead entered in their name.
  await notifyLeadAssigned({ enquiryId: id, name }, { crm: project.crmName || "", actorId: null }).catch(() => {});
  return { id, name, kind: planned, stage: "new", referredAt: new Date().toISOString() };
}

module.exports = { listReferrals, groupByFriend, createReferral, choicesOf, shootChoices, namedShoots, stageOf, KINDS, FROM_APP };
