const { z } = require("zod");
const { importTableRows, templateHeaders } = require("../../../services/tableImport");
const service = require("./service");
const { cancelInterviewMeeting, syncInterviewMeeting } = require("./meetings");
const { INTERVIEW_SCHEDULED_STATUS, MANUAL_SOURCE, CSV_IMPORT_SOURCE } = require("./candidates");

/*
 * How the candidate reached the register, where nobody said where they came from.
 *
 * Stamped at the way in rather than in the service, because the service cannot tell them apart: a
 * CSV row and a typed one are the same `createCandidate` call, and the only thing that knows which
 * is the route it arrived by. A **fallback** - a Source somebody named is kept as they named it.
 */
/**
 * The column filters off a query string, as JSON.
 *
 * One parameter rather than one per column, the way the CRM board sends its own: the set of columns
 * is the table's and changes with it, and a query string naming each would have to be taught every
 * new column. A value is a string (typed, matched as text) or a list (ticked, matched exactly).
 */
const filtersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({});
function readFilters(req, res) {
  if (!req.query.filters) return {};
  let parsed;
  try {
    parsed = JSON.parse(req.query.filters);
  } catch {
    res.status(400).json({ message: "Invalid filters parameter." });
    return null;
  }
  const checked = filtersSchema.safeParse(parsed);
  if (!checked.success) {
    res.status(400).json({ message: "Invalid filters parameter.", errors: checked.error.flatten() });
    return null;
  }
  return checked.data;
}

const withSource = (values, origin) => ({ ...values, source: String(values?.source || "").trim() || origin });

/**
 * Validation and status codes, and nothing else - the register itself is `service.js`.
 *
 * Three ways in, one schema: Add Application and Bulk Entry post the same record shape, one at a
 * time or as a batch, and the CSV import hands each row to the same schema through the shared
 * importer - so a candidate cannot arrive through one door in a shape another would refuse.
 */

const optional = (max) => z.string().trim().max(max).optional().nullable().transform((value) => value || null);

/** A repeating list as the form holds it: rows of short strings, keys the field uses dropped by the service. */
const detailRows = z.array(z.record(z.string(), z.any())).max(50).optional().nullable();

const candidateSchema = z.object({
  name: z.string().trim().min(1, "Candidate name is required.").max(191),
  phone: optional(40),
  whatsappNumber: optional(40),
  email: z.string().trim().max(191).optional().nullable()
    .refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), { message: "Enter a valid email address." })
    .transform((value) => value || null),
  position: optional(150),
  department: optional(120),
  employmentType: optional(40),
  gender: optional(30),
  dateOfBirth: optional(40),
  address: optional(5000),
  experience: optional(60),
  currentCompany: optional(191),
  currentDesignation: optional(150),
  currentCtc: optional(60),
  minExpectedCtc: optional(60),
  expectedCtc: optional(60),
  noticePeriod: optional(60),
  availableFrom: optional(40),
  highestQualification: optional(191),
  skills: optional(5000),
  languagesKnown: optional(5000),
  howYouKnowUs: optional(1000),
  aboutUs: optional(5000),
  /*
   * The candidate's links, so the record can correct them rather than only show the first.
   * `prepareValues` derives `portfolioUrl` from the first of these whenever a list is sent, so the
   * register's own column, the linked sheets and the CSV importer stay in step with what HR edits.
   */
  portfolioLinks: z.array(z.string().trim().max(1000)).max(3).optional().nullable(),
  portfolioUrl: optional(1000),
  city: optional(120),
  state: optional(120),
  nativePlace: optional(191),
  currentLocation: optional(191),
  branch: optional(120),
  source: optional(120),
  referredBy: optional(191),
  // Which paid ad this came from. Only a linked sheet or a CSV sends these, but they are validated
  // like every other column rather than trusted, because a sheet's heading is somebody else's text.
  campaignName: optional(191),
  adsetName: optional(191),
  adName: optional(191),
  resumeUrl: optional(1000),
  status: optional(40),
  // The interviewer is chosen by employee id from the picker; the name is resolved on the server.
  // A sheet-imported candidate may carry a name the picker does not know, which is what `interviewer`
  // as text is for - the form sends the id when it has one and the name is kept otherwise.
  interviewerEmployeeId: z.union([z.coerce.number().int().positive(), z.literal(""), z.null()]).optional().transform((value) => (value === "" ? null : value ?? null)),
  interviewer: optional(150),
  interviewDate: optional(40),
  interviewTime: optional(40),
  interviewMode: optional(40),
  meetLink: optional(1000),
  appliedDate: optional(40),
  lastFollowUpDate: optional(40),
  nextFollowUpDate: optional(40),
  remarks: optional(5000),
  // Why each decision was taken, one entry per decision - apart from `remarks`, which is the
  // running note on the person rather than the reason behind a stage.
  statusNotes: detailRows,
  // Every round the candidate has been called for; the flat interview columns follow the latest.
  interviewRounds: detailRows,
  educationEntries: detailRows,
  experienceEntries: detailRows,
});

