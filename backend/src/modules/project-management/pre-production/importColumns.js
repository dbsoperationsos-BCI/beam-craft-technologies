const { z } = require("zod");
const { asList } = require("../../../services/tableImport");
const { NAME_BY_CODE } = require("../../../services/salesVertical");
const projects = require("../../sales/projects/controller");

/*
 * Pre Production → Import: what a file may carry and how each cell is read.
 *
 * One row per shoot of the studio's old pre production sheet - the booking's details repeated on
 * every shoot of it, under the sheet's own "DBS-EVT-05044" / "DBS-SID-2519" numbering. One template
 * per vertical, because each vertical's pre production asks its own questions (the vertical
 * checklists on `ProjectPreProduction`) and a combined sheet would be mostly blank columns. The
 * browser's copy is `frontend/src/constants/importColumns.js`; a test fails if the two differ.
 *
 * What a row writes is `import.service.js`; the routes are `import.js`.
 */

const VERTICALS = Object.keys(NAME_BY_CODE);

// ---- Cells a spreadsheet holds as text ----
// A parser never throws: `importTableRows` reads cells outside its per-row catch, so a bad cell is
// handed on unchanged and the schema refuses it with the column's own message.

/*
 * The words the old sheet writes where it has no answer - "IN OLD SHEET", "WCR" (waiting for the
 * client's reply), "NA", "#REF!" - are no answer, in every column, and come in empty. What is known
 * is imported; what is not is filled in later on the board, rather than refusing the whole row.
 */
const PLACEHOLDER = /^(in old sheet|wcr|wrc|na|n\/a|nil|#ref!?|#n\/a|null|none|tbd|ytd|-+|—)$/i;
const isPlaceholder = (value) => PLACEHOLDER.test(String(value ?? "").trim());

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/*
 * DD-MM-YYYY (or DD/MM/YYYY), or the day first with the month by name - "6 Sept 2026",
 * "08-Aug-2026", "3 July 2026". Strict otherwise, because `new Date("10-06-2026")` is the 6th of
 * October: a month written first ("June 5 2026", "7/31/2026") is refused rather than guessed.
 */
function parseDate(value) {
  const text = String(value).trim();
  // A clock time typed into a date column ("8:00 AM") is not a date of any kind: it comes in empty.
  if (/^\d{1,2}\s*[:.]\s*\d{2}(\s*[:.]\s*\d{2})?\s*([ap]m)?$/i.test(text)) return undefined;
  let day, month, year;
  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const named = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s*[-\s]\s*([a-z]+)\.?\s*[-\s,]\s*(\d{4})$/i);
  if (numeric) [day, month, year] = numeric.slice(1).map(Number);
  else if (named && MONTHS.includes(named[2].slice(0, 3).toLowerCase())) {
    // Only a month's own name or its short form: "Sept", "September", "Sep" - never "Sepxyz".
    const word = named[2].toLowerCase();
    const index = MONTHS.indexOf(word.slice(0, 3));
    const full = new Date(Date.UTC(2000, index, 1)).toLocaleString("en", { month: "long", timeZone: "UTC" }).toLowerCase();
    if (!full.startsWith(word)) return value;
    [day, month, year] = [Number(named[1]), index + 1, Number(named[3])];
  } else return value;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day && date.getUTCMonth() === month - 1 ? date : value;
}

/**
 * A clock time the way the sheet writes it, kept as 24-hour HH:MM: "6:15 PM", "11:00:00 AM",
 * "10.30 am", "5.00AM", "10. 00 am", "11:OO AM" (letter O), "1:00 Pm (16-Nov-2026)", "8:30". A cell
 * that holds no reading time comes in empty rather than refusing the row.
 */
function parseTime(value) {
  const text = String(value).toUpperCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/MIDNIGHT/g, " ")
    // "11:OO" - the letter O typed for a zero, read as the zero it was meant to be.
    .replace(/[\dO]{1,2}\s*[:.]\s*[\dO]{2}/g, (clock) => clock.replace(/O/g, "0"))
    .replace(/\s*([:.])\s*/g, "$1")
    .trim();
  const match = text.match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*(AM|PM)?$/);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) return undefined;
  if (match[3]) {
    if (hours < 1 || hours > 12) return undefined;
    hours = (hours % 12) + (match[3] === "PM" ? 12 : 0);
  } else if (hours > 23) return undefined;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

