const prisma = require("../../../config/db");
const { nextIdentifier } = require("../../../services/identifiers");

/**
 * The calls made to and from a lead, as Callyzer reports them.
 *
 * Kept in a table of their own rather than on the lead, because a lead has many calls and the
 * lead row has room for one. The webhook used to write the whole call into `details.callLog`,
 * which meant every delivery overwrote the last: a client rung five times had one call on record
 * and no history, and the Call Logs tab had nothing to read.
 *
 * Keyed on Callyzer's own call id, so a batch redelivered - which Callyzer does after a sync
 * failure - updates the row it wrote the first time instead of adding a duplicate.
 *
 * Created at runtime like `sales_crm_lead_activity` beside it, which is how every table this
 * module added after the initial schema is made. Prisma Migrate does not know about it, so a
 * `migrate dev` would offer to drop it - the same caveat that already applies to the activity log
 * and the WhatsApp tables, tracked in docs/project-state/PROJECT-STATE.md.
 */

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_crm_call_log\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`call_id\` VARCHAR(50) NULL,
  \`enquiry_id\` VARCHAR(100) NOT NULL DEFAULT '',
  \`client_name\` VARCHAR(191) NULL,
  \`client_number\` VARCHAR(50) NULL,
  \`employee_name\` VARCHAR(191) NULL,
  \`employee_number\` VARCHAR(50) NULL,
  /*
   * Callyzer's \`emp_code\` - the field the studio fills in per handset in the Callyzer dashboard.
   *
   * Kept even though the match is made on arrival, because a handset carrying a code for somebody
   * not yet in the repository has to be matchable later, and \`raw\` holds the call rather than the
   * employee it arrived under - so this is the only copy.
   */
  \`employee_code\` VARCHAR(50) NULL,
  /*
   * The Employee this handset was matched to, at the moment the call was delivered.
   *
   * Deliberately not named \`employee_id\`: that is what the repository calls its *code*
   * (\`DBS-EMP-…\`), and this holds \`Employee\`.\`id\` - the integer key \`owner_employee_id\` on
   * the lead references. Beside \`employee_name\`, which is Callyzer's own label and nothing of
   * ours, an ambiguous name here would be read wrong by whoever came next.
   *
   * NULL is a handset belonging to nobody the repository holds, and \`employee_name\` is then the
   * only name there is for it.
   */
  \`matched_employee_id\` INT NULL,
  \`call_type\` VARCHAR(30) NULL,
  \`call_method\` VARCHAR(30) NULL,
  \`call_mode\` VARCHAR(30) NULL,
  \`call_date\` VARCHAR(30) NULL,
  \`call_time\` VARCHAR(30) NULL,
  \`duration_seconds\` INT NOT NULL DEFAULT 0,
  \`note\` TEXT NULL,
  \`recording_url\` TEXT NULL,
  \`crm_status\` VARCHAR(100) NULL,
  \`source\` VARCHAR(30) NOT NULL DEFAULT 'callyzer',
  \`raw\` LONGTEXT NULL,
  \`called_at\` DATETIME(3) NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`sales_crm_call_log_call_id_key\` (\`call_id\`),
  INDEX \`sales_crm_call_log_lead_idx\` (\`enquiry_id\`, \`called_at\`),
  INDEX \`sales_crm_call_log_number_idx\` (\`client_number\`),
  INDEX \`sales_crm_call_log_employee_idx\` (\`matched_employee_id\`),
  /*
   * What the Calls board reads: every call newest first, and the six tabs' cuts of it. The board
   * pages through this in call order and filters on the direction and the length, so both are in
   * the key rather than left to a scan of the whole table.
   */
  INDEX \`sales_crm_call_log_board_idx\` (\`called_at\`, \`call_type\`, \`duration_seconds\`),
  /* What \`callBoardVersion\` polls, so the board's four-second liveness check is an index read. */
  INDEX \`sales_crm_call_log_version_idx\` (\`updated_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/*
 * What an installation created before the Calls board existed is missing.
 *
 * The table is created at runtime rather than by Prisma Migrate, so `CREATE TABLE IF NOT EXISTS`
 * does nothing at all on a server that already has one - and a column added to the statement above
 * would never appear on any machine that had received a single Callyzer delivery. Each of these is
 * therefore applied separately and each is allowed to fail: on a fresh table they are all
 * duplicates, which is exactly the case that must not be an error.
 */
const UPGRADE_SQL = [
  "ALTER TABLE `sales_crm_call_log` ADD COLUMN `call_id` VARCHAR(50) NULL",
  // The handset's match to an employee. See the note in the CREATE above for the name.
  "ALTER TABLE `sales_crm_call_log` ADD COLUMN `matched_employee_id` INT NULL",
  // Callyzer's own code for the handset, which is the first thing the match is tried on.
  "ALTER TABLE `sales_crm_call_log` ADD COLUMN `employee_code` VARCHAR(50) NULL",
  // What the reports group by once they read through the match rather than by name.
  "ALTER TABLE `sales_crm_call_log` ADD INDEX `sales_crm_call_log_employee_idx` (`matched_employee_id`)",
  "ALTER TABLE `sales_crm_call_log` ADD UNIQUE INDEX `sales_crm_call_log_call_id_key` (`call_id`)",
  // A call that matched no lead is now stored on its own, so the link to a lead has to be optional.
  "ALTER TABLE `sales_crm_call_log` MODIFY COLUMN `enquiry_id` VARCHAR(100) NOT NULL DEFAULT ''",
  "ALTER TABLE `sales_crm_call_log` ADD INDEX `sales_crm_call_log_board_idx` (`called_at`, `call_type`, `duration_seconds`)",
  // What `callBoardVersion` polls, so the board's four-second liveness check is an index read.
  "ALTER TABLE `sales_crm_call_log` ADD INDEX `sales_crm_call_log_version_idx` (`updated_at`)",
];

let tableReady = null;
async function ensureCallLogTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
      for (const statement of UPGRADE_SQL) {
        // Swallowed on purpose: "duplicate column" and "duplicate key name" are what this says on
        // every run after the first, and they are the successful case.
        await prisma.$executeRawUnsafe(statement).catch(() => {});
      }
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

/**
 * Gives a Call ID to every call that has not got one, oldest call first.
 *
 * Minted after the rows are written rather than before, so a batch Callyzer redelivers - which it
 * does after a sync failure, and which lands on the rows it wrote the first time - does not spend a
 * number per call each time it arrives. The studio reads these codes as a count of the calls it has
 * taken, and a counter that jumped by a hundred on a retry would stop being one.
 *
 * Never throws, for the reason the whole of this file does not: a call without a code is still a
 * call on the board, and losing the delivery over the code would be the worse trade.
 */
async function assignCallIds({ batches = 1 } = {}) {
  let written = 0;
  try {
    for (let pass = 0; pass < batches; pass += 1) {
      const pending = await prisma.$queryRawUnsafe(
        "SELECT `id` FROM `sales_crm_call_log` WHERE `call_id` IS NULL OR `call_id` = ''"
        + " ORDER BY `called_at` ASC, `id` ASC LIMIT 500",
      );
      if (!pending.length) break;
      for (const row of pending) {
        const callId = await nextIdentifier("CALL_LOG");
        await prisma.$executeRawUnsafe(
          "UPDATE `sales_crm_call_log` SET `call_id` = ? WHERE `id` = ? AND (`call_id` IS NULL OR `call_id` = '')",
          callId, row.id,
        );
        written += 1;
      }
    }
    return written;
  } catch (error) {
    console.warn("Unable to assign CRM call ids:", error?.message || error);
    return written;
  }
}

/*
 * ── Every call already in the log gets its code, without anybody running anything ─────────────
 *
 * The codes were minted on delivery and nowhere else, so a database that had been taking calls
 * before this existed had a log full of rows with no `call_id` at all - and everything downstream
 * fell back to Callyzer's own id for the call, which is a string like
 * `XgnkwlIXrIKYMem-mDNAP7DPkVfFsV3-4IIhEogXFLU`. That is what the board was showing in its first
 * column, and the Contacts directory, which asks for calls that *have* a code, was answering with
 * none of them.
 *
 * Backfilling on the first read fixes both without an operator step, which matters because the same
 * fault would otherwise arrive fresh on the production database the day it deploys.
 *
 * Once per process, through a cached promise, like `ensureCallLogTable` above: the first read after
 * a restart pays for it and every read after that is a resolved promise. Capped, because a read
 * request is not the place to walk an unbounded table - what is left over is picked up by the next
 * restart, or by `retireCallyzerCallLeads.js`, which walks the whole log deliberately.
 */
const BACKFILL_BATCHES = 40;

/*
 * ── The codes minted under the old tag ────────────────────────────────────────────────────────
 *
 * A Call ID was `DBS-CID-000012` and is `DBS-CLID-000012`; see `CALL_LOG` in
 * ../../../services/identifiers.js for why the tag moved. Only the tag changed - the number is the
 * same number, so this is a rename of every code and never a renumbering of the log.
 *
 * Rewritten in place rather than left to sit alongside the new form. Two formats on one board is
 * the fault the tag change was meant to end: a reader would have `DBS-CID-000012` and
 * `DBS-CLID-000013` in adjacent rows with nothing to say they are the same kind of thing, and a
 * search for one would not find the other.
 *
 * Safe to run on every start and cheap when there is nothing to do: it is a prefix match on an
 * indexed unique column, and after the first pass it matches no rows at all. Idempotent by
 * construction - `DBS-CLID-…` does not begin `DBS-CID-`, so a second run rewrites nothing.
 *
 * The unique index cannot be violated by it: the number is untouched, so a code that was unique
 * before is unique after, and no `DBS-CLID-` code can exist yet on a log this has not been run over.
 *
 * `call_id` is the only place these strings are stored. The board reads them, the Contacts directory
 * reads them, and neither writes one anywhere else - a lead records its *own* enquiry id, never a
 * call's - so there is no second table to keep in step.
 */
async function renameCallIdTag() {
  try {
    return await prisma.$executeRawUnsafe(
      "UPDATE `sales_crm_call_log` SET `call_id` = CONCAT('DBS-CLID-', SUBSTRING(`call_id`, 9))"
      + " WHERE `call_id` LIKE 'DBS-CID-%'",
    );
  } catch (error) {
    // Never fatal, for the reason the rest of this file is not: a call under the old code is still
    // a call on the board, and losing the log over the shape of its identifier is the worse trade.
    console.warn("Unable to rename CRM call ids to the CLID tag:", error?.message || error);
    return 0;
  }
}

/*
 * ── The calls stored five and a half hours into their own future ──────────────────────────────
 *
 * `calledAt` read Callyzer's wall clock as UTC when it is Asia/Kolkata, so every call delivered
 * before that was fixed went into `called_at` shifted forward by 5h30: a call taken at 12:00 was
 * stored as 12:00Z and the Call Logs tab, which renders in the studio's zone, showed it at 5:30 pm.
 * Fixing the reader leaves the log already written untouched, which is the worse half of the fault -
 * the tab would disagree with itself, old calls at one clock and new ones at another.
 *
 * Recomputed from `call_date` and `call_time` rather than shifted blindly. Those two are stored
 * exactly as Callyzer sent them and nothing has ever written to them, so they are the record of when
 * the call happened and this is a re-derivation rather than an edit.
 *
 * Idempotent by construction, which is what makes it safe to run on every start: it matches only a
 * row whose `called_at` is still character-for-character its un-shifted wall clock, and a row it has
 * corrected no longer is one. A call already on the right clock is not touched, and no row can be
 * shifted twice.
 *
 * A call whose `call_date` never parsed was stamped from the delivery instead, and its `synced_at`
 * lives inside `raw` rather than in a column of its own - so it is not matched here and keeps the
 * moment it was given. Those are the calls Callyzer sent without a usable date, and they are rare.
 */
async function restampCalledAt() {
  // MySQL compares a DATETIME against this string form directly; `call_time` is whatever Callyzer
  // sent, including a clock with no seconds, and a blank one is the midnight `calledAt` defaults to.
  const wallClock = "CONCAT(`call_date`, ' ', COALESCE(NULLIF(`call_time`, ''), '00:00:00'))";
  try {
    return await prisma.$executeRawUnsafe(
      `UPDATE \`sales_crm_call_log\` SET \`called_at\` = DATE_SUB(${wallClock}, INTERVAL 330 MINUTE)`
      + " WHERE `call_date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'"
      + ` AND \`called_at\` = ${wallClock}`,
    );
  } catch (error) {
    // Never fatal, for the reason the rest of this file is not: a call on the wrong clock is still a
    // call on the board, and losing the log over its timestamp is the worse trade.
    console.warn("Unable to restamp CRM call times onto the studio's clock:", error?.message || error);
    return 0;
  }
}