/** Bulk Entry's batch: the same records, several at once. Capped where the dialog caps itself. */
const bulkSchema = z.object({ records: z.array(candidateSchema).min(1).max(200) });

/**
 * The columns a CSV may carry, and the template the studio downloads. `required` refuses a file
 * that lacks the column, not a row that leaves it blank - that is the schema's business. Mirrored
 * by `INTERVIEW_IMPORT_COLUMNS` in `frontend/src/constants/importColumns.js`, so a file is judged
 * before it is uploaded.
 */
const INTERVIEW_IMPORT_COLUMNS = [
  { field: "name", label: "Candidate Name", required: true },
  { field: "phone", label: "Phone" },
  { field: "email", label: "Email" },
  { field: "whatsappNumber", label: "WhatsApp Number" },
  { field: "position", label: "Position Applied For" },
  { field: "department", label: "Department" },
  { field: "employmentType", label: "Employment Type" },
  { field: "experience", label: "Experience" },
  { field: "currentCompany", label: "Current Company" },
  { field: "currentDesignation", label: "Current Designation" },
  { field: "currentCtc", label: "Current CTC" },
  { field: "minExpectedCtc", label: "Least Expected CTC" },
  { field: "expectedCtc", label: "Expected CTC" },
  { field: "noticePeriod", label: "Notice Period" },
  { field: "availableFrom", label: "Available From" },
  { field: "highestQualification", label: "Highest Qualification" },
  { field: "skills", label: "Skills" },
  { field: "languagesKnown", label: "Languages Known" },
  { field: "gender", label: "Gender" },
  { field: "dateOfBirth", label: "Date of Birth" },
  { field: "city", label: "City" },
  { field: "nativePlace", label: "Native Place" },
  { field: "currentLocation", label: "Current Location" },
  { field: "state", label: "State" },
  { field: "address", label: "Address" },
  { field: "branch", label: "Branch" },
  { field: "source", label: "Source" },
  { field: "campaignName", label: "Campaign Name" },
  { field: "adsetName", label: "Adset Name" },
  { field: "adName", label: "Ad Name" },
  { field: "referredBy", label: "Referred By" },
  { field: "howYouKnowUs", label: "How They Know Us" },
  { field: "aboutUs", label: "What They Know About Us" },
  { field: "status", label: "Status" },
  { field: "interviewer", label: "Interviewer" },
  { field: "interviewDate", label: "Interview Scheduled On" },
  { field: "interviewTime", label: "Interview Time" },
  { field: "interviewMode", label: "Interview Mode" },
  { field: "meetLink", label: "Meet Link" },
  { field: "appliedDate", label: "Applied On" },
  { field: "nextFollowUpDate", label: "Next Follow-up Date" },
  { field: "portfolioUrl", label: "Portfolio Link" },
  { field: "resumeUrl", label: "Resume Link" },
  { field: "remarks", label: "Remarks" },
];

function fail(res, error, fallback) {
  // `code` and `data` travel where the error carries them: a duplicate refusal names the candidate
  // it is about, and a screen given only the sentence could not offer to open their record.
  if (error?.status) {
    return res.status(error.status).json({
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.data ? { data: error.data } : {}),
    });
  }
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

const firstIssue = (parsed) => parsed.error.issues?.[0]?.message || "Validation failed.";

async function options(req, res) {
  try {
    return res.json({ data: await service.interviewOptions() });
  } catch (error) {
    return fail(res, error, "Unable to load the interview options.");
  }
}

/**
 * A page of the register, in the shape the CRM lead board answers with: the rows under `data`, and
 * `total` plus `counts` beside them on a real read.
 *
 * `appending=true` is a scroll fetching the next page, and it leaves both out rather than computing
 * them and throwing them away - the set cannot change while somebody scrolls it, so the board keeps
 * the numbers it already has.
 */
