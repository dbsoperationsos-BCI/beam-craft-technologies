/**
 * An in-memory stand-in for the Prisma calls Photo Selling's payment, order and search code makes:
 * enough of `where` (equality, in, notIn, not, lt, lte, gt, gte, nested relation `some`) to run the
 * real services against plain rows, so the tests exercise the code that ships rather than a copy.
 */
const { randomUUID } = require("crypto");

function matchValue(value, condition) {
  // As in SQL, a column a row never set is NULL.
  if (condition === null) return value === null || value === undefined;
  if (typeof condition !== "object" || condition instanceof Date) return value === condition || (value instanceof Date && condition instanceof Date && value.getTime() === condition.getTime());
  if ("in" in condition && !condition.in.includes(value)) return false;
  if ("notIn" in condition && condition.notIn.includes(value)) return false;
  if ("not" in condition && (condition.not !== null && typeof condition.not === "object" ? matchValue(value, condition.not) : value === condition.not)) return false;
  if ("lt" in condition && !(value < condition.lt)) return false;
  if ("lte" in condition && !(value <= condition.lte)) return false;
  if ("gt" in condition && !(value > condition.gt)) return false;
  if ("gte" in condition && !(value >= condition.gte)) return false;
  if ("equals" in condition && value !== condition.equals) return false;
  return true;
}

// The schema's column defaults, for the rows a service creates without naming them.
const DEFAULTS = {
  photoSaleGallery: { status: "DRAFT", archivedAt: null, deletedAt: null, expiresAt: null, coverPhotoId: null, watermarkSnapshot: null, taxRateBps: 0, pricesIncludeTax: true, matchStrictness: "STANDARD", visitCount: 0, pricePaise: null, qrTemplateId: null, qrText: null, clientName: null, clientPhone: null, selfieSearchEnabled: true, whatsappNotify: false },
  photoSaleGuest: { whatsappOptInAt: null, whatsappOptOutAt: null, faceEngine: null, faceDimension: null, faceVector: null, faceAt: null, selfieCount: 0 },
  photoSaleGuestSelfie: { thumbnailKey: null, searchId: null },
  photoSaleGuestMatch: { notificationId: null },
  photoSaleNotification: { matchCount: 0, attempts: 0, providerMessageId: null, errorCode: null, errorMessage: null, sentAt: null },
  photoSaleStorageCleanup: { attempts: 0, lastError: null },
  photoSalePhoto: { available: true, removedAt: null, pricePaise: null, originalKey: null, faceStatus: "NONE", faceCount: 0 },
  photoSalePayment: { status: "CREATED" },
  photoSaleOrder: { status: "PENDING" },
};

