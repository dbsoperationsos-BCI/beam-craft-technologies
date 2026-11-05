const { z } = require("zod");
const { asList } = require("../../../services/tableImport");
const { parseYesNo, isPlaceholder, tolerant, VERTICALS } = require("../pre-production/importColumns");
const S = require("./steps");
const T = require("./travel");

/*
 * Production → Import: the production side of the studio's old sheet, one row per shoot.
 *
 * A row names its shoot by the sheet's own Shoot ID - the one Pre Production → Import stored on the
 * shoot (`project_shoot.sheet_shoot_id`) - so the two files link without anybody matching them by
 * hand. Pre production is therefore imported first; it is also what raises the production record,
 * once the project has a Production Manager.
 *
 * One template per vertical, the same as Pre Production, though production asks every vertical the
 * same questions: the vertical is the route's, and a shoot of another vertical is refused, which is
 * what catches the Dum Dum file uploaded under Qua Qua. The browser's copy is
 * `frontend/src/constants/importColumns.js`; a test fails if the two differ.
 *
 * What a row writes is `import.service.js`; the routes are `import.js`.
 *
 * Read the way Pre Production → Import reads a sheet: the old sheet's placeholders (WCR, N/A, IN OLD
 * SHEET, #REF!, TBD...) come in as empty rather than as text, and a people cell takes an Employee Code
 * or a name (`services/importPeople.js`) - somebody who has left is kept by name.
 */

const column = (field, label, extra = {}) => ({ field, label, ...extra });

/** A cell naming one of a fixed list, read whatever its case and spacing. Unknown text is handed on for the schema to refuse. */
const choiceOf = (labels) => (value) => {
  const key = String(value).trim().toLowerCase().replace(/[^a-z]/g, "");
  return Object.entries(labels).find(([, label]) => label.toLowerCase().replace(/[^a-z]/g, "") === key)?.[0] ?? value;
};

const STEP_CHOICES = { ...S.STEP_LABELS, [S.DONE]: "Done" };
// What the steps were called before they were renamed, so a sheet written then still reads: "Photo
// copy" for File in, and the travel steps' old words.
const OLD_STEP_NAMES = { PHOTO_COPY: "Photo copy", STARTED_FROM_STUDIO: "Started from studio", REACHED_SHOOT_PLACE: "Reached shoot place" };
const parseStep = (value) => {
  const read = choiceOf(STEP_CHOICES)(value);
  return read === value ? choiceOf(OLD_STEP_NAMES)(value) : read;
};
// "On Hold" as well as the board's own "Hold".
const parseStatus = (value) => {
  const read = choiceOf(S.SHOOT_STATUS_LABELS)(value);
  return read === value ? choiceOf({ HOLD: "On Hold" })(value) : read;
};
const TRAVEL = Object.fromEntries(T.TRAVEL_MODES.map((mode) => [mode, mode]));

// A team cell: the names or codes in it, without the placeholders ("WCR, Ajeesh") or the blanks.
const teamList = (value) => {
  const list = asList(value).filter((item) => !isPlaceholder(item));
  return list.length ? list : undefined;
};

const importColumns = () => [
  column("sheetShootId", "Shoot ID", { required: true }),
  column("sheetEventId", "Event ID"),
  column("productionCoordinatorCode", "Production Coordinator Employee Code"),
  column("teamCodes", "Production Team Employee Codes", { parse: teamList }),
  column("travelMode", "Travel Mode", { parse: choiceOf(TRAVEL) }),
  column("travelModeOther", "Travel Mode Other"),
  column("vehicleNumberPlate", "Vehicle Number Plate"),
  column("remarks", "Plan Remarks"),
  column("planSubmitted", "Plan Submitted", { parse: parseYesNo }),
  column("currentStep", "Production Step", { parse: parseStep }),
  column("shootStatus", "Shoot Status", { parse: parseStatus }),
  column("shootStatusRemarks", "Shoot Status Remarks"),
  // Renamed from "Footage URL" when the box stopped being a link; last month's sheet still reads.
  column("footageUrl", "Footage Location", { aliases: ["Footage URL"] }),
  column("footageBackupCode", "Footage Backup By Employee Code"),
  column("fileCount", "File Count"),
  column("size", "Size"),
  column("firstFileName", "First File Name"),
  column("lastFileName", "Last File Name"),
  column("footageRemarks", "Footage Remarks"),
  // WCR, N/A, IN OLD SHEET, #REF! and the rest of the old sheet's "nothing here" words come in empty.
].map(tolerant);

const text = (max) => z.string().trim().max(max).optional();
const FOOTAGE_FIELDS = ["footageUrl", "footageBackupCode", "fileCount", "size", "firstFileName", "lastFileName"];

/*
 * The row, with the rules the board's own forms hold: a footage link is http(s) (a link pasted
 * without its scheme is taken as https, as the photo copy form takes it), and a photo copy is all of
 * its details or none - the board refuses a half-filled one, and so does this.
 */
const rowSchema = z.object({
  sheetShootId: z.string().trim().min(1).max(30),
  sheetEventId: text(30),
  productionCoordinatorCode: text(50),
  teamCodes: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  travelMode: z.enum(T.TRAVEL_MODES, { message: `Use one of: ${T.TRAVEL_MODES.join(", ")}.` }).optional(),
  travelModeOther: text(191),
  vehicleNumberPlate: text(20),
  remarks: text(5000),
  planSubmitted: z.boolean({ message: "Enter Yes or No." }).optional(),
  // The retired steps are accepted too: an old sheet names the step a shoot was standing on, and a
  // record carrying one reads as the next step it still has (`effectiveStep`).
  currentStep: z.enum([...S.ALL_STEPS, S.DONE], { message: `Use one of: ${Object.values(STEP_CHOICES).join(", ")}.` }).optional(),
  shootStatus: z.enum(S.SHOOT_STATUSES, { message: `Use one of: ${Object.values(S.SHOOT_STATUS_LABELS).join(", ")}.` }).optional(),
  shootStatusRemarks: text(5000),
  // Where the footage is, as the sheet writes it: a link, a disk, a shelf - plain text either way.
  footageUrl: text(2048),
  footageBackupCode: text(50),
  fileCount: z.coerce.number({ message: "Enter the number of files." }).int("Enter the number of files as a whole number.").min(1).max(10_000_000).optional(),
  size: text(50),
  firstFileName: text(255),
  lastFileName: text(255),
  footageRemarks: text(5000),
}).superRefine((row, context) => {
  const given = FOOTAGE_FIELDS.filter((field) => row[field] !== undefined);
  if (given.length && given.length < FOOTAGE_FIELDS.length) {
    const missing = FOOTAGE_FIELDS.find((field) => row[field] === undefined);
    context.addIssue({ code: "custom", path: [missing], message: "Fill this in too - a photo copy needs all of its details." });
  }
});

module.exports = { importColumns, rowSchema, VERTICALS };