/** Yes or No. Anything else - "in bride home", a remark - says neither, so it comes in empty. */
function parseYesNo(value) {
  const key = String(value).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(key)) return true;
  if (["no", "n", "false", "0"].includes(key)) return false;
  return undefined;
}

/**
 * The first web link in the cell. The sheet often writes ":https://…", "Bride https://…, Groom
 * https://…" or a Google Maps address without its scheme; text with no link in it comes in empty.
 */
function parseLink(value) {
  const text = String(value);
  // Up to the next space, then without a trailing comma: "…?q=17.6,80.8" keeps its coordinates,
  // and "https://a, https://b" gives the first.
  const tidy = (found) => found.replace(/[,;]+$/, "");
  const link = text.match(/https?:\/\/\S+/);
  if (link) return tidy(link[0]);
  const bare = text.match(/\b((?:www\.)?(?:google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl|share\.google)\S*)/i);
  return bare ? `https://${tidy(bare[1])}` : undefined;
}

/*
 * The sheet's own words for a project's status, in the app's. "Pending" and "Yet to Start" are a
 * booking still being worked, and "Completed" is the sheet's word for a shoot that has been done,
 * not a project delivered: the project has moved on to editing. Both are In Progress here.
 */
function parseProjectStatus(value) {
  const key = String(value).trim().toLowerCase();
  if (["pending", "wip", "in progress", "work in progress", "yet to start", "completed", "complete"].includes(key)) return "In Progress";
  return value;
}

function parseProgress(value) {
  const key = String(value).trim().toLowerCase();
  if (key === "pending") return "Pending";
  if (key === "completed" || key === "done") return "Completed";
  return value;
}

const SHOOT_TYPES = { studio: "Studio / In-House", inhouse: "Studio / In-House", outdoor: "Outdoor / On-Location", onlocation: "Outdoor / On-Location", location: "Outdoor / On-Location" };
const SESSION_TIMINGS = { hourly: "Hourly", half: "Half Session", halfsession: "Half Session", full: "Full Session", fullsession: "Full Session" };
// Unrecognised words are dropped rather than refused: an empty answer is allowed, a wrong one is not.
const optionFrom = (map) => (value) => {
  const read = asList(value).map((part) => {
    const key = part.toLowerCase().replace(/[^a-z]/g, "");
    return map[key] || Object.entries(map).find(([prefix]) => key.startsWith(prefix))?.[1] || null;
  }).filter(Boolean);
  return read.length ? [...new Set(read)] : undefined;
};

// ---- The columns ----

const column = (field, label, extra = {}) => ({ field, label, ...extra });
const date = (field, label) => column(field, label, { parse: parseDate, kind: "date" });
const time = (field, label) => column(field, label, { parse: parseTime });
const link = (field, label) => column(field, label, { parse: parseLink });
const yesNo = (field, label) => column(field, label, { parse: parseYesNo, kind: "yesNo" });
const progress = (field, label) => column(field, label, { parse: parseProgress, kind: "progress" });

