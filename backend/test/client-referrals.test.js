const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { choicesOf, createReferral, groupByFriend, listReferrals, namedShoots, shootChoices, stageOf } = require("../src/modules/client/portal/referrals");

/*
 * A client's referral from their app. Only what is answered before anything is written: a referral
 * that passes these becomes a CRM lead, and creating one also writes to the CRM's Google Sheet and
 * webhook where those are set up - which a test must never do. So no lead is created here.
 */
after(async () => { await prisma.$disconnect(); });

const project = { id: "p", eventId: "DBS-BK-TEST", sourceBranch: "Erode TN", crmName: "" };
const client = { name: "Test Client", mobile: "9000012345" };

test("a referral needs a name, a 10-digit number that is not the client's own, and what it is for", async () => {
  assert.equal((await createReferral({ project, client, input: { name: "", phone: "9876543210", kind: "wedding" } })).status, 400);
  assert.equal((await createReferral({ project, client, input: { name: "Ravi", phone: "98765", kind: "wedding" } })).status, 400);
  assert.equal((await createReferral({ project, client, input: { name: "Ravi", phone: "9876543210", kind: "party" } })).status, 400);
  assert.match((await createReferral({ project, client, input: { name: "Ravi", phone: "+91 90000 12345", kind: "baby" } })).error, /your own number/);
  assert.equal((await createReferral({ project: { ...project, sourceBranch: "" }, client, input: { name: "Ravi", phone: "9876543210", kind: "corporate" } })).status, 409);
});

test("where a referral stands reads in the client's words", () => {
  assert.equal(stageOf(null), "new");
  assert.equal(stageOf("Yet to connect"), "new");
  assert.equal(stageOf("Followup"), "talking");
  assert.equal(stageOf("Interested"), "talking");
  assert.equal(stageOf("Converted & Followup"), "booked");
  assert.equal(stageOf("Rejected"), "closed");
});

test("a client with no number has no referrals, and the list is only theirs", async () => {
  assert.deepEqual(await listReferrals(""), []);
  const rows = await listReferrals("0000000000");
  assert.ok(Array.isArray(rows));
  assert.ok(rows.every((row) => ["new", "talking", "booked", "closed"].includes(row.stage)));
});

test("a referral may name the brand's own shoots - each once, in order, any other dropped", async () => {
  const offered = new Set(["Engagement", "Reception", "Pre Wedding"]);
  assert.deepEqual(namedShoots(["Reception", " Engagement ", "Reception", "Made up", 7, null], offered), ["Reception", "Engagement"]);
  assert.deepEqual(namedShoots("Reception", offered), [], "only a list is read");
  assert.deepEqual(namedShoots(Array.from({ length: 20 }, () => "Engagement"), offered), ["Engagement"]);
  // Each kind offers its brand's list (Settings -> Fields -> Shoot Types), as a list.
  const choices = await shootChoices();
  assert.deepEqual(Object.keys(choices).sort(), ["baby", "corporate", "wedding"]);
  for (const list of Object.values(choices)) assert.ok(Array.isArray(list));
});

test("a referral may be for several kinds, each with its own shoots - or one kind, as an earlier app sends it", async () => {
  const shoots = await shootChoices();
  const wedding = shoots.wedding[0];
  const baby = shoots.baby[0];
  const several = await choicesOf({ choices: [
    { kind: "wedding", shoots: [wedding, baby].filter(Boolean) },
    { kind: "baby", shoots: [baby].filter(Boolean) },
    { kind: "wedding", shoots: [] },
    { kind: "party", shoots: [] },
  ] });
  assert.deepEqual(several.map((choice) => choice.key), ["wedding", "baby"], "each kind once, unknown kinds dropped");
  assert.deepEqual(several[0].shoots, wedding ? [wedding] : [], "a kind keeps only its own brand's shoots");
  assert.deepEqual(several[1].shoots, baby ? [baby] : []);
  const single = await choicesOf({ kind: "corporate", shoots: [] });
  assert.deepEqual(single.map((choice) => choice.key), ["corporate"]);
  assert.deepEqual(await choicesOf({ choices: [] }), []);
  assert.equal((await createReferral({ project, client, input: { name: "Ravi", phone: "9876543210", choices: [{ kind: "party" }] } })).status, 400, "no known kind is refused");
});

test("the client sees a friend once, however many kinds they were referred for", () => {
  const friends = groupByFriend([
    { id: "L3", name: "Ravi", phone: "9876543210", forKind: "Corporate", kind: "Industrial", stage: "new", referredAt: "2026-10-30T10:02:00.000Z", coins: null },
    { id: "L2", name: "Ravi", phone: "+91 98765 43210", forKind: "Baby / Kids", kind: "Birthday Shoot", stage: "booked", referredAt: "2026-10-30T10:01:00.000Z", coins: 20 },
    { id: "L1", name: "Ravi", phone: "9876543210", forKind: "Wedding", kind: "Bride Making", stage: "talking", referredAt: "2026-10-30T10:00:00.000Z", coins: null },
    { id: "L0", name: "Appa", phone: "9443348610", forKind: "Wedding", kind: "Wedding", stage: "closed", referredAt: "2026-10-28T10:00:00.000Z", coins: null },
  ]);
  assert.equal(friends.length, 2, "one entry a friend, told apart by number");
  const [ravi, appa] = friends;
  assert.deepEqual(ravi.parts.map((part) => part.id), ["L1", "L2", "L3"], "each kind, oldest first");
  assert.equal(ravi.stage, "booked", "as far as the furthest kind");
  assert.equal(ravi.coins, 20);
  assert.equal(ravi.referredAt, "2026-10-30T10:00:00.000Z");
  assert.equal(ravi.kind, "Wedding, Baby / Kids, Corporate");
  assert.equal(appa.stage, "closed");
  assert.equal(appa.coins, null);
});
