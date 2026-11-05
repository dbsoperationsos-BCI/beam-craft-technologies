const prisma = require("../../../config/db");
const { syncShootLinkedDueDates } = require("../../../services/shootLinkedDueDates");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const { storeImage, discardUploads } = require("../../../services/imageStorage");
const { storeDocument, MAX_DOCUMENT_BYTES } = require("../../../services/documentStorage");
const { shootVenues, shootVenueLengthIssue, shootVenueColumns } = require("../../../services/shootLocations");

/*
 * A shoot's pre production details, filled in by the client in the Beam Craft app.
 *
 * The team sends a shoot to the client from Pre Production (`clientFormSentAt`). The client is asked
 * the pre production fields of the team's own form - the vertical's checklist, travel and stay, the
 * location and the timings - in the same order and words (not the concepts or the groom's and bride's
 * addresses, which are the team's alone); whatever the team has already filled in is shown, not asked. The invitation, the dresses and the decor are files the client
 * uploads, several of each: photos, PDFs, Word or Excel documents. Every answer goes to the same column
 * the team's form reads, so it shows on the shoot's page as soon as the client submits it.
 *
 * Nothing has to be answered at once. Each answer is the client's to give once: an answer they have
 * submitted is locked for them (`clientAnswered`). A file set can be marked "not available".
 */

// The project's vertical, matched loosely as the team's form matches it.
function verticalOf(product) {
  const value = String(product || "").trim().toUpperCase();
  if (["DUM DUM", "WED", "DD"].includes(value)) return "dumdum";
  if (["QUA QUA", "QQ"].includes(value)) return "quaqua";
  return "base";
}

const INDOOR_TYPE = "Studio / In-House";
function isIndoor(shoot) {
  const listed = Array.isArray(shoot?.shootTypes) ? shoot.shootTypes.filter(Boolean) : [];
  return (listed[0] || shoot?.shootType || null) === INDOOR_TYPE;
}

// The three file sets and the checklist question each one answers on the team's form.
const FILE_KINDS = {
  invitation: { label: "Get Invitation Soft Copy", flag: "invitationSoftCopy" },
  dresses: { label: "Getting Dresses Images", flag: "gettingDressesImages" },
  decor: { label: "Getting Decor Images", flag: "gettingDecorImages" },
};
const MAX_FILES_PER_KIND = 10;
// The checklist's yes/no answers that are kept as words (Intro Call: Completed / Pending).
const WORD_YES_NO = new Set(["introCallGroom", "introCallBride", "introCall"]);
// Kept on the shoot itself rather than its pre production row (the same columns Edit Project shows).
const SHOOT_COLUMNS = { shootDate: "dateCreated", eventStartTime: "eventStartTime", eventEndTime: "eventEndTime" };

const yesno = (name, label, extra = {}) => ({ name, label, type: "yesno", required: true, ...extra });
const files = (kind) => ({ name: `files.${kind}`, label: FILE_KINDS[kind].label, type: "files", kind, required: true });
// A shoot held at several places is asked a venue under each name: "Haldi - Location Address".
// The link first, then the address, as the team's form asks them.
const VENUE_KEYS = { locationLink: { label: "Location Link", type: "url" }, locationAddress: { label: "Location Address", type: "textarea", required: true } };
const venueFields = (venues) => venues.flatMap(({ shoot }) => Object.entries(VENUE_KEYS).map(([key, field]) => ({
  name: `${key}:${shoot}`, ...field, label: `${shoot} - ${field.label}`, venue: { shoot, key },
})));

/**
 * The questions for one shoot, in the team's form's sections and order. `required` ones count towards
 * "done" (the shoot leaves Action Needed when they are all answered); links and remarks are extras.
 * `when` names the yes/no a question only follows on. The concepts and the groom's and bride's
 * addresses are the team's alone and never asked of the client.
 */