/** The people on the project, by Employee Code. Field -> the project's id and name columns. */
const PEOPLE = [
  { field: "crmCode", label: "CRM Employee Code", idField: "crmEmployeeId", nameField: "crmName", required: true },
  { field: "projectManagerCode", label: "Project Manager Employee Code", idField: "projectManagerEmployeeId", nameField: "projectManager" },
  { field: "preProductionCoordinatorCode", label: "Pre Production Coordinator Employee Code", idField: "preProductionCoordinatorEmployeeId", nameField: "preProductionCoordinator", required: true },
  { field: "creativeManagerCode", label: "Creative Manager Employee Code", idField: "creativeManagerEmployeeId", nameField: "creativeManager" },
  { field: "postProductionCoordinatorCode", label: "Post Production Coordinator Employee Code", idField: "postProductionCoordinatorEmployeeId", nameField: "postProductionCoordinator" },
  { field: "productionManagerCode", label: "Production Manager Employee Code", idField: "productionManagerEmployeeId", nameField: "productionManager" },
  // `late`: read like any other people cell, but placed with its own Applicable answer at the end of
  // the template rather than among the project's roles.
  { field: "welcomeGiftCode", label: "Welcome Gift Assignee Employee Code", idField: "welcomeGiftEmployeeId", nameField: "welcomeGiftAssignee", late: true },
  { field: "shootCompletedGiftCode", label: "Shoot Completed Gift Assignee Employee Code", idField: "shootCompletedGiftEmployeeId", nameField: "shootCompletedGiftAssignee", late: true },
];

const PROJECT_COLUMNS = [
  column("sheetEventId", "Event ID", { required: true }),
  column("whatsappGroupName", "Client Name", { required: true }),
  column("clientMainNumber", "Client Number", { required: true }),
  column("sourceBranch", "Branch", { required: true }),
  column("initialConvertedValue", "Initial Converted Value"),
  column("projectStatus", "Project Status", { parse: parseProjectStatus }),
  ...PEOPLE.filter((person) => !person.late).map(({ field, label, required }) => column(field, label, { required: Boolean(required) })),
];

/** "Applicable" / "Not Applicable", read whatever the sheet's case and spacing. Anything else is refused. */
const parseApplicable = (value) => ({ applicable: "Applicable", notapplicable: "Not Applicable", yes: "Applicable", no: "Not Applicable" }[String(value).trim().toLowerCase().replace(/[^a-z]/g, "")] ?? value);
/** "Yes" / "No", as the project's own Storage Needed answer holds it. */
const parseYesNoText = (value) => ({ yes: "Yes", no: "No" }[String(value).trim().toLowerCase().replace(/[^a-z]/g, "")] ?? value);

const SHOOT_COLUMNS = (vertical) => [
  column("sheetShootId", "Shoot ID", { required: true }),
  column("shoot", "Shoot Name", { required: true }),
  date("dateCreated", "Shoot Date"),
  // Yes on the booking's main shoot: the project's Main Event Date is that shoot's date, as in the app.
  yesNo("isMainEvent", "Main Event"),
  column("shootPlace", "Shoot Place", { required: true }),
  column("district", "District", { required: true }),
  column("state", "State", { required: true }),
  column("shootTypes", "Shoot Type", { required: true, parse: optionFrom(SHOOT_TYPES) }),
  column("sessionTimings", "Session Timing", { required: true, parse: optionFrom(SESSION_TIMINGS) }),
  column("sessionDurationHours", "Session Hours"),
  // A wedding covers one side or both; every other vertical is "Both", as the shoot form has it.
  ...(vertical === "WED" ? [column("preference", "Preference")] : []),
  time("eventStartTime", "Event Start Time"),
  time("eventEndTime", "Event End Time"),
];

const SHARED_PRE_PRODUCTION = [
  column("locationAddress", "Location Address"),
  link("locationLink", "Location Link"),
  time("reportingTime", "Reporting Time"),
  date("studioStartDate", "Studio Start Date"),
  time("studioStartTime", "Studio Start Time"),
  column("scheduleRemarks", "Schedule Remarks"),
  column("conceptReference", "Concept Reference"),
  column("conceptRemarks", "Concept Remarks"),
  yesNo("travelAccommodationNeeded", "Travel & Accommodation Needed"),
  column("accommodationAddress", "Accommodation Address"),
  link("accommodationLink", "Accommodation Link"),
  column("accommodationRemarks", "Accommodation Remarks"),
];