/**
 * The ids of every candidate a stage matches, for a "select all" the browser cannot resolve itself.
 *
 * The register is paged, so ticking the header box selects rows the screen has never rendered. This
 * is the one question it has to ask the server: which ids does the tab in front of me match?
 *
 * Read-only, and behind the same `requireModule("HRM", "Interview")` guard the whole router mounts
 * - it answers with ids the same caller could already page through, and nothing else.
 */
async function ids(req, res) {
  try {
    const filters = readFilters(req, res);
    if (!filters) return undefined;
    // The same rows the table is showing: a "select all" over a filtered board means the filtered
    // set, not the whole stage.
    const result = await service.listCandidateIds({ status: String(req.query.status || "").trim(), filters });
    return res.json({ data: result.ids, truncated: result.truncated, max: result.max });
  } catch (error) {
    return fail(res, error, "Unable to read the candidates for that selection.");
  }
}

/**
 * The values one column holds, for the filter menu above it.
 *
 * Asked when a menu opens rather than with the page: there is one of these per column, and fetching
 * every column's values up front would be a dozen queries to fill menus nobody opened.
 *
 * Read-only, behind the router's own `requireModule("HRM", "Interview")` - it answers with values
 * off rows the same caller can already page through, and the column is checked against an allowlist
 * rather than trusted.
 */
async function columnValues(req, res) {
  try {
    const filters = readFilters(req, res);
    if (!filters) return undefined;
    const data = await service.candidateColumnValues({
      column: String(req.query.column || "").trim(),
      status: String(req.query.status || "").trim(),
      // Every other column's filter, so the menu offers what is reachable rather than what exists.
      filters,
    });
    return res.json({ data });
  } catch (error) {
    return fail(res, error, "Unable to read the values for that column.");
  }
}

async function list(req, res) {
  try {
    const appending = String(req.query.appending || "") === "true";
    const filters = readFilters(req, res);
    if (!filters) return undefined;
    const { rows, total, counts } = await service.listCandidates({
      status: String(req.query.status || "").trim(),
      offset: req.query.offset,
      limit: req.query.limit,
      withCounts: !appending,
      /*
       * Filtered here rather than in the browser. The register arrives a page at a time, so
       * filtering the rows in hand filtered the hundred scrolled into view - and picking a value
       * the column holds but that page does not answered "no records found" over a register that
       * had plenty of them.
       */
      filters,
    });
    return res.json({ data: rows, ...(appending ? {} : { total, counts }) });
  } catch (error) {
    return fail(res, error, "Unable to load candidates.");
  }
}

async function get(req, res) {
  try {
    return res.json({ data: await service.getCandidate(req.params.id) });
  } catch (error) {
    return fail(res, error, "Unable to load that candidate.");
  }
}

/*
 * Who the register already holds on this number or this address.
 *
 * Asked by the form as a number is typed, so the warning appears under the field rather than
 * arriving as a refusal after somebody has filled in the whole record. The CRM's Add Lead asks its
 * own board the same question in the same place, for the same reason.
 *
 * A read, so the register's own `READ` covers it - the router guards this route with everything
 * else, and this returns nothing that reading the register does not already show.
 *
 * `excludeId` is the candidate doing the asking, so editing a record does not find itself.
 */
async function duplicates(req, res) {
  try {
    const matches = await service.matchingCandidates(
      { phone: req.query.phone, email: req.query.email },
      undefined,
      String(req.query.excludeId || "").trim(),
    );
    return res.json({
      data: {
        count: matches.length,
        candidates: matches.map(({ candidate, matchedBy }) => ({
          id: candidate.id,
          candidateCode: candidate.candidateCode,
          name: candidate.name || "",
          phone: candidate.phone || "",
          email: candidate.email || "",
          status: candidate.status || "",
          position: candidate.position || "",
          appliedDate: candidate.appliedDate || "",
          matchedBy,
        })),
      },
    });
  } catch (error) {
    return fail(res, error, "Unable to check this candidate.");
  }
}

async function create(req, res) {
  const parsed = candidateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed), errors: parsed.error.flatten() });
  try {
    return res.status(201).json({ data: await service.createCandidate(withSource(parsed.data, MANUAL_SOURCE), req.user) });
  } catch (error) {
    return fail(res, error, "Unable to add that candidate.");
  }
}