function questionsFor(vertical, indoor, venues = null) {
  const sections = [];
  if (vertical === "dumdum") {
    sections.push({ id: "checklist", title: "Dum Dum Checklist", fields: [
      yesno("introCallGroom", "Intro Call - Groom"),
      yesno("introCallBride", "Intro Call - Bride"),
      { name: "introCallRemarks", label: "Intro Call Remarks", type: "textarea" },
      yesno("eventScheduleMeeting", "Event Schedule Meeting"),
      { name: "meetingDate", label: "Meeting Date", type: "date", when: "eventScheduleMeeting", required: true },
      { name: "meetingTime", label: "Meeting Time", type: "time", when: "eventScheduleMeeting", required: true },
      { name: "meetingLink", label: "Meeting Link", type: "url", when: "eventScheduleMeeting" },
      files("invitation"),
      { name: "invitationLink", label: "Invitation Link", type: "url" },
      files("dresses"),
      files("decor"),
      yesno("siteVisit", "Site Visit"),
      yesno("postWeddingGift", "Post Wedding Gift"),
    ] });
  } else if (vertical === "quaqua") {
    sections.push({ id: "checklist", title: "Qua Qua Checklist", fields: [
      yesno("introCall", "Intro Call"),
      { name: "introCallRemarks", label: "Intro Call Remarks", type: "textarea" },
      files("dresses"),
    ] });
  }
  if (!indoor) {
    sections.push({ id: "travel", title: "Travel & Accommodation", fields: [
      yesno("travelAccommodationNeeded", "Travel & Accommodation Needed"),
      { name: "accommodationAddress", label: "Accommodation Location Address", type: "textarea", when: "travelAccommodationNeeded", required: true },
      { name: "accommodationLink", label: "Accommodation Link", type: "url", when: "travelAccommodationNeeded" },
      { name: "accommodationRemarks", label: "Remarks", type: "textarea", when: "travelAccommodationNeeded" },
    ] });
    sections.push({ id: "location", title: "Location", fields: venues ? venueFields(venues) : [
      { name: "locationAddress", label: "Location Address", type: "textarea", required: true },
      { name: "locationLink", label: "Location Link", type: "url" },
    ] });
  }
  sections.push({ id: "timing", title: "Event Timing", fields: [
    { name: "shootDate", label: "Shoot Date", type: "date", required: true },
    { name: "eventStartTime", label: "Event Start Time", type: "time", required: true },
    { name: "eventEndTime", label: "Event End Time", type: "time", required: true },
    { name: "reportingTime", label: "Reporting Time", type: "time", required: true },
    { name: "scheduleRemarks", label: "Remarks", type: "textarea" },
  ] });
  return sections;
}

const filledText = (value) => typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
const isYes = (name, value) => (WORD_YES_NO.has(name) ? value === "Completed" : value === true);
const dayOf = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null);

/** The current answer to a question, read the way the app shows it. */
function answerOf(field, { pre, shoot, uploads, venues }) {
  if (field.venue) return venues.find((venue) => venue.shoot === field.venue.shoot)?.[field.venue.key] ?? null;
  if (field.type === "files") return uploads.filter((file) => file.kind === field.kind).map(({ id, url, fileName, mimeType }) => ({ id, url, name: fileName, mimeType }));
  if (field.type === "concepts") return (pre?.concepts || []).map(({ reference, remarks }) => ({ reference, remarks }));
  const raw = SHOOT_COLUMNS[field.name] ? shoot[SHOOT_COLUMNS[field.name]] : pre?.[field.name];
  if (field.type === "yesno") return raw === null || raw === undefined ? null : isYes(field.name, raw);
  if (field.type === "date") return dayOf(raw);
  return raw ?? null;
}

/**
 * Whether a question can still be answered by the client: not once they submitted it, and not when
 * the team has. A yes/no the team never touched reads its default (No / Pending), so for those only
 * the client's own answer, or a team Yes, counts as given.
 */
function lockedOf(field, value, answered) {
  if (answered.includes(field.name)) return true;
  if (field.type === "yesno") return value === true;
  if (field.type === "files" || field.type === "concepts") return Array.isArray(value) && value.length > 0;
  return filledText(value);
}