const CHECKLIST = {
  WED: [
    column("introCallRemarks", "Intro Call Remarks"),
    yesNo("gettingDressesImages", "Getting Dresses Images"),
    yesNo("shootCompletionMessage", "Shoot Completion Message"),
    column("groomAddress", "Groom Address"),
    column("brideAddress", "Bride Address"),
    progress("introCallGroom", "Intro Call Groom"),
    progress("introCallBride", "Intro Call Bride"),
    yesNo("eventScheduleMeeting", "Event Schedule Meeting"),
    date("meetingDate", "Meeting Date"),
    time("meetingTime", "Meeting Time"),
    link("meetingLink", "Meeting Link"),
    yesNo("invitationSoftCopy", "Invitation Soft Copy"),
    link("invitationLink", "Invitation Link"),
    yesNo("gettingDecorImages", "Getting Decor Images"),
    yesNo("siteVisit", "Site Visit"),
    yesNo("teamReachedMessage", "Team Reached Message"),
    yesNo("postWeddingGift", "Post Wedding Gift"),
  ],
  QQ: [
    column("introCallRemarks", "Intro Call Remarks"),
    progress("introCall", "Intro Call"),
    yesNo("gettingDressesImages", "Getting Dresses Images"),
    yesNo("shootCompletionMessage", "Shoot Completion Message"),
  ],
  // Corporate asks only the shared questions.
  CORP: [],
};

/** A column whose placeholder words ("IN OLD SHEET", "WCR", "NA" …) come in empty before its own reading. */
const tolerant = (definition) => ({ ...definition, parse: (value) => (isPlaceholder(value) ? undefined : definition.parse ? definition.parse(value) : value) });

/** Every column a vertical's file may carry, in template order. */
/*
 * The day the booking was made, as the studio's old sheet has it, kept at the end of every template
 * because it belongs to the **project** rather than to the shoot beside it: one booking's rows all
 * carry the same date, as its Event ID and client do.
 *
 * It is written to the project's own `created_at` - the column every "newest first" list sorts by -
 * so an old booking sits where it belongs rather than on the day the file was uploaded. Left empty,
 * the project keeps the date it has (the import's own day, for a project this file creates).
 */
/*
 * The project's own answers, at the end of every template because they belong to the **booking**
 * rather than to the shoot each row carries: one booking's rows all repeat them, as its Event ID and
 * client do.
 *
 * The two gifts and Storage Needed are the General panel's "does this apply" answers. Storage
 * Needed = Yes is what raises the project's Client Storage record - the register gives it its own
 * Storage ID and links it to the project and its earliest shoot - and "Received The Storage" = Yes
 * then marks that record **Delivered**, the end of the register's flow, which is where a disc the old
 * sheet has already seen through belongs.
 */
const PROJECT_ANSWERS = [
  column("welcomeGift", "Welcome Gift", { parse: parseApplicable }),
  column("shootCompletedGift", "Shoot Completed Gift", { parse: parseApplicable }),
  ...PEOPLE.filter((person) => person.late).map(({ field, label }) => column(field, label)),
  // The sales notes each stage reads on the project, one per stage.
  column("salesPreProductionRemarks", "Sales Pre Production Remarks"),
  column("salesProductionRemarks", "Sales Production Remarks"),
  column("salesPostProductionRemarks", "Sales Post Production Remarks"),
  column("projectValidityMonths", "Project Validity (In Months)"),
  column("storageNeeded", "Storage Needed", { parse: parseYesNoText }),
  yesNo("storageReceived", "Received The Storage"),
  date("projectCreatedAt", "Date Created"),
];

const importColumns = (vertical) => [...PROJECT_COLUMNS, ...SHOOT_COLUMNS(vertical), ...SHARED_PRE_PRODUCTION, ...CHECKLIST[vertical], ...PROJECT_ANSWERS].map(tolerant);

// ---- The row ----

const sheetId = z.string().trim().min(1).max(30);
const text = (max) => z.string().trim().max(max).optional();
// What a cell of each kind must read as, said in the words the sheet uses rather than zod's.
const CELL_SCHEMAS = {
  date: z.date({ message: "Enter the date as DD-MM-YYYY, e.g. 25-12-2026, or 6 Sept 2026." }).optional(),
  yesNo: z.boolean({ message: "Enter Yes or No." }).optional(),
  progress: z.enum(["Pending", "Completed"], { message: "Enter Pending or Completed." }).optional(),
};
const typedCells = Object.fromEntries(VERTICALS.flatMap(importColumns).filter((c) => c.kind).map((c) => [c.field, CELL_SCHEMAS[c.kind]]));
/*
 * A link the board will one day render as one. The form's own input is `type="url"`; a file has no
 * such check, so a `javascript:` or `data:` value is refused here rather than stored.
 */
