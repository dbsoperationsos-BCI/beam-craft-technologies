const test = require("node:test");
const assert = require("node:assert/strict");
const { buildInviteMessage, assertSubmittable } = require("../src/modules/subscribe/client-onboarding/controller");

const NOW = new Date("2026-11-04T10:00:00Z");
const FUTURE = new Date("2026-11-11T18:29:59Z"); // 11 Nov 2026, 23:59 IST

test("the invite message is the employee wording, addressed to the client by name", () => {
  const message = buildInviteMessage({ link: "http://localhost:3101/client-onboarding/apply/QCUZMRKP", expiresAt: FUTURE, contactName: "Kamalnath" });
  assert.match(buildInviteMessage({ link: "x", expiresAt: FUTURE }), /^Hi there,/);
  assert.equal(message, [
    "Hi Kamalnath,",
    "",
    "Welcome to Beam Craft. Please complete your company's onboarding details here:",
    "http://localhost:3101/client-onboarding/apply/QCUZMRKP",
    "",
    "The link is open until 11 Nov 2026, 23:59.",
    "",
    "Please keep this link to yourself.",
  ].join("\n"));
});

test("submit refuses an invite already Submitted", () => {
  assert.throws(() => assertSubmittable({ verifiedAt: NOW, submittedAt: NOW, expiresAt: FUTURE }, NOW), (error) => error.status === 409);
});

test("submit refuses an expired or cancelled invite; an open one needs no verification", () => {
  assert.throws(() => assertSubmittable({ expiresAt: new Date(NOW.getTime() - 1000) }, NOW), (error) => error.status === 410);
  assert.throws(() => assertSubmittable({ cancelledAt: NOW, expiresAt: FUTURE }, NOW), (error) => error.status === 410);
  assert.doesNotThrow(() => assertSubmittable({ verifiedAt: null, expiresAt: FUTURE }, NOW));
});

const { claimAndCreateClient, assertUploadsCanBeStored } = require("../src/modules/subscribe/client-onboarding/controller");

// A stand-in transaction: the invite row as the database holds it, and what was written.
function fakeTx(row) {
  const writes = { created: null, updated: null };
  return {
    writes,
    clientOnboardingInvite: {
      updateMany: async ({ where }) => {
        const free = row.id === where.id && !row.submittedAt && !row.cancelledAt && row.expiresAt >= where.expiresAt.gte;
        if (free) row.submittedAt = new Date();
        return { count: free ? 1 : 0 };
      },
      update: async ({ data }) => { writes.updated = data; return { ...row, ...data }; },
      findUnique: async () => row,
    },
    subscriptionClient: { create: async ({ data }) => { writes.created = data; return { id: "c1", ...data }; } },
  };
}

test("a submit claims the invite before creating the company", async () => {
  const tx = fakeTx({ id: "i1", expiresAt: FUTURE });
  const client = await claimAndCreateClient(tx, { id: "i1", product: "ACCOUNT_MANAGER", contactEmail: "a@x.in" }, { companyName: "Velava" }, { logoUrl: "l", faviconUrl: "f" });
  assert.equal(client.companyName, "Velava");
  assert.equal(tx.writes.updated.clientId, "c1");
});

test("a submit that loses the race is a 409; one that lands on a cancelled or just-expired link is a 410 - and neither creates anything", async () => {
  const cases = [
    [{ id: "i1", expiresAt: FUTURE, submittedAt: NOW }, 409],
    [{ id: "i1", expiresAt: FUTURE, cancelledAt: NOW }, 410],
    [{ id: "i1", expiresAt: new Date(Date.now() - 1000) }, 410],
  ];
  for (const [row, status] of cases) {
    const tx = fakeTx(row);
    await assert.rejects(claimAndCreateClient(tx, { id: "i1", product: "ACCOUNT_MANAGER", contactEmail: "a@x.in" }, { companyName: "Velava" }, { logoUrl: "l", faviconUrl: "f" }), (error) => error.status === status, JSON.stringify(row));
    assert.equal(tx.writes.created, null);
  }
});

test("without file storage configured, a submit is refused with a clear message rather than a 500", () => {
  assert.throws(() => assertUploadsCanBeStored(false), (error) => error.status === 503 && /storage/i.test(error.message));
  assert.doesNotThrow(() => assertUploadsCanBeStored(true));
});

const { resolveSubmittedImage } = require("../src/modules/subscribe/client-onboarding/controller");

test("a submitted image is either a new upload or exactly the one the team already attached", () => {
  const RULE = { types: ["image/png"], maxBytes: 1024, label: "Logo must be a PNG file" };
  const kept = "https://cdn.example/beamcraft/client-onboarding/logo/a.png";
  assert.deepEqual(resolveSubmittedImage(kept, kept, RULE), { keep: kept });
  assert.deepEqual(resolveSubmittedImage(`data:image/png;base64,${Buffer.alloc(10).toString("base64")}`, kept, RULE), { upload: true });
  assert.throws(() => resolveSubmittedImage("https://elsewhere.example/x.png", kept, RULE), (error) => error.status === 400);
});

const { deleteInviteAndClient } = require("../src/modules/subscribe/client-onboarding/controller");

test("deleting a row removes its company first, then its invite", async () => {
  const calls = [];
  const tx = {
    clientOnboardingInvite: { findUnique: async () => ({ id: "i1" }), delete: async ({ where }) => calls.push(["invite", where.id]) },
    subscriptionClient: { deleteMany: async ({ where }) => calls.push(["client", where.inviteId]) },
  };
  await deleteInviteAndClient(tx, "i1");
  assert.deepEqual(calls, [["client", "i1"], ["invite", "i1"]]);
  tx.clientOnboardingInvite.findUnique = async () => null;
  await assert.rejects(deleteInviteAndClient(tx, "nope"), (error) => error.status === 404);
});

const { productFromEdit } = require("../src/modules/subscribe/client-onboarding/controller");

test("Edit places a client under a product, clears it, or leaves it alone", () => {
  assert.equal(productFromEdit("ACCOUNT_MANAGER"), "ACCOUNT_MANAGER");
  assert.equal(productFromEdit("MEDIA_STUDIO_OPERATIONS"), "MEDIA_STUDIO_OPERATIONS");
  assert.equal(productFromEdit(""), null);
  assert.equal(productFromEdit(undefined), undefined);
  assert.throws(() => productFromEdit("HRM"), (error) => error.status === 400);
});