/** One shoot's form as the app draws it. */
function formFor({ shoot, pre, uploads, vertical }) {
  const answered = Array.isArray(pre?.clientAnswered) ? pre.clientAnswered : [];
  const values = {};
  const venues = shootVenues(shoot, pre);
  const sections = questionsFor(vertical, isIndoor(shoot), venues).map((section) => ({
    ...section,
    fields: section.fields.map((field) => {
      const value = answerOf(field, { pre, shoot, uploads, venues });
      values[field.name] = value;
      return {
        ...field,
        value,
        locked: lockedOf(field, value, answered),
        // A file set the client said they do not have.
        notAvailable: field.type === "files" && answered.includes(`${field.name}:none`),
      };
    }),
  }));
  // What is still owed: each required question that applies and is not yet answered.
  const pending = sections.flatMap((section) => section.fields)
    .filter((field) => field.required && (!field.when || values[field.when] === true))
    .filter((field) => !(field.locked || field.notAvailable))
    .map((field) => field.label);
  return {
    shootId: shoot.id,
    shoot: shoot.shoot,
    code: shoot.shootId,
    date: dayOf(shoot.dateCreated),
    sentAt: pre?.clientFormSentAt ? pre.clientFormSentAt.toISOString() : null,
    sections,
    venues,
    pending,
    done: pending.length === 0,
  };
}

const shootSelect = { id: true, shootId: true, shoot: true, dateCreated: true, eventStartTime: true, eventEndTime: true, shootType: true, shootTypes: true, shootLocations: true, projectId: true };
const preSelect = {
  id: true, clientFormSentAt: true, clientAnswered: true,
  conceptsNeeded: true, travelAccommodationNeeded: true, locationAddress: true, locationLink: true, locations: true,
  accommodationAddress: true, accommodationLink: true, accommodationRemarks: true,
  reportingTime: true, scheduleRemarks: true,
  groomAddress: true, brideAddress: true, introCallGroom: true, introCallBride: true, introCall: true, introCallRemarks: true,
  eventScheduleMeeting: true, meetingDate: true, meetingTime: true, meetingLink: true, invitationLink: true,
  siteVisit: true, postWeddingGift: true,
  concepts: { select: { reference: true, remarks: true }, orderBy: { position: "asc" } },
  clientImages: { select: { id: true, kind: true, url: true, fileName: true, mimeType: true }, orderBy: { createdAt: "asc" } },
};

/** The forms of one project: its shoots the team has sent to the client, in date order. */
async function formsOfProject(projectId) {
  const project = await prisma.salesProject.findUnique({ where: { id: projectId }, select: { vertical: true } });
  const shoots = await prisma.projectShoot.findMany({
    where: { projectId, deletedAt: null, preProduction: { clientFormSentAt: { not: null } } },
    select: { ...shootSelect, preProduction: { select: preSelect } },
    orderBy: { dateCreated: SHOOT_DATE_ASC },
  });
  const vertical = verticalOf(project?.vertical);
  return shoots.map((shoot) => formFor({ shoot, pre: shoot.preProduction, uploads: shoot.preProduction.clientImages, vertical }));
}

const isUrl = (value) => /^https?:\/\/\S+$/i.test(String(value || "").trim());
const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());

/**
 * The answers a submit may write: questions of this shoot's form that are still open. Anything else -
 * a locked answer, a question the shoot is not asked, a malformed value - is refused with the reason.
 */
function validAnswers(form, body) {
  const fields = new Map(form.sections.flatMap((section) => section.fields).map((field) => [field.name, field]));
  const answers = {};
  const errors = [];
  for (const [name, raw] of Object.entries(body?.answers || {})) {
    const field = fields.get(name);
    if (!field || field.type === "files") continue;
    if (field.locked) { errors.push(`${field.label} is already submitted.`); continue; }
    if (field.type === "yesno") {
      if (typeof raw !== "boolean") { errors.push(`Choose Yes or No for "${field.label}".`); continue; }
      answers[name] = raw;
    } else if (field.type === "time") {
      if (!isTime(raw)) { errors.push(`Choose a time for ${field.label}.`); continue; }
      answers[name] = raw;
    } else if (field.type === "date") {
      if (!isDay(raw)) { errors.push(`Choose a date for ${field.label}.`); continue; }
      answers[name] = raw;
    } else if (field.type === "url") {
      if (!filledText(raw)) continue;
      if (!isUrl(raw)) { errors.push(`${field.label} must be a link starting with https://`); continue; }
      answers[name] = String(raw).trim().slice(0, 2048);
    } else if (field.type === "concepts") {
      const list = (Array.isArray(raw) ? raw : []).map((row) => ({ reference: String(row?.reference || "").trim().slice(0, 2048) || null, remarks: String(row?.remarks || "").trim().slice(0, 5000) || null }))
        .filter((row) => row.reference || row.remarks).slice(0, 20);
      if (list.some((row) => row.reference && !isUrl(row.reference))) { errors.push("Concept links must start with https://"); continue; }
      if (list.length) answers[name] = list;
    } else {
      if (!filledText(raw)) continue;
      answers[name] = String(raw).trim().slice(0, 5000);
    }
  }
  const uploads = {};
  for (const [kind, list] of Object.entries(body?.files || {})) {
    const field = fields.get(`files.${kind}`);
    if (!field) continue;
    if (field.locked || field.notAvailable) { errors.push(`${field.label} is already submitted.`); continue; }
    if (list === "none") { uploads[kind] = "none"; continue; }
    const sent = (Array.isArray(list) ? list : []).filter((file) => typeof file?.data === "string" && file.data.startsWith("data:"));
    if (!sent.length) continue;
    if (sent.length > MAX_FILES_PER_KIND) { errors.push(`Add up to ${MAX_FILES_PER_KIND} files for ${field.label} at a time.`); continue; }
    uploads[kind] = sent.map((file) => ({ name: String(file.name || "file").slice(0, 255), data: file.data }));
  }
  return { answers, uploads, errors };
}