const httpLink = z.string().trim().max(2048).refine((value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}, { message: "Enter a full web link starting with https://." }).optional();
const LINK_FIELDS = ["locationLink", "accommodationLink", "meetingLink", "invitationLink"];
const startableStatuses = projects.projectStatuses.filter((status) => status !== "Yet to Start");

/*
 * What a row must carry before anything is looked up. The shoot's own fields and the pre production
 * answers are checked again, after this, by the schemas the shoot form and the board use - so this
 * only covers what is the import's own: the sheet's IDs, the project, the people.
 */
const rowSchema = z.object({
  sheetEventId: sheetId,
  sheetShootId: sheetId,
  // Named here as well as in `importedShoot`, so "Import rows with errors" can never empty it: a shoot
  // has to be called something, and a row without it is refused whatever is ticked.
  shoot: z.string().trim().min(1).max(100),
  whatsappGroupName: z.string().trim().min(1).max(500),
  clientMainNumber: z.string().trim().max(30).optional(),
  sourceBranch: z.string().trim().min(1).max(120),
  ...typedCells,
  ...Object.fromEntries(LINK_FIELDS.map((field) => [field, httpLink])),
  initialConvertedValue: z.coerce.number({ message: "Enter a number." }).finite().min(0).optional(),
  projectStatus: z.enum(startableStatuses, { message: `Use one of: ${startableStatuses.join(", ")}.` }).optional(),
  welcomeGift: z.enum(["Applicable", "Not Applicable"], { message: "Enter Applicable or Not Applicable." }).optional(),
  shootCompletedGift: z.enum(["Applicable", "Not Applicable"], { message: "Enter Applicable or Not Applicable." }).optional(),
  storageNeeded: z.enum(["Yes", "No"], { message: "Enter Yes or No." }).optional(),
  projectValidityMonths: z.coerce.number({ message: "Enter the months as a number." }).int("Enter the months as a whole number.").min(1).max(600).optional(),
  // Checked here as well as in `importedShoot`, so "Import rows with errors" can empty the cell.
  sessionDurationHours: z.coerce.number({ message: "Enter the hours as a number." }).int("Enter the hours as a whole number.").min(0).max(24).optional(),
  salesPreProductionRemarks: text(5000),
  salesProductionRemarks: text(5000),
  salesPostProductionRemarks: text(5000),
  /*
   * Every people cell may be empty, CRM and Pre Production Coordinator included: the old sheet leaves
   * them, and a row is worth having without them. Their **headings** stay required (`PEOPLE`'s own
   * `required`), so a file that drops the column is still refused rather than quietly importing a
   * file's worth of projects with nobody on them. A project with no Pre Production Coordinator raises
   * no pre production row, so that row's answers have nowhere to go and are not stored - naming one
   * later and uploading again stores them.
   */
  ...Object.fromEntries(PEOPLE.map(({ field }) => [field, text(50)])),
}).passthrough();

const SHOOT_FIELDS = ["shoot", "dateCreated", "isMainEvent", "shootPlace", "district", "state", "shootTypes", "sessionTimings", "sessionDurationHours", "preference"];
const NOT_PRE_PRODUCTION = new Set([...PROJECT_COLUMNS.map((c) => c.field), ...PROJECT_ANSWERS.map((c) => c.field), ...SHOOT_FIELDS, "sheetShootId", "conceptReference", "conceptRemarks"]);

module.exports = { importColumns, rowSchema, tolerant, PEOPLE, SHOOT_FIELDS, NOT_PRE_PRODUCTION, parseDate, parseTime, parseYesNo, parseLink, parseProjectStatus, isPlaceholder, VERTICALS };