/**
 * The same "one person, one row" rule over a whole batch, answered before anything is written.
 *
 * Two questions rather than one, which is the shape the CRM board's bulk entry settled on. A row can
 * clash with a candidate the register already holds, and two rows of the **same** batch can clash
 * with each other - a paste that repeats a number passes every individual lookup, since neither row
 * has been written yet. The second is the one a per-row check can never catch.
 *
 * Checked before any of it is written, and before a single candidate code is minted. Refusing
 * halfway leaves the studio with part of their batch on the register and part not, and burns codes
 * on candidates that were never created - gaps that read as deletions to anyone auditing the
 * register later.
 *
 * Every row is reported rather than the first, because a bulk entry grid is corrected in one pass:
 * naming one row at a time means submitting the same batch five times to find five problems.
 */
async function batchCandidateClashes(records = []) {
  const clashes = [];
  const seenInBatch = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] || {};
    const phone = String(record.phone || "").trim();
    const email = String(record.email || "").trim();
    // Nothing to match on is not a clash - the same answer `findDuplicateCandidate` gives.
    if (!phone && !email) continue;

    /*
     * Both keys, so a batch is checked the way the register is: two rows carrying one number are a
     * repeat, and so are two rows carrying one address. Kept apart because the key that clashed is
     * the thing the reader has to go and look at.
     */
    const keys = [
      ...(phone ? [{ key: `phone::${phone.replace(/\D/g, "").slice(-10)}`, what: phone }] : []),
      ...(email ? [{ key: `email::${email.toLowerCase()}`, what: email }] : []),
    ];
    const repeated = keys.find(({ key }) => seenInBatch.has(key));
    if (repeated) {
      // The value itself travels with every clash. "Candidate 7 is a duplicate" sends somebody
      // counting down a grid; "9876543210, on candidates 3 and 7" is what they can act on.
      clashes.push({
        row: index + 1,
        value: repeated.what,
        duplicateOfRow: seenInBatch.get(repeated.key),
        reason: `${repeated.what} is already on candidate ${seenInBatch.get(repeated.key)} of this batch.`,
      });
      continue;
    }
    for (const { key } of keys) seenInBatch.set(key, index + 1);

    const clash = await service.findDuplicateCandidate({ phone, email });
    if (clash) {
      clashes.push({
        row: index + 1,
        value: clash.matchedBy === "email" ? email : phone,
        candidateCode: clash.candidate.candidateCode,
        reason: service.duplicateMessage(clash),
      });
    }
  }
  return clashes;
}

/**
 * Bulk Entry's batch. Refused whole where a row is somebody the register already holds, or the same
 * person twice within the batch; past that, a row that fails for any other reason is named by its
 * position and the rest are written, the way the CSV import answers.
 */
async function createBulk(req, res) {
  const parsed = bulkSchema.safeParse(req.body || {});
  if (!parsed.success) {
    const issue = parsed.error.issues?.[0];
    const row = Array.isArray(issue?.path) && issue.path[0] === "records" && Number.isInteger(issue.path[1]) ? issue.path[1] + 1 : null;
    return res.status(400).json({ message: row ? `Candidate ${row}: ${issue.message}` : firstIssue(parsed), errors: parsed.error.flatten() });
  }
  try {
    const clashes = await batchCandidateClashes(parsed.data.records);
    if (clashes.length) {
      // The values named in the message itself - the dialog prints this straight through, and a
      // count alone is not something anybody can act on.
      const values = [...new Set(clashes.map((entry) => entry.value).filter(Boolean))];
      return res.status(409).json({
        message: `${values.join(", ")} ${values.length === 1 ? "is" : "are"} already on the register. One person is one candidate.`,
        code: "DUPLICATE_CANDIDATE",
        errors: clashes,
      });
    }

    // Bulk Entry is somebody typing several candidates in one sitting, so it stamps what Add
    // Application stamps - the dialog is the same act repeated, not a different way in.
    const { created, errors } = await service.createCandidatesBulk(parsed.data.records.map((record) => withSource(record, MANUAL_SOURCE)), req.user);
    return res.status(201).json({ data: created, errors });
  } catch (error) {
    return fail(res, error, "Unable to add those candidates.");
  }
}

/*
 * The stage on its own.
 *
 * A verb of its own rather than a field on `PUT /candidates/:id`, for the reason Tasks gives its
 * four transitions their own routes: a stage is moved from a row menu, where the caller holds a
 * table row and not a form, and the full update is deliberately **not** partial - it validates the
 * whole record and writes every key it is handed, so a body carrying nothing but a status would be
 * refused for a missing name, and one carrying a name would blank every other column. Applied
 * partially here, so only the stage moves.
 */