/*
 * ── The handsets nobody had been found for ────────────────────────────────────────────────────
 *
 * A call is matched to its employee when it is delivered, but the repository moves underneath it:
 * somebody is added a week after their first call, or a name is corrected to the spelling the
 * handset already used. Those calls were resolved against a repository that did not yet hold them,
 * and nothing would ever look again.
 *
 * Only rows matched to nobody. A call that already names an employee is never re-examined, because
 * a company SIM passed from one person to another would otherwise re-file every call its previous
 * holder made - the match is a record of whose call it was, not of whose phone it is now.
 *
 * Resolved through `employeeNameKey` rather than by SQL comparison, so this and the ingest agree on
 * what counts as the same name down to the last space. The distinct labels in a call log are tens
 * of rows even where the log is hundreds of thousands, so it is a handful of statements.
 */
async function matchEmployeesToCalls() {
  let matched = 0;
  try {
    // One row per distinct handset identity, not per call: a log of hundreds of thousands carries
    // tens of these, so the whole pass is a handful of statements.
    const pending = await prisma.$queryRawUnsafe(
      "SELECT DISTINCT COALESCE(`employee_code`, '') AS `code`, COALESCE(`employee_name`, '') AS `name`"
      + " FROM `sales_crm_call_log` WHERE `matched_employee_id` IS NULL"
      + " AND (TRIM(COALESCE(`employee_code`, '')) <> '' OR TRIM(COALESCE(`employee_name`, '')) <> '')",
    );
    if (!pending.length) return 0;

    const table = await employeeMatchTable();
    for (const row of pending) {
      const id = resolveEmployeeId(table, { employeeCode: row.code, employeeName: row.name });
      if (!id) continue;
      matched += await prisma.$executeRawUnsafe(
        "UPDATE `sales_crm_call_log` SET `matched_employee_id` = ?"
        + " WHERE `matched_employee_id` IS NULL AND COALESCE(`employee_code`, '') = ?"
        + " AND COALESCE(`employee_name`, '') = ?",
        id, row.code, row.name,
      );
    }
    return matched;
  } catch (error) {
    // Never fatal, for the reason the rest of this file is not: an unmatched call still reads under
    // the label Callyzer gave it, which is the honest answer rather than a lost one.
    console.warn("Unable to match CRM calls to their employees:", error?.message || error);
    return matched;
  }
}

