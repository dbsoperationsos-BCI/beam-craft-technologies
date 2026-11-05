const test = require("node:test");
const assert = require("node:assert/strict");
const { SELFIE_LIMIT, reserveSelfie, releaseSelfie } = require("../src/modules/ai-feature/public/service");

// The conditional UPDATE the database runs, applied to one in-memory row.
function fakeDb(selfieUploads = 0, kept = selfieUploads) {
  const row = { id: "g1", selfieUploads };
  const matches = (where) => where.id === row.id
    && (typeof where.selfieUploads !== "number" || row.selfieUploads === where.selfieUploads)
    && (where.selfieUploads?.lt === undefined || row.selfieUploads < where.selfieUploads.lt)
    && (where.selfieUploads?.gt === undefined || row.selfieUploads > where.selfieUploads.gt);
  return {
    row,
    aiEventGuest: {
      async findUnique() { return { selfieUploads: row.selfieUploads }; },
      async updateMany({ where, data }) {
        if (!matches(where)) return { count: 0 };
        if (typeof data.selfieUploads === "number") row.selfieUploads = data.selfieUploads;
        else {
          row.selfieUploads += data.selfieUploads.increment || 0;
          row.selfieUploads -= data.selfieUploads.decrement || 0;
        }
        return { count: 1 };
      },
    },
    // The guest's selfies actually kept.
    aiEventGuestFace: { async count() { return kept; } },
  };
}

test("a guest may have ten active selfies for an event and no more", async () => {
  assert.equal(SELFIE_LIMIT, 10);
  const db = fakeDb(0, 10);
  for (let i = 0; i < SELFIE_LIMIT; i += 1) await reserveSelfie(db, "g1");
  assert.equal(db.row.selfieUploads, 10);
  await assert.rejects(reserveSelfie(db, "g1"), (error) => error.status === 429 && /You have 10 selfies\. Remove one to add another\./.test(error.message));
  assert.equal(db.row.selfieUploads, 10, "a refused request takes nothing");
});

test("the limit is checked inside the update itself, so requests sent at once cannot pass it together", async () => {
  const db = fakeDb(8);
  const seen = [];
  const update = db.aiEventGuest.updateMany;
  db.aiEventGuest.updateMany = (args) => { seen.push(args.where); return update(args); };
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => reserveSelfie(db, "g1")));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(db.row.selfieUploads, 10);
  assert.ok(seen.every((where) => where.selfieUploads?.lt === SELFIE_LIMIT), "never a read followed by a separate write");
});

test("a selfie that was never stored gives its slot back", async () => {
  const db = fakeDb(10);
  await releaseSelfie(db, "g1");
  assert.equal(db.row.selfieUploads, 9);
  await reserveSelfie(db, "g1");
  assert.equal(db.row.selfieUploads, 10);
  const empty = fakeDb(0);
  await releaseSelfie(empty, "g1");
  assert.equal(empty.row.selfieUploads, 0, "the count never goes below zero");
});

test("a count from before selfies could be removed is brought down to the one selfie kept, and a slot opens", async () => {
  const db = fakeDb(10, 1);
  await reserveSelfie(db, "g1");
  assert.equal(db.row.selfieUploads, 2, "one kept plus the one being added");
  const full = fakeDb(10, 10);
  await assert.rejects(reserveSelfie(full, "g1"), (error) => error.status === 429, "ten kept is ten");
});