/*
 * Moving a stage, and saying why.
 *
 * `note` is optional because the row menu moves a stage two ways: the decisions that deserve a
 * reason - Selected, On Hold, Rejected - ask for one in a dialog, and Undo moves the stage straight
 * back without adding a second note about undoing the first.
 */
const statusSchema = z.object({
  status: z.string().trim().min(1, "A status is required.").max(40),
  note: z.string().trim().max(2000).optional().nullable(),
  /*
   * **When to look at this person again**, carried with the move rather than set afterwards.
   *
   * Asked by **Follow Up**, which is the one stage that is about a date: chasing somebody is the
   * decision that "this is worth another try, on this day", and a stage that recorded the trying
   * without the day would leave the register unable to say who is due. The other decisions do not
   * ask for one - a rejection has no next day, and a selection's next step is an invite, not a call.
   *
   * Optional, and `undefined` rather than defaulted, so a move that says nothing about the date
   * leaves whatever the record holds. A caller that means "there is no next follow-up" sends null.
   */
  nextFollowUpDate: z.string().trim().max(40).optional().nullable(),
});

/**
 * One candidate moved to a stage, with the reason kept.
 *
 * A function of its own because two routes do it - the row menu's single move and the bulk one over
 * a selection - and the rule about the note is the part that must not differ between them: it is
 * **appended** rather than written over, since a candidate can be held in March and rejected in May
 * and each decision keeps its own reason. Read here rather than in the service so the write stays a
 * plain list of values, and a missing candidate is left to `updateCandidate` to refuse, which is the
 * one place that answer belongs.
 */
async function applyStatus(id, status, note, actor, { nextFollowUpDate } = {}) {
  const values = { status };
  // Only when the caller said something about it. `prepareValues` is partial here, so a key that is
  // not sent is a column that is not written - which is what leaves a date already on the record
  // alone rather than blanking it on every stage change that does not ask.
  if (nextFollowUpDate !== undefined) values.nextFollowUpDate = nextFollowUpDate || null;
  if (note) {
    const current = await service.getCandidate(id).catch(() => null);
    const held = Array.isArray(current?.statusNotes) ? current.statusNotes : [];
    /*
     * The day promised is kept **on the entry**, not only on the record.
     *
     * The record holds one `next_follow_up_date` - the next one - so a candidate chased three times
     * shows the latest day and nothing about the two before it. Reading the log afterwards, "called
     * on the 8th, said to try the 15th" is the useful line; "called on the 8th" alone loses what was
     * actually agreed. Only written where the move carried a date, so the three decisions that do
     * not ask add no empty field.
     */
    values.statusNotes = [...held, {
      status,
      note,
      at: new Date().toISOString(),
      ...(nextFollowUpDate ? { nextFollowUpDate } : {}),
    }];
  }
  return service.updateCandidate(id, values, actor, { partial: true });
}

async function setStatus(req, res) {
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed), errors: parsed.error.flatten() });
  const { status, note, nextFollowUpDate } = parsed.data;
  try {
    return res.json({ data: await applyStatus(req.params.id, status, note, req.user, { nextFollowUpDate }) });
  } catch (error) {
    return fail(res, error, "Unable to move that candidate.");
  }
}

/*
 * ── Putting a round in the diary ──────────────────────────────────────────────────────────────
 *
 * Scheduling is **an act, not a set of fields**, and that is the whole of why it has a verb of its
 * own rather than going through `PUT /candidates/:id` with six keys filled in. Three things have to
 * happen together or none of them is true:
 *
 *   1. the round is appended (or the one being edited rewritten), which is what the register reads;
 *   2. the candidate moves to **Interview Scheduled** - the stage *is* "there is a conversation in
 *      the diary", so asking somebody to set it by hand afterwards is asking them to restate what
 *      they have just done, and the stage silently disagreed with the register whenever they forgot;
 *   3. a **Google Meet** is created, for a round that is one, and its link lands on the round.
 *
 * Done separately, a failure in the middle leaves a candidate whose stage says one thing and whose
 * diary says another. Done here, the Google call happens **before** the write, so a refused calendar
 * - no connection, the wrong consent - refuses the whole schedule and nothing is recorded, rather
 * than filing an interview nobody can join.
 *
 * **Editing does not move the stage.** Moving a date is not a decision about a person: a candidate
 * already Selected who has their final round moved by an hour is still Selected, and pulling them
 * back to Interview Scheduled would read afterwards as the studio having changed its mind.
 */
