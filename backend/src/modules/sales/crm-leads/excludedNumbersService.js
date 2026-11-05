const prisma = require("../../../config/db");
const { phoneKey } = require("./callRouting");

/**
 * Numbers the CRM must never make a lead out of.
 *
 * The studio's own staff, their families, suppliers, the office landline - every number that turns
 * up in a Callyzer delivery and is not a client. They were configurable only through
 * `CALLYZER_IGNORE_NUMBERS` in the server's environment, which meant a change needed somebody with
 * shell access and a restart. The people who know which number is somebody's husband are the CRM
 * staff, so the list belongs in the CRM.
 *
 * A number here is excluded from the lead sheet. It is not hidden from the call log: the call still
 * happened and is still counted in Callyzer's own reports - what it does not do is create an
 * enquiry for somebody to ring back.
 *
 * Created at runtime like `sales_crm_lead_activity` and `sales_crm_call_log` beside it, which is how
 * every table this module has added since the initial schema is made. Prisma Migrate does not know
 * about it, so a `migrate dev` would offer to drop it - the same caveat that already applies to the
 * activity log, the call logs and the WhatsApp tables.
 */

const MAX_EXCLUDED = 1500;

/*
 * `match_key` is the last ten digits and is what the webhook compares against, so "+91 98765 43210"
 * and "9876543210" are one entry. It is UNIQUE, which is what makes adding the same number twice
 * impossible rather than merely discouraged - two rows for one number would have the list disagree
 * with itself about whether that number is excluded.
 */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_crm_excluded_number\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`name\` VARCHAR(191) NULL,
  \`number\` VARCHAR(50) NOT NULL,
  \`match_key\` VARCHAR(20) NOT NULL,
  \`created_by\` VARCHAR(191) NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE INDEX \`sales_crm_excluded_number_key\` (\`match_key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

let tableReady = null;
async function ensureExcludedNumberTable() {
  if (!tableReady) {
    tableReady = prisma.$executeRawUnsafe(CREATE_TABLE_SQL).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

class ExcludedNumberError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/*
 * The cached set the webhook reads.
 *
 * A delivery asks this once per batch and must not pay a query for a list that changes a few times a
 * month. Sixty seconds, and every write clears it, so a number added in the CRM stops creating leads
 * as soon as the save returns rather than a minute later - the cache is only there for the case
 * where nothing has changed at all.
 */
const CACHE_MS = 60 * 1000;
let cache = { at: 0, keys: new Set() };

function forgetExcludedNumbers() {
  cache = { at: 0, keys: new Set() };
}

/**
 * Every excluded number as a match key.
 *
 * Answers with whatever it last knew on a failure rather than throwing. A list that cannot be read
 * means some staff calls become leads, which somebody deletes; a delivery refused because of it
 * loses calls Callyzer will not send again.
 */
async function excludedNumberKeys({ now = Date.now() } = {}) {
  if (now - cache.at < CACHE_MS) return cache.keys;
  try {
    await ensureExcludedNumberTable();
    const rows = await prisma.$queryRawUnsafe("SELECT `match_key` AS `matchKey` FROM `sales_crm_excluded_number`");
    const keys = new Set();
    for (const row of rows) if (row.matchKey) keys.add(String(row.matchKey));
    cache = { at: now, keys };
    return keys;
  } catch (error) {
    console.warn("Unable to read the excluded numbers:", error?.message || error);
    return cache.keys;
  }
}

function toRow(row = {}) {
  return {
    id: String(row.id || ""),
    name: row.name || "",
    number: row.number || "",
    matchKey: row.matchKey || "",
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
}

/** The whole list, newest first. Small by design - 1,500 is the ceiling and the UI pages it. */
async function listExcludedNumbers() {
  await ensureExcludedNumberTable();
  const rows = await prisma.$queryRawUnsafe(
    "SELECT `id`, `name`, `number`, `match_key` AS `matchKey`, `created_at` AS `createdAt`"
    + " FROM `sales_crm_excluded_number` ORDER BY `created_at` DESC, `id` DESC",
  );
  return rows.map(toRow);
}

async function countExcludedNumbers() {
  const rows = await prisma.$queryRawUnsafe("SELECT COUNT(*) AS `total` FROM `sales_crm_excluded_number`");
  return Number(rows?.[0]?.total) || 0;
}

/**
 * The number as it will be matched, with the reason it cannot be if it cannot.
 *
 * Refused rather than silently normalised to nothing: a number typed wrongly that is quietly
 * accepted looks excluded and is not, which is the one failure this list cannot afford - somebody
 * believes their family's calls are out of the sheet and they are not.
 */
function keyFor(number) {
  const key = phoneKey(number);
  if (!key) throw new ExcludedNumberError(400, "Enter a valid phone number - at least five digits.");
  return key;
}

async function addExcludedNumber({ name = "", number = "", createdBy = null } = {}) {
  await ensureExcludedNumberTable();
  const key = keyFor(number);

  if (await countExcludedNumbers() >= MAX_EXCLUDED) {
    throw new ExcludedNumberError(400, `Up to ${MAX_EXCLUDED.toLocaleString()} numbers can be excluded. Remove one before adding another.`);
  }

  const id = `EXC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await prisma.$executeRawUnsafe(
      "INSERT INTO `sales_crm_excluded_number` (`id`, `name`, `number`, `match_key`, `created_by`) VALUES (?, ?, ?, ?, ?)",
      id, String(name).trim() || null, String(number).trim(), key, createdBy,
    );
  } catch (error) {
    // The UNIQUE index refereeing it, rather than a read-then-write that two people can both pass.
    if (isDuplicate(error)) throw new ExcludedNumberError(409, "That number is already excluded.");
    throw error;
  }
  forgetExcludedNumbers();
  return toRow({ id, name: String(name).trim(), number: String(number).trim(), matchKey: key, createdAt: new Date() });
}

