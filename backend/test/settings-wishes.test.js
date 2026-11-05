const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const prisma = require("../src/config/db");
const controller = require("../src/modules/settings/wishes/controller");

/*
 * Settings → Wishes: ten Birthday Wishes and ten (wedding) Anniversary Wishes, kept as message templates
 * and reworded behind SETTINGS / Wishes.
 */

const SQL = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012200000_wishes", "migration.sql"), "utf8");

function call(handler, { params = {}, body = {}, user = { id: 7 } } = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ status: this.statusCode, body: payload }); return this; } };
    handler({ params, body, user }, res);
  });
}

test("the migration writes ten of each, never over a wish the studio has reworded, and grants SUPER_ADMIN alone", () => {
  for (let index = 1; index <= 10; index += 1) {
    const two = String(index).padStart(2, "0");
    assert.match(SQL, new RegExp(`\\('BIRTHDAY_WISH_${two}', 'Birthday Wish ${index}', '[^']*\\{employee name\\}`));
    assert.match(SQL, new RegExp(`\\('WEDDING_ANNIVERSARY_WISH_${two}', 'Wedding Anniversary Wish ${index}', '[^']*\\{employee name\\}`));
  }
  assert.match(SQL, /INSERT IGNORE INTO `message_template`/);
  assert.match(SQL, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.match(SQL, /'SETTINGS', 'Wishes', 'SETTINGS_WISHES'/);
});

test("both lists come back in order, and only a wish key can be reworded", async () => {
  const original = { findMany: prisma.messageTemplate.findMany, upsert: prisma.messageTemplate.upsert };
  const originalSettings = prisma.hrmSettings.findUnique;
  prisma.hrmSettings.findUnique = async () => ({ wishesGroupName: "Studio Team", wishesSendAt: null, wishesLastAttemptAt: null, wishesLastError: null });
  const writes = [];
  prisma.messageTemplate.findMany = async () => [
    { key: "BIRTHDAY_WISH_01", name: "Birthday Wish 1", body: "Happy Birthday, {employee name}!" },
    { key: "BIRTHDAY_WISH_02", name: "Birthday Wish 2", body: "Many happy returns, {employee name}." },
    { key: "WEDDING_ANNIVERSARY_WISH_01", name: "Wedding Anniversary Wish 1", body: "Happy Anniversary, {employee name} and {spouse name}!" },
    { key: "BIRTHDAY_WISH_EXTRA", name: "Not a wish", body: "x" },
  ];
  prisma.messageTemplate.upsert = async ({ where, update, create }) => { writes.push({ where, update, create }); return { key: where.key, name: create.name, body: update.body }; };
  try {
    const listed = (await call(controller.listWishes)).body.data;
    assert.deepEqual(listed.birthday.map((wish) => wish.key), ["BIRTHDAY_WISH_01", "BIRTHDAY_WISH_02"]);
    assert.deepEqual(listed.weddingAnniversary[0].placeholders, ["employee name", "spouse name"]);
    // Where and when they go - the Wishes Scheduler's group and time.
    assert.deepEqual((await call(controller.listWishes)).body.delivery, { groupName: "Studio Team", sendAt: "10:00 am", lastAttemptAt: null, lastError: null });
    assert.equal((await call(controller.saveWish, { params: { key: "BIRTHDAY_WISH_03" }, body: { body: "  Cheers, {employee name}!  " } })).status, 200);
    assert.deepEqual([writes[0].update.body, writes[0].create.name, writes[0].update.updatedByUserId], ["Cheers, {employee name}!", "Birthday Wish 3", 7]);
    // Not a wish - the other message templates answer to their own permission - nor an empty one.
    assert.equal((await call(controller.saveWish, { params: { key: "CASH_RECEIVED" }, body: { body: "x" } })).status, 404);
    assert.equal((await call(controller.saveWish, { params: { key: "BIRTHDAY_WISH_11" }, body: { body: "x" } })).status, 404);
    assert.equal((await call(controller.saveWish, { params: { key: "BIRTHDAY_WISH_01" }, body: { body: "   " } })).status, 400);
    assert.equal(writes.length, 1);
  } finally {
    Object.assign(prisma.messageTemplate, original);
    prisma.hrmSettings.findUnique = originalSettings;
  }
});

test("it answers to SETTINGS / Wishes, mounted under /api/settings", () => {
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "wishes", "routes.js"), "utf8"), /router\.use\(protect\);[\s\S]*router\.use\(requireModule\("SETTINGS", "Wishes"\)\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8"), /app\.use\("\/api\/settings\/wishes", settingsWishRoutes\);/);
});