const GOOGLE_MEET_MODE = "Google Meet";

const scheduleSchema = z.object({
  // Which errand: the first round, the next one, or the one already booked being moved.
  mode: z.enum(["first", "next", "edit"]).default("first"),
  interviewDate: z.string().trim().min(1, "Choose the day this round is on.").max(40),
  interviewTime: z.string().trim().max(40).optional().nullable(),
  interviewMode: z.string().trim().max(40).optional().nullable(),
  /*
   * **No screen sends this.** A Meet's link is Google's answer, never the caller's, and an in-person
   * round has none to give - so the schedule dialog asks for one at no mode.
   *
   * Left in the schema, and left `undefined` rather than defaulted, because that is what tells a
   * link apart from no link: a body that omits it means "leave whatever this round already carries",
   * which is how a link a sheet or an earlier booking wrote survives an edit that was only moving a
   * date. A caller that is not the dialog can still set one.
   */
  meetLink: z.string().trim().max(1000).optional().nullable(),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
  attendees: z.array(z.string().trim().max(191)).max(50).optional(),
  /*
   * The **employee's own numeric id**, which is what the register stores and what the picker offers,
   * so it arrives as a number rather than as text. Accepted as either: `prepareValues` resolves it
   * against the roster and refuses one that names nobody, which is the check that matters.
   */
  interviewerEmployeeId: z.union([z.string().trim().max(64), z.number().int().positive()]).optional().nullable(),
  interviewer: z.string().trim().max(191).optional().nullable(),
  nextFollowUpDate: z.string().trim().max(40).optional().nullable(),
  remarks: z.string().trim().max(5000).optional().nullable(),
  timeZone: z.string().trim().max(64).optional().nullable(),
});

/**
 * The rounds a candidate holds, with one built for an interview written before the column existed.
 *
 * The same reading the dialog does, and here as well as there because the server is what decides
 * which round a save is: a candidate scheduled before rounds were kept has their one interview in
 * the flat columns, and it is round one - read as a round so a *next* round is numbered two.
 */
function roundsOf(candidate) {
  const stored = Array.isArray(candidate?.interviewRounds) ? candidate.interviewRounds : [];
  if (stored.length) return stored;
  if (candidate?.interviewDate || candidate?.interviewTime || candidate?.meetLink) {
    return [{
      round: 1,
      interviewDate: candidate.interviewDate || "",
      interviewTime: candidate.interviewTime || "",
      interviewMode: candidate.interviewMode || "",
      meetLink: candidate.meetLink || "",
    }];
  }
  return [];
}

