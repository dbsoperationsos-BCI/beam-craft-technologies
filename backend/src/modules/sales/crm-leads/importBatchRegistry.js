const prisma = require("../../../config/db");

// Tracks CSV import batches while they are running. A batch is one import started from the
// dialog; every id range it reserves is noted here so a cancel can delete exactly the rows
// that run created and leave every other lead untouched.
//
// The registry lives in the process. The backend runs as a single PM2 instance, so the
// cancel request always reaches the same process that is doing the import. If the API is
// ever scaled to several instances this has to move into the database.

/*
 * A range is now `{ prefix, from, to }` rather than a bare pair of numbers.
 *
 * Enquiry ids used to share one prefix and one run of numbers, so a batch's rows were always a
 * single numeric span. They are now counted per vertical and per branch - `DBS-EID-QQ-ERD-000001`,
 * `DBS-EID-QQ-CBE-000001` - and one CSV file holds rows for several branches, so a batch reserves a
 * span per branch and each has to remember which prefix it belongs to. Deleting by number alone
 * would take Coimbatore's rows out with Erode's.
 */
// A batch that is neither finished nor cancelled is forgotten after this long, so an
// abandoned import cannot pin its id ranges in memory for the life of the process.
const BATCH_TTL_MS = 30 * 60 * 1000;

const batches = new Map();

function sweep() {
  const cutoff = Date.now() - BATCH_TTL_MS;
  for (const [id, entry] of batches) {
    if (entry.touchedAt < cutoff) batches.delete(id);
  }
}

function newEntry() {
  return { ranges: [], cancelled: false, touchedAt: Date.now() };
}

// Registers a chunk against its batch. `isNew` tells the importer this is the first chunk
// of the run, which is the only point where the id sequence needs re-syncing.
function touchBatch(batchId) {
  sweep();
  const existing = batches.get(batchId);
  if (existing) {
    existing.touchedAt = Date.now();
    return { entry: existing, isNew: false };
  }
  const entry = newEntry();
  batches.set(batchId, entry);
  return { entry, isNew: true };
}

function recordRange(batchId, prefix, from, to) {
  const entry = batches.get(batchId);
  if (entry) entry.ranges.push({ prefix, from, to });
}

function isCancelled(batchId) {
  return Boolean(batches.get(batchId)?.cancelled);
}

/*
 * Touching ranges collapse into one - within a prefix.
 *
 * Chunks reserve consecutive blocks, so one branch's share of an import is usually a single range
 * once merged. Merging across prefixes would be meaningless: Erode's 1-50 and Coimbatore's 51-60
 * are not one span of anything.
 */
function mergeRanges(ranges) {
  const byPrefix = new Map();
  for (const range of ranges) {
    if (!byPrefix.has(range.prefix)) byPrefix.set(range.prefix, []);
    byPrefix.get(range.prefix).push(range);
  }
  const merged = [];
  for (const [prefix, group] of byPrefix) {
    let current = null;
    for (const range of group.sort((left, right) => left.from - right.from)) {
      if (current && range.from <= current.to + 1) current.to = Math.max(current.to, range.to);
      else merged.push((current = { prefix, from: range.from, to: range.to }));
    }
  }
  return merged;
}

// Ids come from a reserved range no other batch can hold, so deleting the whole range is
// safe even where a row was never written for a given id.
//
// Matching on the range rather than listing every primary key turns a 10,000-lead
// rollback from ten statements carrying 10,000 bound values into one, which measures
// about twice as fast.
async function discardRanges(ranges) {
  let deleted = 0;
  for (const { prefix, from, to } of mergeRanges(ranges)) {
    const removed = await prisma.$executeRawUnsafe(
      "DELETE FROM `sales_crm_lead` WHERE `enquiry_id` LIKE ? AND CAST(SUBSTRING(`enquiry_id`, ?) AS UNSIGNED) BETWEEN ? AND ?",
      `${prefix}%`,
      // Position of the numeric part, counting from 1 as SQL does.
      prefix.length + 1,
      from,
      to,
    );
    deleted += Number(removed || 0);
  }
  return deleted;
}

// Cancels a batch and removes everything it has written so far. A chunk that is already
// mid-insert will not be covered here, which is why the importer re-checks `isCancelled`
// after its own insert and discards its own range.
//
// A batch that has not sent a chunk yet still gets a cancelled entry, so a request that
// arrives after the cancel is rejected instead of starting a fresh import.
async function cancelBatch(batchId) {
  sweep();
  let entry = batches.get(batchId);
  if (!entry) {
    entry = newEntry();
    batches.set(batchId, entry);
  }
  entry.cancelled = true;
  entry.touchedAt = Date.now();
  const ranges = entry.ranges.splice(0);
  return { deleted: await discardRanges(ranges) };
}

module.exports = {
  cancelBatch,
  discardRanges,
  isCancelled,
  recordRange,
  touchBatch,
};