let callIdsReady = null;
async function ensureCallIds() {
  if (!callIdsReady) {
    callIdsReady = (async () => {
      await ensureCallLogTable();
      // Before the minting below, so a run that renames and mints in the same pass cannot put a new
      // code through the rename it does not need.
      const renamed = await renameCallIdTag();
      if (renamed) console.info(`CRM call log: ${Number(renamed).toLocaleString()} call(s) renumbered from CID to CLID.`);
      const restamped = await restampCalledAt();
      if (restamped) console.info(`CRM call log: ${Number(restamped).toLocaleString()} call(s) restamped onto the studio's clock (was 5h30 fast).`);
      const matched = await matchEmployeesToCalls();
      if (matched) console.info(`CRM call log: ${Number(matched).toLocaleString()} call(s) matched to an employee by handset name.`);
      const written = await assignCallIds({ batches: BACKFILL_BATCHES });
      if (written) console.info(`CRM call log: ${written.toLocaleString()} call(s) given a Call ID.`);
      // The other thing a log taken before this existed is carrying: calls naming a lead that is
      // not there, which no amount of adding the caller could fix. See `relinkOrphanedCalls`.
      const relinked = await relinkOrphanedCalls();
      if (relinked) console.info(`CRM call log: ${Number(relinked).toLocaleString()} call(s) relinked to the lead their caller was added as.`);
    })().catch((error) => {
      callIdsReady = null;
      throw error;
    });
  }
  return callIdsReady;
}

/**
 * The first of these that is actually a value.
 *
 * Only text and numbers count. This used to take anything and `String()` it, which turned two real
 * Callyzer shapes into nonsense: an account that delivers `recording: { file_url }` as an object
 * stored the literal "[object Object]" as the recording, and one that sends
 * `call_recording_url: false` for a call with no recording stored the word "false" - both of them
 * non-empty, so both stopped the search and both reached the screen as the answer.
 */
function pickFirst(...values) {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function parseDurationSeconds(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;

    if (Number.isFinite(value)) {
      return Math.max(0, Math.round(value));
    }

    const text = String(value).trim().toLowerCase();
    if (!text) continue;

    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return Math.max(0, Math.round(Number(text)));
    }

    const hms = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (hms) {
      const hours = Number(hms[3] === undefined ? 0 : hms[1]);
      const minutes = Number(hms[3] === undefined ? hms[1] : hms[2]);
      const seconds = Number(hms[3] === undefined ? hms[2] : hms[3]);
      return Math.max(0, (hours * 3600) + (minutes * 60) + seconds);
    }

    let total = 0;
    let matched = false;
    const units = /(\d+(?:\.\d+)?)\s*(h(?:ours?)?|hr?s?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)/g;
    for (const match of text.matchAll(units)) {
      matched = true;
      const amount = Number(match[1]);
      const unit = match[2][0];
      if (unit === "h") total += amount * 3600;
      else if (unit === "m") total += amount * 60;
      else total += amount;
    }
    if (matched) return Math.max(0, Math.round(total));

    const digits = text.match(/\d+/g);
    if (digits?.length) {
      return Math.max(0, Math.round(Number(digits[0])));
    }
  }
  return 0;
}

/*
 * The studio's clock, which is the clock Callyzer reports on.
 *
 * Its payload carries no offset at all - `call_date: "2026-09-22"`, `call_time: "11:36:00"` - and
 * those are the handset's own wall clock, so they are Asia/Kolkata. Asia/Kolkata keeps one offset
 * all year, so a fixed shift is the whole rule; the same reasoning as STUDIO_OFFSET_MS in
 * image-selection/dashboard/service.js.
 */
const STUDIO_OFFSET = "+05:30";

/**
 * The moment the call happened, as a sortable timestamp.
 *
 * Callyzer sends the date and the clock time in separate fields, and the Call Logs tab has to
 * order calls newest first - which string sorting on "17:49:41" does not do across days. A call
 * whose date will not parse sorts by when it was delivered instead of vanishing.
 *
 * Read in the studio's zone, and emphatically not as UTC. This appended `Z` to a wall clock that
 * was already IST, which does not mark the instant - it moves it: a call taken at 11:36 was stored
 * as 11:36 UTC and the Call Logs tab, which renders in Asia/Kolkata, showed it at 5:06 pm. Every
 * call in the log read five and a half hours into its own future, so the tab disagreed with the
 * `call_time` printed beside it and a call made this morning sorted as if it were still to come.
 */