async function schedule(req, res) {
  const parsed = scheduleSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed), errors: parsed.error.flatten() });
  const input = parsed.data;

  try {
    const candidate = await service.getCandidate(req.params.id);
    const rounds = roundsOf(candidate);
    const editing = input.mode === "edit";
    // Editing rewrites the latest round in place; the other two errands append one.
    const existing = editing ? rounds[rounds.length - 1] || null : null;
    const roundNumber = editing ? Math.max(rounds.length, 1) : rounds.length + 1;
    const isMeet = String(input.interviewMode || "").trim() === GOOGLE_MEET_MODE;

    /*
     * The Meet, created or moved - **before** anything is written.
     *
     * A round that already has an event is patched, so the entry in everybody's calendar moves and
     * the link the candidate was sent goes on working. A refusal here throws, and the register is
     * left exactly as it was: an interview recorded with no Meet behind it is the failure that costs
     * somebody the conversation.
     */
    let meet = null;
    if (isMeet) {
      meet = await syncInterviewMeeting({
        userId: req.user?.id,
        candidate,
        round: roundNumber,
        interviewDate: input.interviewDate,
        interviewTime: input.interviewTime,
        durationMinutes: input.durationMinutes,
        attendees: input.attendees,
        timeZone: input.timeZone,
        googleEventId: existing?.googleEventId || "",
      });
    } else if (editing && existing?.googleEventId) {
      /*
       * A round that **was** a Meet and is now a phone call: the calendar entry is called off, or
       * everybody goes on holding an invite to a conference nobody will join. Never fails the save -
       * see `cancelInterviewMeeting` - because the register is what the studio reads.
       */
      await cancelInterviewMeeting({ userId: req.user?.id, googleEventId: existing.googleEventId });
    }

    const round = {
      round: roundNumber,
      interviewDate: input.interviewDate || "",
      interviewTime: input.interviewTime || "",
      interviewMode: input.interviewMode || "",
      /*
       * Google's answer for a Meet, and otherwise whatever this round already carried.
       *
       * Both halves fall back to the existing round rather than to "": a patch that came back
       * without a conference must not blank a link people are already using, and an edit that was
       * only moving an in-person round's date must not throw away a link a sheet or an earlier
       * booking wrote. `input.meetLink` is honoured where a caller actually sends one, which no
       * screen does - see the schema above.
       */
      meetLink: isMeet
        ? (meet?.meetLink || existing?.meetLink || "")
        : (input.meetLink ?? existing?.meetLink ?? ""),
      durationMinutes: input.durationMinutes || undefined,
      // Kept on the round so Edit Schedule reopens on the guests it was booked with rather than on
      // an empty list that would drop them from the event on the next save.
      attendees: Array.isArray(input.attendees) ? input.attendees : [],
      googleEventId: isMeet ? (meet?.googleEventId || "") : "",
      htmlLink: isMeet ? (meet?.htmlLink || "") : "",
    };
    const interviewRounds = editing
      ? (rounds.length ? [...rounds.slice(0, -1), round] : [round])
      : [...rounds, round];

    const values = {
      interviewRounds,
      interviewerEmployeeId: input.interviewerEmployeeId ?? candidate.interviewerEmployeeId ?? null,
      interviewer: input.interviewer ?? candidate.interviewer ?? null,
      nextFollowUpDate: input.nextFollowUpDate ?? candidate.nextFollowUpDate ?? null,
      remarks: input.remarks ?? candidate.remarks ?? null,
    };

    /*
     * The stage, moved by the act - and the reason recorded with it, so the register says *why* it
     * moved rather than appearing to have changed on its own. Appended, like every other decision.
     */
    if (!editing && candidate.status !== INTERVIEW_SCHEDULED_STATUS) {
      values.status = INTERVIEW_SCHEDULED_STATUS;
      const held = Array.isArray(candidate.statusNotes) ? candidate.statusNotes : [];
      const note = `Round ${roundNumber} scheduled for ${input.interviewDate}${input.interviewTime ? ` at ${input.interviewTime}` : ""}.`;
      values.statusNotes = [...held, { status: INTERVIEW_SCHEDULED_STATUS, note, at: new Date().toISOString() }];
    }

    const saved = await service.updateCandidate(candidate.id, values, req.user, { partial: true });
    return res.json({ data: saved, meet });
  } catch (error) {
    // The Google failures carry a code the dialog keys its message off - "connect your account",
    // "reconnect it" - so it is passed through rather than flattened into the fallback sentence.
    if (error?.code === "GOOGLE_NOT_CONNECTED" || error?.code === "GOOGLE_CALENDAR_SCOPE_REQUIRED") {
      return res.status(error.status || 400).json({ message: error.message, code: error.code });
    }
    return fail(res, error, "Unable to schedule that interview.");
  }
}

/** Who a Meet can be sent to. Its own route for the reason `service.meetGuests` gives. */
async function meetGuestOptions(req, res) {
  try {
    return res.json({ data: await service.meetGuests() });
  } catch (error) {
    return fail(res, error, "Unable to read the guest list.");
  }
}

/*
 * ── What a selection does ─────────────────────────────────────────────────────────────────────
 *
 * The two acts the tick boxes on the register lead to, both guarded by `HRM / Interview Select All`
 * in `routes.js` rather than by the screen's own Read / Write: moving every ticked candidate to one
 * stage, and deleting them together.
 *
 * Both take the ids the browser ticked. A candidate already gone - deleted in another tab, or
 * removed between the read and the press - is **counted, not fatal**: a selection of thirty where
 * one has vanished is twenty-nine moved and one named, not a refusal that leaves the reader to find
 * out which. Only a selection where nothing at all could be acted on answers 404.
 *
 * `max(2000)` on the ids, which is far beyond any stage the register holds and still a bound - a
 * body that names every candidate the studio has ever seen is not a selection somebody made.
 */
const bulkIds = z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one candidate.").max(2000);

const bulkStatusSchema = z.object({
  ids: bulkIds,
  status: z.string().trim().min(1, "A status is required.").max(40),
  note: z.string().trim().max(2000).optional().nullable(),
});