function createFakeDb(seed = {}, relations = {}) {
  const tables = {};
  const names = ["photoSaleGallery", "photoSalePhoto", "photoSaleFace", "photoSalePackage", "photoSaleOrder", "photoSaleOrderItem", "photoSalePayment", "photoSalePaymentEvent", "photoSaleDownload", "photoSaleSelfieSearch", "photoSaleWatermark", "photoSaleSetting", "photoSaleStorageCleanup", "aiWatermarkPreset", "photoSaleGuest", "photoSaleGuestMatch", "photoSaleNotification", "photoSaleGuestSelfie"];
  for (const name of names) tables[name] = (seed[name] || []).map((row) => ({ ...row }));

  // A compound unique key - `{ galleryId_contentHash: { galleryId, contentHash } }` - is its fields.
  const unfold = (where) => Object.fromEntries(Object.entries(where || {}).flatMap(([key, value]) => (key.includes("_") && value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) ? Object.entries(value) : [[key, value]])));
  const matches = (table, row, rawWhere = {}) => Object.entries(unfold(rawWhere)).every(([key, condition]) => {
    if (key === "OR") return condition.some((part) => matches(table, row, part));
    if (key === "AND") return condition.every((part) => matches(table, row, part));
    const relation = relations[table]?.[key];
    if (relation) {
      const related = relation(row, tables);
      if (Array.isArray(related)) {
        if (condition.some) return related.some((item) => matches(relation.table, item, condition.some));
        if (condition.none) return !related.some((item) => matches(relation.table, item, condition.none));
        return true;
      }
      return related ? matches(relation.table, related, condition) : condition === null;
    }
    return matchValue(row[key], condition);
  });

  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value) row[key] = (row[key] || 0) + value.increment;
      else if (value && typeof value === "object" && "decrement" in value) row[key] = (row[key] || 0) - value.decrement;
      else if (key === "items" && value?.create) continue;
      else row[key] = value;
    }
    row.updatedAt = new Date();
    return row;
  };

  const withIncludes = (name, row, include) => {
    if (!row || !include) return row;
    const out = { ...row };
    for (const key of Object.keys(include)) {
      if (key === "_count") { out._count = Object.fromEntries(Object.keys(include._count?.select || {}).map((field) => [field, (relations[name]?.[field]?.(row, tables) || []).length])); continue; }
      const relation = relations[name]?.[key]; if (relation) out[key] = relation(row, tables);
    }
    return out;
  };

  const model = (name) => ({
    async findUnique({ where, include }) { return withIncludes(name, tables[name].find((row) => matches(name, row, where)) || null, include); },
    async findFirst({ where = {}, orderBy, include, select } = {}) {
      let rows = tables[name].filter((row) => matches(name, row, where));
      if (orderBy) { const [[field, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy); rows = rows.sort((a, b) => (a[field] > b[field] ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
      return withIncludes(name, rows[0] || null, include || select);
    },
    async findMany({ where = {}, orderBy, skip = 0, take, include, select } = {}) {
      let rows = tables[name].filter((row) => matches(name, row, where));
      if (orderBy) { const [[field, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy); rows = rows.sort((a, b) => (a[field] > b[field] ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
      rows = rows.slice(skip);
      return (take ? rows.slice(0, take) : rows).map((row) => withIncludes(name, row, include || select));
    },
    async aggregate({ where = {}, _max = {} } = {}) {
      const rows = tables[name].filter((row) => matches(name, row, where));
      return { _max: Object.fromEntries(Object.keys(_max).map((field) => [field, rows.length ? Math.max(...rows.map((row) => row[field] ?? -Infinity)) : null])) };
    },
    async groupBy({ by, where = {}, _count, _sum } = {}) {
      const groups = new Map();
      for (const row of tables[name].filter((item) => matches(name, item, where))) {
        const key = by.map((field) => row[field]).join("|");
        if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(by.map((field) => [field, row[field]])), rows: [] });
        groups.get(key).rows.push(row);
      }
      return [...groups.values()].map(({ rows, ...keys }) => ({
        ...keys,
        ...(_count ? { _count: { _all: rows.length } } : {}),
        ...(_sum ? { _sum: Object.fromEntries(Object.keys(_sum).map((field) => [field, rows.reduce((total, row) => total + (row[field] || 0), 0)])) } : {}),
      }));
    },
    async count({ where = {} } = {}) { return tables[name].filter((row) => matches(name, row, where)).length; },
    async create({ data }) {
      if (name === "photoSalePaymentEvent" && tables[name].some((row) => row.dedupeKey === data.dedupeKey)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      if (name === "photoSaleGuest" && tables[name].some((row) => row.galleryId === data.galleryId && row.sessionHash === data.sessionHash)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      if (name === "photoSalePhoto" && tables[name].some((row) => row.galleryId === data.galleryId && row.contentHash === data.contentHash)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      if (name === "photoSaleDownload" && data.ticketHash && tables[name].some((row) => row.ticketHash === data.ticketHash)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      if (name === "photoSalePayment" && tables[name].some((row) => row.providerOrderId === data.providerOrderId || (row.orderId === data.orderId && row.attempt === data.attempt))) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      const row = { id: randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[name] || {}), ...data };
      delete row.items;
      tables[name].push(row);
      if (data.items?.create) for (const item of data.items.create) tables.photoSaleOrderItem.push({ id: randomUUID(), orderId: row.id, fulfilment: "PENDING_PAYMENT", downloadCount: 0, createdAt: new Date(), ...item });
      return row;
    },
    async createMany({ data, skipDuplicates = false }) {
      let count = 0;
      for (const item of data) {
        if (name === "photoSaleStorageCleanup" && tables[name].some((row) => row.keyHash === item.keyHash)) { if (skipDuplicates) continue; throw Object.assign(new Error("Unique constraint"), { code: "P2002" }); }
        if (name === "photoSaleGuestMatch" && tables[name].some((row) => row.guestId === item.guestId && row.photoId === item.photoId)) { if (skipDuplicates) continue; throw Object.assign(new Error("Unique constraint"), { code: "P2002" }); }
        tables[name].push({ id: randomUUID(), createdAt: new Date(), nextAttemptAt: new Date(0), ...(DEFAULTS[name] || {}), ...item });
        count += 1;
      }
      return { count };
    },
    async upsert({ where, create, update }) {
      const row = tables[name].find((item) => matches(name, item, where));
      if (row) return apply(row, update);
      const created = { createdAt: new Date(), updatedAt: new Date(), ...create };
      tables[name].push(created);
      return created;
    },
    async update({ where, data }) { const row = tables[name].find((item) => matches(name, item, where)); if (!row) throw Object.assign(new Error("Not found"), { code: "P2025" }); return apply(row, data); },
    async updateMany({ where = {}, data }) { const rows = tables[name].filter((row) => matches(name, row, where)); rows.forEach((row) => apply(row, data)); return { count: rows.length }; },
    async delete({ where }) {
      const index = tables[name].findIndex((row) => matches(name, row, where));
      if (index < 0) throw Object.assign(new Error("Not found"), { code: "P2025" });
      // photo_sale_order_item.photo_id is ON DELETE RESTRICT.
      if (name === "photoSalePhoto" && tables.photoSaleOrderItem.some((item) => item.photoId === tables[name][index].id)) throw Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
      return tables[name].splice(index, 1)[0];
    },
    async deleteMany({ where = {} } = {}) { const before = tables[name].length; tables[name] = tables[name].filter((row) => !matches(name, row, where)); return { count: before - tables[name].length }; },
  });

  const db = Object.fromEntries(names.map((name) => [name, model(name)]));
  db.$transaction = async (work) => (typeof work === "function" ? work(db) : Promise.all(work));
  db.tables = tables;
  return db;
}

/**
 * Loads `relative` from src with these modules replaced, the way the other route tests do. Photo
 * Selling's own modules that hold a database or storage handle are loaded afresh too, so none keeps
 * the stand-in an earlier test gave it. The AI Feature's face engine is always a stand-in (answering
 * ready unless a test gives its own), so no test starts the real Python engine.
 */
const FRESH = ["modules/photo-selling/shared/cleanup.js", "modules/photo-selling/settings/service.js"];
const FACE_ENGINE = "modules/ai-feature/face-engine/engine.js";
function fakeFaceEngine(status = "ready", { modelsComplete = true } = {}) {
  const engine = { status, started: 0, health: () => ({ status: engine.status, models: { complete: modelsComplete } }), isReady: async () => { engine.started += 1; return engine.status === "ready"; } };
  return engine;
}
function loadWith(path, src, stubs, relative) {
  for (const file of FRESH) if (!stubs[file]) delete require.cache[require.resolve(path.join(src, file))];
  if (!stubs[FACE_ENGINE]) stubs = { ...stubs, [FACE_ENGINE]: fakeFaceEngine() };
  for (const [file, exports] of Object.entries(stubs)) {
    const resolved = require.resolve(path.join(src, file));
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }
  const target = require.resolve(path.join(src, relative));
  delete require.cache[target];
  return require(target);
}

/**
 * A stand-in for `config/r2.js`: buckets as maps of keys, and the two commands cleanup sends -
 * DeleteObjects and ListObjectsV2 (paged at `pageSize`). `failNext` makes the next N sends throw, the
 * way an unreachable R2 does. Every key deleted is recorded with its bucket.
 */
function createFakeR2({ publicBucket = "public-bucket", pageSize = 1000 } = {}) {
  const buckets = new Map();
  const deleted = [];
  let failNext = 0;
  const bucketOf = (name) => { if (!buckets.has(name)) buckets.set(name, new Set()); return buckets.get(name); };
  const client = {
    async send(command) {
      if (failNext > 0) { failNext -= 1; throw new Error("R2 unreachable"); }
      const input = command.input;
      const name = command.constructor.name;
      if (name === "DeleteObjectsCommand") {
        for (const { Key } of input.Delete.Objects) { bucketOf(input.Bucket).delete(Key); deleted.push({ bucket: input.Bucket, key: Key }); }
        return { Errors: [] };
      }
      if (name === "ListObjectsV2Command") {
        const keys = [...bucketOf(input.Bucket)].filter((key) => key.startsWith(input.Prefix)).sort();
        const start = Number(input.ContinuationToken || 0);
        const page = keys.slice(start, start + pageSize);
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: start + pageSize < keys.length, NextContinuationToken: String(start + pageSize) };
      }
      throw new Error(`Unexpected R2 command ${name}`);
    },
  };
  return {
    module: { r2Client: () => client, bucket: publicBucket, privateBucket: publicBucket, privateBucketIsPublic: true, publicBaseUrl: "https://r2.test", isConfigured: true, missingKeys: () => [] },
    put: (bucketName, key) => bucketOf(bucketName).add(key),
    has: (bucketName, key) => bucketOf(bucketName).has(key),
    keys: (bucketName) => [...bucketOf(bucketName)],
    deleted,
    failNext: (count = 1) => { failNext = count; },
  };
}

module.exports = { createFakeDb, createFakeR2, fakeFaceEngine, loadWith };