/** One file, stored: a photo compressed like the cover, anything else kept as sent (PDF, Word...). */
async function storeFile(file) {
  const mimeType = (/^data:([^;,]+);base64,/.exec(file.data) || [])[1] || "";
  if (/^image\/(jpeg|png|webp|heic|heif|gif|avif)$/i.test(mimeType)) {
    const stored = await storeImage(file.data, { folder: "projects/pre-production/client", maxBytes: 600 * 1024, maxDimension: 2000 });
    return { url: stored.url, key: stored.key, fileName: file.name, mimeType: stored.mimeType || mimeType };
  }
  const stored = await storeDocument({ name: file.name, data: file.data }, { folder: "projects/pre-production/client" });
  return { url: stored.url || stored.data, key: stored.key, fileName: file.name, mimeType };
}

/** Saves a client's answers to one shoot, then answers with the shoot's form as it now stands. */
async function saveAnswers(projectIds, shootId, body) {
  const shoot = await prisma.projectShoot.findFirst({
    where: { id: shootId, deletedAt: null, projectId: { in: projectIds }, project: { deletedAt: null }, preProduction: { clientFormSentAt: { not: null } } },
    select: { ...shootSelect, project: { select: { vertical: true } }, preProduction: { select: preSelect } },
  });
  if (!shoot) return { status: 404, message: "This shoot could not be found. Please contact the studio." };
  const vertical = verticalOf(shoot.project.vertical);
  const form = formFor({ shoot, pre: shoot.preProduction, uploads: shoot.preProduction.clientImages, vertical });
  const { answers, uploads, errors } = validAnswers(form, body);
  if (errors.length) return { status: 400, message: errors[0], errors };
  if (!Object.keys(answers).length && !Object.keys(uploads).length) return { status: 400, message: "Fill in at least one answer to submit." };

  // A venue answered under one name is saved with the others as they stand.
  const fields = new Map(form.sections.flatMap((section) => section.fields).map((field) => [field.name, field]));
  const venueAnswers = Object.keys(answers).filter((name) => fields.get(name)?.venue);
  const venues = venueAnswers.length ? form.venues.map((venue) => ({ ...venue })) : null;
  for (const name of venueAnswers) {
    const { shoot: venueShoot, key } = fields.get(name).venue;
    venues.find((entry) => entry.shoot === venueShoot)[key] = answers[name];
  }
  const venueIssue = venues ? shootVenueLengthIssue(venues) : "";
  if (venueIssue) return { status: 400, message: venueIssue, errors: [venueIssue] };

  // The files go up first, outside the transaction; any that a failed save leaves behind are removed.
  const stored = {};
  try {
    for (const [kind, list] of Object.entries(uploads)) {
      if (list === "none") continue;
      stored[kind] = [];
      for (const file of list) stored[kind].push(await storeFile(file));
    }
    await prisma.$transaction(async (transaction) => {
      const preId = shoot.preProduction.id;
      const answered = new Set(Array.isArray(shoot.preProduction.clientAnswered) ? shoot.preProduction.clientAnswered : []);
      const { concepts, ...rest } = answers;
      const shootData = {};
      const columns = {};
      for (const [name, value] of Object.entries(rest)) {
        if (fields.get(name)?.venue) continue;
        if (SHOOT_COLUMNS[name]) shootData[SHOOT_COLUMNS[name]] = name === "shootDate" ? new Date(`${value}T00:00:00.000Z`) : value;
        else if (WORD_YES_NO.has(name)) columns[name] = value ? "Completed" : "Pending";
        else if (name === "meetingDate") columns[name] = new Date(`${value}T00:00:00.000Z`);
        else columns[name] = value;
      }
      if (venues) Object.assign(columns, shootVenueColumns(venues));
      if (Object.keys(shootData).length) await transaction.projectShoot.update({ where: { id: shoot.id }, data: shootData });
      // A payment due on this shoot moves with the date the client gave.
      if ("dateCreated" in shootData) await syncShootLinkedDueDates(transaction, shoot.projectId);
      if (concepts) {
        await transaction.projectPreProductionConcept.deleteMany({ where: { preProductionId: preId } });
        await transaction.projectPreProductionConcept.createMany({ data: concepts.map((concept, position) => ({ ...concept, position, preProductionId: preId })) });
        columns.conceptsNeeded = true;
      }
      for (const [kind, list] of Object.entries(stored)) {
        await transaction.projectPreProductionImage.createMany({ data: list.map((file) => ({ preProductionId: preId, kind, url: file.url, fileName: file.fileName, mimeType: file.mimeType })) });
        // The team's checklist says the files are in.
        columns[FILE_KINDS[kind].flag] = true;
        answered.add(`files.${kind}`);
      }
      for (const [kind, value] of Object.entries(uploads)) if (value === "none") answered.add(`files.${kind}:none`);
      for (const name of Object.keys(answers)) answered.add(name);
      await transaction.projectPreProduction.update({ where: { id: preId }, data: { ...columns, clientAnswered: [...answered] } });
    });
  } catch (error) {
    await discardUploads(Object.values(stored).flat().filter((file) => file.key));
    throw error;
  }
  const [saved] = (await formsOfProject(shoot.projectId)).filter((entry) => entry.shootId === shoot.id);
  return { status: 200, form: saved, projectId: shoot.projectId, shoot: shoot.shoot };
}