async function updateExcludedNumber(id, { name = "", number = "" } = {}) {
  await ensureExcludedNumberTable();
  const key = keyFor(number);
  let updated;
  try {
    updated = await prisma.$executeRawUnsafe(
      "UPDATE `sales_crm_excluded_number` SET `name` = ?, `number` = ?, `match_key` = ? WHERE `id` = ?",
      String(name).trim() || null, String(number).trim(), key, String(id || ""),
    );
  } catch (error) {
    if (isDuplicate(error)) throw new ExcludedNumberError(409, "Another entry already excludes that number.");
    throw error;
  }
  if (!updated) throw new ExcludedNumberError(404, "That excluded number no longer exists.");
  forgetExcludedNumbers();
  return toRow({ id, name: String(name).trim(), number: String(number).trim(), matchKey: key });
}

async function removeExcludedNumbers(ids = []) {
  const list = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!list.length) return 0;
  await ensureExcludedNumberTable();
  const removed = await prisma.$executeRawUnsafe(
    `DELETE FROM \`sales_crm_excluded_number\` WHERE \`id\` IN (${list.map(() => "?").join(", ")})`,
    ...list,
  );
  forgetExcludedNumbers();
  return Number(removed) || 0;
}

/**
 * A pasted or uploaded list, added in one go.
 *
 * Every row is reported on rather than the import failing at the first bad one: a list of two
 * hundred numbers with one typo in it should add a hundred and ninety-nine and say which line was
 * wrong. Numbers already excluded are counted as skipped, not as failures - re-importing the same
 * list is a thing people do and it should be uneventful.
 */
async function importExcludedNumbers(entries = [], { createdBy = null } = {}) {
  await ensureExcludedNumberTable();
  const existing = await countExcludedNumbers();
  const result = { added: 0, skipped: 0, failed: [] };
  const seen = new Set();

  for (const [index, entry] of entries.entries()) {
    const name = String(entry?.name ?? "").trim();
    const number = String(entry?.number ?? "").trim();
    const line = index + 1;

    let key;
    try { key = keyFor(number); } catch { result.failed.push({ line, number, reason: "Not a valid phone number." }); continue; }
    // Duplicates inside the file itself, before the database is asked.
    if (seen.has(key)) { result.skipped += 1; continue; }
    seen.add(key);

    if (existing + result.added >= MAX_EXCLUDED) {
      result.failed.push({ line, number, reason: `The list is full at ${MAX_EXCLUDED.toLocaleString()} numbers.` });
      continue;
    }

    const id = `EXC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await prisma.$executeRawUnsafe(
        "INSERT INTO `sales_crm_excluded_number` (`id`, `name`, `number`, `match_key`, `created_by`) VALUES (?, ?, ?, ?, ?)",
        id, name || null, number, key, createdBy,
      );
      result.added += 1;
    } catch (error) {
      if (isDuplicate(error)) { result.skipped += 1; continue; }
      result.failed.push({ line, number, reason: "Could not be saved." });
    }
  }

  if (result.added) forgetExcludedNumbers();
  return result;
}

// MySQL's duplicate-key error, however Prisma happens to be wrapping it.
function isDuplicate(error) {
  const message = String(error?.message || "");
  return error?.code === "P2002" || message.includes("Duplicate entry") || message.includes("ER_DUP_ENTRY");
}

module.exports = {
  MAX_EXCLUDED,
  ExcludedNumberError,
  ensureExcludedNumberTable,
  excludedNumberKeys,
  forgetExcludedNumbers,
  listExcludedNumbers,
  countExcludedNumbers,
  addExcludedNumber,
  updateExcludedNumber,
  removeExcludedNumbers,
  importExcludedNumbers,
};