function calledAt(callLog) {
  const date = pickFirst(callLog.call_date, callLog.callDate).slice(0, 10);
  const time = pickFirst(callLog.call_time, callLog.callTime) || "00:00:00";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const stamp = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}${STUDIO_OFFSET}`);
    if (!Number.isNaN(stamp.getTime())) return stamp;
  }
  const synced = new Date(pickFirst(callLog.synced_at, callLog.syncedAt, callLog.modified_at).replace(" ", "T") + STUDIO_OFFSET);
  return Number.isNaN(synced.getTime()) ? new Date() : synced;
}


/**
 * The first non-empty string under any key in this payload that means the thing asked for.
 *
 * The named aliases in `toRow` are what Callyzer's published payload calls these fields, and they
 * are tried first because they are the answer for a normal delivery. This is the net beneath them.
 *
 * Callyzer's webhook is one shape, but what an account actually carries in it is not: the outcome
 * of a call, the note typed against it and the recording are per-account features, their keys have
 * moved between versions of their app, and some accounts deliver them one level down inside an
 * object of their own rather than flat on the call. A field that arrived under a name nobody here
 * predicted was being dropped on the floor while Callyzer's own screen showed it - which is exactly
 * the "partially pulled" this exists to end.
 *
 * Matched on the **key** only, never on the value: a note is never filled from something that
 * merely reads like prose. The key it matches on is the path, joined - `recording: { file_url }`
 * is tested as `recording_file_url`, because `file_url` on its own says nothing about what kind of
 * file it is and the name of the object holding it is the half that does.
 *
 * Depth-limited, and arrays are not walked: a call's own fields are on the call, and descending
 * into a list of something else would be guessing.
 */
function deepFind(source, matches, prefix = "", depth = 3) {
  if (!source || typeof source !== "object" || Array.isArray(source) || depth < 0) return "";
  const nested = [];
  for (const [key, value] of Object.entries(source)) {
    const path = `${prefix}${String(key).toLowerCase()}`;
    if (value && typeof value === "object") {
      if (!Array.isArray(value)) nested.push([value, `${path}_`]);
      continue;
    }
    // Only text and numbers, for the reason `pickFirst` above only takes those: a `false` meaning
    // "no recording" must not arrive on screen as the word.
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (!text) continue;
    if (matches(path)) return text;
  }
  // Breadth first: a field flat on the call beats the same name buried inside something else.
  for (const [value, path] of nested) {
    const found = deepFind(value, matches, path, depth - 1);
    if (found) return found;
  }
  return "";
}

/*
 * What each of the three counts as, by key.
 *
 * Deliberately narrow. `status` alone would match `sync_status` and `upload_status`, which say
 * something about the delivery rather than about the call, so the sync and delete bookkeeping is
 * named and excluded rather than hoped against.
 */
const NOTE_KEY = /(^|_)(note|notes|remark|remarks|comment|comments|description|summary)$/;
const RECORDING_KEY = /(record|recording|audio|voice)/;
const RECORDING_LOCATION = /(url|uri|link|file|path|src)$/;
const STATUS_KEY = /(status|disposition|outcome|result|label|tag)$/;
const NOT_A_CALL_STATUS = /(sync|upload|download|delete|deleted|process|transcri|record|http)/;

const isNoteKey = (key) => NOTE_KEY.test(key) && !NOT_A_CALL_STATUS.test(key);
// A recording is a place a file lives, so the key has to name one - `call_recording_url`,
// `recording_link` - or be the bare word itself. `recording_status` is not a recording.
const isRecordingKey = (key) => RECORDING_KEY.test(key) && (RECORDING_LOCATION.test(key) || key === "recording" || key === "call_recording");
const isStatusKey = (key) => STATUS_KEY.test(key) && !NOT_A_CALL_STATUS.test(key);

/**
 * One Callyzer call log, flattened to the columns above.
 *
 * `enquiryId` is the lead the call belongs to, decided by the caller - the webhook matches on the
 * last ten digits of the number, and creates the lead when nothing matches.
 */
function toRow(callLog, { enquiryId, employee = {} } = {}) {
  const number = pickFirst(
    callLog.client_number, callLog.clientNumber, callLog.customer_number, callLog.phone, callLog.number,
  );
  const code = pickFirst(callLog.client_country_code, callLog.clientCountryCode).replace(/\D/g, "");
  return {
    // Callyzer's id where there is one. Without it a redelivery cannot be told from a second call,
    // so the number and the moment stand in - two calls to the same client in the same second are
    // the same call.
    id: pickFirst(callLog.id, callLog.call_id, callLog.callId) || `${number || "unknown"}-${calledAt(callLog).getTime()}`,
    enquiryId: String(enquiryId || ""),
    clientName: pickFirst(
      callLog.client_name, callLog.clientName, callLog.customer_name, callLog.customerName,
      callLog.contact_name, callLog.contactName, callLog.name,
    ),
    // Stored with the country code where Callyzer sends one, so the row reads the way the client's
    // phone actually is rather than as a bare local number.
    clientNumber: code && number && !number.startsWith("+") ? `+${code}${number.replace(/\D/g, "")}` : number,
    employeeName: pickFirst(
      employee.emp_name, employee.empName, callLog.emp_name, callLog.empName, callLog.employee_name,
      callLog.employeeName, callLog.crm, callLog.assigned_to, callLog.assignedTo, callLog.owner,
    ),
    employeeNumber: pickFirst(
      employee.emp_number, employee.empNumber, callLog.emp_number, callLog.empNumber,
      callLog.employee_number, callLog.employeeNumber,
    ),
    /*
     * The code the studio gave this handset in the Callyzer dashboard, where there is one.
     *
     * Optional in Callyzer's payload - their own sample carries it for one employee and omits it for
     * the next - so it is read where it is offered and the name carries the match where it is not.
     */
    employeeCode: pickFirst(
      employee.emp_code, employee.empCode, employee.employee_code, employee.employeeCode,
      callLog.emp_code, callLog.empCode, callLog.employee_code, callLog.employeeCode,
    ),
    callType: pickFirst(callLog.call_type, callLog.callType, callLog.type, callLog.direction),
    callMethod: pickFirst(callLog.call_method, callLog.callMethod, callLog.method),
    callMode: pickFirst(callLog.call_mode, callLog.callMode, callLog.mode),
    callDate: pickFirst(callLog.call_date, callLog.callDate, callLog.date),
    callTime: pickFirst(callLog.call_time, callLog.callTime, callLog.time),
    durationSeconds: parseDurationSeconds(
      callLog.duration, callLog.duration_seconds, callLog.durationSeconds,
      callLog.call_duration, callLog.callDuration, callLog.duration_sec,
    ),
    // The three Callyzer shows on its own screen and this CRM was leaving blank. Their published
    // names first, then whatever the account actually calls them - see `deepFind`.
    note: pickFirst(
      callLog.note, callLog.notes, callLog.remark, callLog.remarks,
      callLog.comment, callLog.comments, callLog.description, callLog.summary,
    ) || deepFind(callLog, isNoteKey),
    recordingUrl: pickFirst(
      callLog.call_recording_url, callLog.callRecordingUrl, callLog.recording_url,
      callLog.recordingUrl, callLog.recording, callLog.audio_url, callLog.audioUrl,
    ) || deepFind(callLog, isRecordingKey),
    crmStatus: pickFirst(
      callLog.crm_status, callLog.crmStatus, callLog.call_status, callLog.callStatus,
      callLog.status, callLog.result, callLog.disposition, callLog.outcome,
    ) || deepFind(callLog, isStatusKey),
    calledAt: calledAt(callLog),
    raw: JSON.stringify(callLog),
  };
}

/**
 * Writes a batch of calls, against the leads they belong to where they belong to one.
 *
 * A call no longer needs a lead to be stored. Every delivered call used to create one, which is how
 * the studio's enquiry numbers came to count its missed calls; a call from a number the CRM does
 * not hold is now kept here and here only, and appears on the Calls board under its own Call ID
 * until somebody reads the caller and adds them. `enquiryId` is then blank, and is filled in by
 * `linkCallsToLead` at the moment the lead is created.
 *
 * Never throws: a call log that cannot be stored must not fail the delivery. Callyzer retries a
 * failed webhook wholesale, so a half-written batch would arrive again - and every row here is
 * written by its own id, so a retry lands on the same rows.
 */
async function recordCallLogs(entries = []) {
  const rows = entries
    .map(({ callLog, enquiryId, employee }) => toRow(callLog || {}, { enquiryId, employee }))
    .filter((row) => row.id);
  if (!rows.length) return 0;

  try {
    await ensureCallLogTable();
  } catch (error) {
    console.warn("Unable to prepare the CRM call log table:", error?.message || error);
    return 0;
  }

  /*
   * Whose handset each of these is, resolved once for the batch rather than per call.
   *
   * The match is made here, at the moment of delivery, and kept - a company SIM passed from one
   * person to another must not re-file the calls the first of them made on it. See
   * `matchEmployeesToCalls` for the other half: a handset nobody could be found for is tried again
   * later, which is the only case a call's match is allowed to change.
   */
  const table = await employeeMatchTable();
  for (const row of rows) row.matchedEmployeeId = resolveEmployeeId(table, row);

  let written = 0;
  for (const row of rows) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO \`sales_crm_call_log\`
           (\`id\`, \`enquiry_id\`, \`client_name\`, \`client_number\`, \`employee_name\`, \`employee_number\`,
            \`employee_code\`, \`matched_employee_id\`,
            \`call_type\`, \`call_method\`, \`call_mode\`, \`call_date\`, \`call_time\`, \`duration_seconds\`,
            \`note\`, \`recording_url\`, \`crm_status\`, \`source\`, \`raw\`, \`called_at\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'callyzer', ?, ?)
         ON DUPLICATE KEY UPDATE
           /*
            * A link, once made, is never unmade by a redelivery. The same call arriving again
            * carries whatever the webhook knew at the time, which for a caller who has since been
            * added as a lead is nothing - and blanking the link would take the call's history off
            * the lead it belongs to.
            */
           \`enquiry_id\` = IF(VALUES(\`enquiry_id\`) = '', \`enquiry_id\`, VALUES(\`enquiry_id\`)),
           \`client_name\` = VALUES(\`client_name\`),
           \`client_number\` = VALUES(\`client_number\`),
           \`employee_name\` = VALUES(\`employee_name\`),
           \`employee_number\` = VALUES(\`employee_number\`),
           \`employee_code\` = VALUES(\`employee_code\`),
           /*
            * A match, once made, is never unmade by a redelivery - and never changed either. The
            * first resolution is the one that stands, so a SIM that has since passed to somebody
            * else cannot re-file the calls its previous holder made. COALESCE the other way round
            * would do exactly that.
            */
           \`matched_employee_id\` = COALESCE(\`matched_employee_id\`, VALUES(\`matched_employee_id\`)),
           \`call_type\` = VALUES(\`call_type\`),
           \`call_method\` = VALUES(\`call_method\`),
           \`call_mode\` = VALUES(\`call_mode\`),
           \`call_date\` = VALUES(\`call_date\`),
           \`call_time\` = VALUES(\`call_time\`),
           \`duration_seconds\` = VALUES(\`duration_seconds\`),
           \`note\` = VALUES(\`note\`),
           \`recording_url\` = VALUES(\`recording_url\`),
           \`crm_status\` = VALUES(\`crm_status\`),
           \`raw\` = VALUES(\`raw\`),
           \`called_at\` = VALUES(\`called_at\`)`,
        row.id, row.enquiryId, row.clientName || null, row.clientNumber || null,
        row.employeeName || null, row.employeeNumber || null,
        row.employeeCode || null, row.matchedEmployeeId ?? null,
        row.callType || null, row.callMethod || null, row.callMode || null,
        row.callDate || null, row.callTime || null, row.durationSeconds,
        row.note || null, row.recordingUrl || null, row.crmStatus || null,
        row.raw, row.calledAt,
      );
      written += 1;
    } catch (error) {
      console.warn("Unable to record a CRM call log:", error?.message || error);
    }
  }
  // Every call the studio has taken carries a code of its own, whether or not it is anybody's lead.
  await assignCallIds();
  return written;
}