/**
 * One shoot's whole pre production form, sent to the client or not - with the project it belongs to.
 * For the team's PDF of the form.
 */
async function formOfShoot(shootId) {
  const shoot = await prisma.projectShoot.findFirst({
    // Not a shoot of a project in the Recycling Bin.
    where: { id: shootId, deletedAt: null, project: { deletedAt: null } },
    select: { ...shootSelect, shootPlace: true, project: { select: { eventId: true, whatsappGroupName: true, clientMainNumber: true, vertical: true } }, preProduction: { select: preSelect } },
  });
  if (!shoot) return null;
  const pre = shoot.preProduction || { concepts: [], clientImages: [] };
  const form = formFor({ shoot, pre, uploads: pre.clientImages || [], vertical: verticalOf(shoot.project.vertical) });
  return { form, shoot, project: shoot.project };
}

/** One uploaded file of a shoot, for the team's Download: its bytes and name. */
async function fileOfShoot(shootId, fileId) {
  const file = await prisma.projectPreProductionImage.findFirst({
    where: { id: fileId, preProduction: { shootId, shoot: { deletedAt: null, project: { deletedAt: null } } } },
    select: { url: true, fileName: true, mimeType: true, kind: true },
  });
  if (!file) return null;
  const inline = /^data:([^;,]+);base64,(.+)$/s.exec(file.url);
  if (inline) return { buffer: Buffer.from(inline[2], "base64"), mimeType: inline[1], fileName: file.fileName || file.kind };
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`The file could not be fetched (${response.status}).`);
  return { buffer: Buffer.from(await response.arrayBuffer()), mimeType: file.mimeType || response.headers.get("content-type") || "application/octet-stream", fileName: file.fileName || file.kind };
}

module.exports = { formsOfProject, formFor, formOfShoot, saveAnswers, fileOfShoot, questionsFor, verticalOf, FILE_KINDS, MAX_DOCUMENT_BYTES };