/**
 * Every ticked candidate moved to one stage, with one reason recorded against each.
 *
 * Applied one at a time rather than as a single `updateMany`, because each candidate's note is
 * appended to the decisions that candidate already carries - there is no one value to write across
 * the set - and because a move through `applyStatus` is exactly the move the row menu makes, so the
 * two cannot drift. Sequentially rather than in parallel: each is a read and then a write, and a
 * selection of hundreds fired at once would take the connection pool for a stage of the register.
 */
async function bulkStatus(req, res) {
  const parsed = bulkStatusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed), errors: parsed.error.flatten() });
  const { status, note } = parsed.data;
  // Deduplicated, so a selection that somehow names a candidate twice moves them once and is
  // counted once - the number in the notice is candidates, not presses.
  const ids = [...new Set(parsed.data.ids)];
  const movedIds = [];
  const missedIds = [];
  for (const id of ids) {
    try {
      await applyStatus(id, status, note, req.user);
      movedIds.push(id);
    } catch (error) {
      // A candidate that could not be moved is named rather than throwing the whole selection away.
      // `missedIds` is what the notice counts; the reason is the same for all of them in practice -
      // the row is gone - and reporting each would be a wall of text over a working screen.
      void error;
      missedIds.push(id);
    }
  }
  if (!movedIds.length) return res.status(404).json({ message: "None of the selected candidates could be moved.", data: { movedIds, missedIds } });
  const moved = `${movedIds.length} candidate${movedIds.length === 1 ? "" : "s"}`;
  return res.json({
    message: missedIds.length
      ? `${moved} moved to ${status}. ${missedIds.length} could not be moved and ${missedIds.length === 1 ? "was" : "were"} left alone.`
      : `${moved} moved to ${status}.`,
    data: { movedIds, missedIds, status },
  });
}

/**
 * Every ticked candidate deleted together. A soft delete each, exactly as the row menu's is, and one
 * a linked sheet will not undo - the row each came from is remembered as imported and stays out.
 */
async function removeBulk(req, res) {
  const parsed = z.object({ ids: bulkIds }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed), errors: parsed.error.flatten() });
  const ids = [...new Set(parsed.data.ids)];
  const deletedIds = [];
  const missedIds = [];
  for (const id of ids) {
    try {
      await service.deleteCandidate(id);
      deletedIds.push(id);
    } catch (error) {
      void error;
      missedIds.push(id);
    }
  }
  if (!deletedIds.length) return res.status(404).json({ message: "None of the selected candidates were found.", data: { deletedIds, missedIds } });
  const deleted = `${deletedIds.length} candidate${deletedIds.length === 1 ? "" : "s"}`;
  return res.json({
    message: missedIds.length
      ? `${deleted} deleted. ${missedIds.length} could not be found and ${missedIds.length === 1 ? "was" : "were"} left alone.`
      : `${deleted} deleted.`,
    data: { deletedIds, missedIds },
  });
}

async function update(req, res) {
  const parsed = candidateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed), errors: parsed.error.flatten() });
  try {
    return res.json({ data: await service.updateCandidate(req.params.id, parsed.data, req.user) });
  } catch (error) {
    return fail(res, error, "Unable to update that candidate.");
  }
}

async function remove(req, res) {
  try {
    return res.json({ data: await service.deleteCandidate(req.params.id) });
  } catch (error) {
    return fail(res, error, "Unable to delete that candidate.");
  }
}

async function importTemplate(req, res) {
  return res.json({ data: { columns: templateHeaders(INTERVIEW_IMPORT_COLUMNS) } });
}

/** The CSV import, through the shared importer: each row is the same record Add Application posts. */
async function importRows(req, res) {
  try {
    const data = await importTableRows({
      headers: req.body?.headers,
      rows: req.body?.rows,
      startRow: Number(req.body?.startRow) || 2,
      columns: INTERVIEW_IMPORT_COLUMNS,
      schema: candidateSchema,
      // The module's own creator, so an imported candidate is written exactly as a typed one is -
      // same code counter, same folding, same creator stamp.
      create: async (input) => { await service.createCandidate(withSource(input, CSV_IMPORT_SOURCE), req.user); },
    });
    return res.json({ data });
  } catch (error) {
    return fail(res, error, "Unable to import candidates.");
  }
}

module.exports = { options, list, ids, columnValues, duplicates, get, create, createBulk, batchCandidateClashes, update, setStatus, bulkStatus, schedule, meetGuestOptions, remove, removeBulk, importTemplate, importRows, candidateSchema, statusSchema, bulkStatusSchema, scheduleSchema, INTERVIEW_IMPORT_COLUMNS };