/*
 * ── What counts as the lead a call belongs to ─────────────────────────────────────────────────
 *
 * Being *named* by a call's `enquiry_id` is not the same as being the lead it belongs to. The
 * column is plain text with nothing keeping it honest, and three things write it: the old webhook
 * minted a lead for every call it was sent, a caller already in the CRM is stamped at ingest, and
 * `linkCallsToLead` writes it when somebody actually reads a caller and adds them. So a call can
 * name a lead that was deleted since, one `retireCallyzerCallLeads.js` cleared out, or an id in a
 * format no lead has carried for a year - `DBS-DD-EID-35950`, say.
 *
 * A lead is really there when it is live and has been given a vertical. The vertical is the test
 * because it is exactly what "added to their respective verticals" means, and nothing else creates
 * a lead without one: Add Lead makes it a required radio and the CSV import sets it per template.
 *
 * Stated here, once, and read by both sides. The Calls board already judged a link this way when
 * it *showed* one (`LEAD_JOIN` in callBoardService.js) while `linkCallsToLead` below judged it by
 * "is the column empty" when it *wrote* one - and the two disagreeing is the whole of the fault
 * this predicate exists to prevent. A call left naming a dead id was unlinkable for good: the
 * writer saw a non-empty column and skipped it, the reader saw no lead and showed the Call ID, and
 * adding that caller to a vertical changed nothing on the board however many times it was done.
 */
const liveLeadSql = (alias) => `\`${alias}\`.\`deleted_at\` IS NULL AND TRIM(COALESCE(\`${alias}\`.\`vertical\`, '')) <> ''`;

/** The call's own claim, judged: true only where the lead it names is really there. */
const CALL_HAS_LEAD_SQL = "EXISTS (SELECT 1 FROM `sales_crm_lead` `cl` WHERE `cl`.`enquiry_id` = `c`.`enquiry_id`"
  + ` AND ${liveLeadSql("cl")})`;

/**
 * This call's caller is in the CRM: the test the Calls board keeps a row on that board by.
 *
 * Asked two ways because a caller can be in the CRM without the call knowing it, and the call can
 * know it without the number agreeing. The call's own link answers the first - a caller added off
 * this board has every one of their calls stamped at that moment. The number answers the second,
 * and is the CRM's one rule for the same client, so a call delivered after the caller was written
 * down is placed even though nothing has stamped it, and a lead whose phone was corrected later
 * still owns the calls it was corrected to.
 *
 * Written as two `EXISTS` rather than one with an `OR` inside it on purpose: each of these is an
 * index read - the lead's primary key, and `sales_crm_lead_phone_key_idx` - and an `OR` across two
 * columns inside a single subquery is where that stops being true.
 */
const callerIsALeadSql = `(${CALL_HAS_LEAD_SQL} OR EXISTS (SELECT 1 FROM \`sales_crm_lead\` \`pl\``
  + " WHERE `pl`.`phone_key` = RIGHT(REGEXP_REPLACE(COALESCE(`c`.`client_number`, ''), '[^0-9]', ''), 10)"
  + ` AND ${liveLeadSql("pl")}))`;

/**
 * The lead this caller's calls belong to: the first one they were written down as.
 *
 * A number may be one enquiry in each vertical - that is the CRM's own rule, and the duplicate
 * check in the controller says so in as many words - so a caller can be a Corp lead and a Qua Qua
 * lead at once. Their call history is not split between the two: it stays with the enquiry they
 * were first added as, which is the same answer `linkCallsToLead` arrives at by never unmaking a
 * link that has already been made.
 */
const FIRST_LEAD_FOR_CALLER_SQL = "SELECT `fl`.`enquiry_id` FROM `sales_crm_lead` `fl`"
  + ` WHERE ${liveLeadSql("fl")}`
  + " AND `fl`.`phone_key` = RIGHT(REGEXP_REPLACE(COALESCE(`c`.`client_number`, ''), '[^0-9]', ''), 10)"
  + " ORDER BY `fl`.`created_at` ASC, `fl`.`enquiry_id` ASC LIMIT 1";

/**
 * Hands this caller's calls to the lead just created for them.
 *
 * A call waits on the Calls board with no lead of its own until somebody adds the caller, and this
 * is that moment: every call from that number is linked at once, not just the one that was
 * double-clicked. A client who rang five times before anybody got to them has five calls of history,
 * and splitting them across "the call that made the lead" and "the rest" would leave the Call Logs
 * tab showing one conversation out of five.
 *
 * Matched on the last ten digits, the CRM's one rule for the same client, so the country code
 * Callyzer stores does not decide whether a call is theirs.
 *
 * Claims a call whose `enquiry_id` names no live lead as readily as one with the column empty - see
 * `CALL_HAS_LEAD_SQL`. A link that is already good is still never taken: a caller added to a second
 * vertical later does not lift the call history off the enquiry they were first added as.
 */
async function linkCallsToLead(phone, enquiryId) {
  const id = String(enquiryId || "").trim();
  const key = numberKey(phone);
  if (!id || !key) return 0;
  try {
    await ensureCallLogTable();
    return await prisma.$executeRawUnsafe(
      "UPDATE `sales_crm_call_log` `c` SET `c`.`enquiry_id` = ?"
      + ` WHERE NOT ${CALL_HAS_LEAD_SQL}`
      + " AND RIGHT(REGEXP_REPLACE(COALESCE(`c`.`client_number`, ''), '[^0-9]', ''), 10) = ?",
      id, key,
    );
  } catch (error) {
    console.warn("Unable to link CRM call logs to a lead:", error?.message || error);
    return 0;
  }
}

/**
 * Every call still naming a lead that is not there, handed to the lead its caller was added as.
 *
 * The repair for the calls the fault above already stranded, and it needs to be a repair rather
 * than only a corrected rule: nothing re-runs `linkCallsToLead` for a lead that already exists, so
 * a call stamped with a dead id before this would have gone on showing its Call ID for good, and
 * the studio's only recourse was to add the caller yet again.
 *
 * Re-pointed at the caller's first live lead where there is one, and blanked where there is not -
 * blank is what the board reads such a call as anyway, and it is what lets the next person who adds
 * that caller claim it. Matched on `phone_key`, which is indexed, and run once per process beside
 * the Call ID backfill, for the reason that one is: the same fault otherwise arrives fresh on the
 * production database the day this deploys, and an operator step is a step somebody has to know
 * about.
 */
async function relinkOrphanedCalls() {
  try {
    await ensureCallLogTable();
    return await prisma.$executeRawUnsafe(
      "UPDATE `sales_crm_call_log` `c`"
      + ` SET \`c\`.\`enquiry_id\` = COALESCE((${FIRST_LEAD_FOR_CALLER_SQL}), '')`
      + " WHERE COALESCE(`c`.`enquiry_id`, '') <> ''"
      + ` AND NOT ${CALL_HAS_LEAD_SQL}`,
    );
  } catch (error) {
    console.warn("Unable to relink orphaned CRM call logs:", error?.message || error);
    return 0;
  }
}

/**
 * The last ten digits of a number, the CRM's one rule for "the same client".
 *
 * Restated here rather than imported from `crmLeadService`, which this file must not depend on -
 * it is the lead store and this is the call store, and the call store is loaded by the webhook
 * before any lead is read. Kept identical to `phoneMatchKey` on purpose.
 */
function numberKey(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 5 ? digits : "";
}

/**
 * The calls held against one lead, newest first.
 *
 * Found by the lead's own number as well as by its id, because a call belongs to a client rather
 * than to a row. Calls that reached the CRM before the lead existed, and calls that landed on a
 * duplicate of it back when a delivery could create a second row for a number already held, are the
 * same client's calls and belong on the same tab - a lead whose history was split across two records
 * reads as a lead with no history at all.
 *
 * `phone` is optional: without it this behaves exactly as it did, matching on the id alone. A plain
 * number is still accepted as the limit, which is how the AI context builders call it.
 *
 * Answers with an empty list rather than failing when the table has never been created - a CRM
 * that has not yet received a Callyzer delivery still opens its Call Logs tab.
 */
async function listLeadCallLogs(enquiryId, options = {}) {
  const { phone = "", limit = 200 } = typeof options === "number" ? { limit: options } : (options || {});
  const id = String(enquiryId || "").trim();
  if (!id) return [];

  try {
    await ensureCallLogTable();
  } catch (error) {
    console.warn("Unable to prepare the CRM call log table:", error?.message || error);
    return [];
  }

  const key = numberKey(phone);
  const size = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`id\`, \`enquiry_id\` AS \`enquiryId\`, \`client_name\` AS \`clientName\`,
            \`client_number\` AS \`clientNumber\`, \`employee_name\` AS \`employeeName\`,
            \`call_type\` AS \`callType\`, \`call_method\` AS \`callMethod\`, \`call_mode\` AS \`callMode\`,
            \`call_date\` AS \`callDate\`, \`call_time\` AS \`callTime\`,
            \`duration_seconds\` AS \`durationSeconds\`, \`note\`, \`recording_url\` AS \`recordingUrl\`,
            \`crm_status\` AS \`crmStatus\`, \`source\`, \`raw\`, \`called_at\` AS \`calledAt\`
     FROM \`sales_crm_call_log\`
     WHERE \`enquiry_id\` = ?${key ? " OR RIGHT(REGEXP_REPLACE(COALESCE(`client_number`, ''), '[^0-9]', ''), 10) = ?" : ""}
     ORDER BY \`called_at\` DESC, \`id\` DESC
     LIMIT ${size}`,
    ...(key ? [id, key] : [id]),
  );

  return rows.map((row) => ({
    ...row,
    durationSeconds: Number(row.durationSeconds) || 0,
    calledAt: row.calledAt ? new Date(row.calledAt).toISOString() : null,
  }));
}

/**
 * Every call on a **number**, for a screen that has a person but no enquiry.
 *
 * The call log is one table keyed by the number the handset dialled, fed by the integration for the
 * whole studio - it is not the CRM's private property, it had simply only ever been read from there.
 * The Interview register needs the same answer about a candidate: has anybody actually rung this person,
 * when, and for how long, which is the question the Follow Up stage exists to ask.
 *
 * Beside `listLeadCallLogs` and sharing its columns, its ordering and its table guard, rather than
 * copied into the other module - a copy is the one that stops being updated when a column is added.
 *
 * **A number that cannot be read returns nothing.** `numberKey` gives "" for anything too short to be a
 * number, and a blank key in the `WHERE` would match every row in the table: the whole studio's call
 * history, handed to a screen that asked about one candidate. A candidate with no number has no calls.
 */
async function listCallLogsForNumber(phone, options = {}) {
  const { limit = 200 } = options || {};
  const key = numberKey(phone);
  if (!key) return [];

  try {
    await ensureCallLogTable();
  } catch (error) {
    console.warn("Unable to prepare the CRM call log table:", error?.message || error);
    return [];
  }

  const size = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`id\`, \`enquiry_id\` AS \`enquiryId\`, \`client_name\` AS \`clientName\`,
            \`client_number\` AS \`clientNumber\`, \`employee_name\` AS \`employeeName\`,
            \`call_type\` AS \`callType\`, \`call_method\` AS \`callMethod\`, \`call_mode\` AS \`callMode\`,
            \`call_date\` AS \`callDate\`, \`call_time\` AS \`callTime\`,
            \`duration_seconds\` AS \`durationSeconds\`, \`note\`, \`recording_url\` AS \`recordingUrl\`,
            \`crm_status\` AS \`crmStatus\`, \`source\`, \`raw\`, \`called_at\` AS \`calledAt\`
     FROM \`sales_crm_call_log\`
     WHERE RIGHT(REGEXP_REPLACE(COALESCE(\`client_number\`, ''), '[^0-9]', ''), 10) = ?
     ORDER BY \`called_at\` DESC, \`id\` DESC
     LIMIT ${size}`,
    key,
  );

  return rows.map((row) => ({
    ...row,
    durationSeconds: Number(row.durationSeconds) || 0,
    calledAt: row.calledAt ? new Date(row.calledAt).toISOString() : null,
  }));
}

/**
 * How many calls are on record for each of these leads.
 *
 * What "Contact Repeated" is answering: a client the studio has spoken to more than once. Counted
 * from the call log rather than kept as a tally on the lead, so a redelivered batch - which writes
 * the same rows again by id - cannot inflate it.
 */
async function callLogCounts(entries = []) {
  /*
   * Counted by number where one is given, so the total agrees with the tab.
   *
   * `listLeadCallLogs` shows a client's calls whether they landed on this lead or on a duplicate of
   * it, and a marker reading "Enquired 2 times" over a list of four calls is worse than no marker.
   * A plain string is still accepted, and counts by id alone, so an older caller is unaffected.
   */
  const byId = new Map();
  for (const entry of entries) {
    const id = String((typeof entry === "string" ? entry : entry?.enquiryId) || "").trim();
    if (!id) continue;
    const key = typeof entry === "string" ? "" : numberKey(entry?.phone);
    // The first number seen for an id wins, so one lead is counted one way within a delivery.
    if (!byId.has(id)) byId.set(id, key);
  }
  if (!byId.size) return new Map();

  const totals = new Map();
  try {
    await ensureCallLogTable();
    for (const [id, key] of byId) {
      const rows = await prisma.$queryRawUnsafe(
        "SELECT COUNT(*) AS `total` FROM `sales_crm_call_log`"
        + ` WHERE \`enquiry_id\` = ?${key ? " OR RIGHT(REGEXP_REPLACE(COALESCE(`client_number`, ''), '[^0-9]', ''), 10) = ?" : ""}`,
        ...(key ? [id, key] : [id]),
      );
      totals.set(id, Number(rows?.[0]?.total) || 0);
    }
    return totals;
  } catch (error) {
    console.warn("Unable to count CRM call logs:", error?.message || error);
    return totals;
  }
}

/**
 * Every number that has ever appeared as an employee's own, as ten-digit match keys.
 *
 * The studio's staff directory, assembled from the deliveries themselves. It is what makes "one
 * employee rang another" answerable: Callyzer reports such a call against the caller only, so the
 * colleague on the other end looks exactly like a client unless the server already knows the number
 * belongs to staff - and it does, because that colleague's own calls have been arriving all along.
 *
 * Cached for a few minutes rather than read per delivery. The set changes when somebody joins, and
 * a webhook that queried it on every call would run one extra query per batch to learn the same
 * answer. A new employee is recognised from their first delivered call, plus at most the cache.
 *
 * Answers an empty set on any failure. Not knowing who the staff are means leads that should have
 * been filtered get through, which is recoverable; refusing the delivery is not.
 */
const STAFF_CACHE_MS = 5 * 60 * 1000;
let staffCache = { at: 0, numbers: new Set() };

async function knownEmployeeNumbers({ now = Date.now() } = {}) {
  if (now - staffCache.at < STAFF_CACHE_MS) return staffCache.numbers;
  try {
    await ensureCallLogTable();
    const rows = await prisma.$queryRawUnsafe(
      "SELECT DISTINCT `employee_number` AS `number` FROM `sales_crm_call_log` WHERE `employee_number` IS NOT NULL AND `employee_number` <> ''",
    );
    const numbers = new Set();
    for (const row of rows) {
      const digits = String(row.number || "").replace(/\D/g, "");
      const key = digits.length >= 10 ? digits.slice(-10) : digits.length >= 5 ? digits : "";
      if (key) numbers.add(key);
    }
    staffCache = { at: now, numbers };
    return numbers;
  } catch (error) {
    console.warn("Unable to read the known employee numbers:", error?.message || error);
    return staffCache.numbers;
  }
}

/** Drops the cached staff directory, so the next read goes to the database. For tests. */
function forgetKnownEmployeeNumbers() {
  staffCache = { at: 0, numbers: new Set() };
}

/**
 * One handset label, as a name is compared here: trimmed, collapsed, casefolded.
 *
 * "priya  s" and "Priya S" are one person typed twice, and a handset is labelled by hand - so the
 * comparison is forgiving about the things a person varies and strict about everything else. It is
 * never fuzzy beyond that: a near-miss is left unmatched rather than guessed at, because the wrong
 * id here puts one person's calls on another person's row.
 */
const employeeNameKey = (value) => String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

/** The same, for a code: `DBS-1`, ` dbs-1 ` and `Dbs-1` are the one employee. */
const employeeCodeKey = (value) => String(value || "").trim().toUpperCase();

/*
 * The repository, as the two things a Callyzer handset can be recognised by.
 *
 * **The code first.** Callyzer's `emp_code` is filled in per handset in their dashboard, so setting
 * it to the employee's own code (`DBS-1`) makes the match exact - it survives the handset being
 * relabelled and the SIM being swapped, neither of which a name does. It is optional in their
 * payload, so the name is the fallback rather than the rule.
 *
 * The number is deliberately not one of these. The handset number Callyzer reports is the company
 * SIM and the repository holds the employee's own number, so the two never meet - see README.md.
 *
 * Every employee who is not archived, rather than only the working ones: a call made last year by
 * somebody who has since left was still theirs, and leaving it unmatched would take their work off
 * the record the moment they were relieved. Which of those people a *report* may name is a
 * different question, asked at the other end by `staffCallSql`.
 *
 * A name two people share resolves to neither, and is why the code is worth filling in: there is
 * nothing to choose between them, and a coin flip files one person's calls under the other's name.
 * Codes are unique in the repository, so they have no such case.
 *
 * Cached for a few minutes like the staff directory above it: an employee added now is matched from
 * the next delivery, and the ones before that are picked up by `matchEmployeesToCalls`.
 */
const EMPLOYEE_CACHE_MS = 5 * 60 * 1000;
let employeeCache = { at: 0, table: null };

async function employeeMatchTable({ now = Date.now() } = {}) {
  if (employeeCache.table && now - employeeCache.at < EMPLOYEE_CACHE_MS) return employeeCache.table;
  try {
    const rows = await prisma.employee.findMany({
      where: { archivedAt: null },
      select: { id: true, employeeId: true, employeeName: true },
    });
    const byCode = new Map();
    const byName = new Map();
    // The repository's own spelling for an id, which is what a matched handset should be written
    // down as - on the call log's reports and on the `crm` of any lead the call becomes.
    const nameById = new Map();
    const ambiguous = new Set();
    for (const row of rows) {
      const code = employeeCodeKey(row.employeeId);
      if (code && !byCode.has(code)) byCode.set(code, row.id);
      const spelling = String(row.employeeName || "").trim();
      if (spelling) nameById.set(row.id, spelling);
      const name = employeeNameKey(row.employeeName);
      if (!name) continue;
      if (byName.has(name)) { ambiguous.add(name); continue; }
      byName.set(name, row.id);
    }
    for (const name of ambiguous) byName.delete(name);
    employeeCache = { at: now, table: { byCode, byName, nameById } };
    return employeeCache.table;
  } catch (error) {
    // Never fatal: a delivery that cannot resolve its handsets still stores its calls, and
    // `matchEmployeesToCalls` picks them up afterwards.
    console.warn("Unable to read the employees for call matching:", error?.message || error);
    return employeeCache.table || { byCode: new Map(), byName: new Map(), nameById: new Map() };
  }
}

/** The ladder, in one place so the ingest and the catch-up pass cannot read it differently. */
function resolveEmployeeId(table, { employeeCode, employeeName } = {}) {
  const code = employeeCodeKey(employeeCode);
  if (code && table.byCode.has(code)) return table.byCode.get(code);
  return table.byName.get(employeeNameKey(employeeName)) ?? null;
}

/**
 * Whose handset this is, written down the way the repository spells it.
 *
 * The answer the `crm` column on a lead wants: that column is a name copy of `owner_employee_id`
 * (see `nameCopies.js`), and the id is resolved back out of the text - so writing Callyzer's label
 * there resolves to nobody whenever the handset is named anything but the employee, and the lead
 * ends up owned by no one and on nobody's My Leads.
 *
 * Falls back to the label for a handset matched to nobody, which is the only name such a call has.
 */
function employeeNameFor(table, employee = {}) {
  const id = resolveEmployeeId(table, {
    employeeCode: employee.employeeCode ?? employee.emp_code ?? employee.empCode,
    employeeName: employee.employeeName ?? employee.emp_name ?? employee.empName,
  });
  return (id && table.nameById?.get(id)) || "";
}

/** Drops the cached repository, so the next resolve goes to the database. For tests. */
function forgetEmployeeIdsByName() {
  employeeCache = { at: 0, table: null };
}

module.exports = {
  ensureCallLogTable, recordCallLogs, listLeadCallLogs, listCallLogsForNumber, callLogCounts, toRow, calledAt,
  knownEmployeeNumbers, forgetKnownEmployeeNumbers, assignCallIds, ensureCallIds, renameCallIdTag, restampCalledAt, linkCallsToLead, numberKey,
  // The handset -> employee match: the two comparisons, the repository it reads, the ladder between
  // them, and the pass that catches up on the calls stored before their employee existed.
  employeeNameKey, employeeCodeKey, employeeMatchTable, resolveEmployeeId, employeeNameFor, forgetEmployeeIdsByName, matchEmployeesToCalls,
  // The one reading of "the lead a call belongs to", shared with the Calls board so the side that
  // writes a link and the side that keeps a row on that board cannot drift apart again.
  relinkOrphanedCalls, liveLeadSql, callerIsALeadSql,
};
