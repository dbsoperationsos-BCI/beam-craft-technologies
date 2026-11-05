const test = require("node:test");
const assert = require("node:assert/strict");
const { MODULES_BY_PRODUCT, subscriptionSchema, generatePassword, subscriptionStatus, accountMessage } = require("../src/modules/subscribe/client-onboarding/subscription");

const valid = () => ({
  product: "ACCOUNT_MANAGER",
  subdomain: "velavaagencies",
  usersAllowed: 10,
  adminUsername: "velavaagencies",
  validFrom: "2026-11-01",
  validUntil: "2027-10-31",
  modules: ["hrm/employee-repository", "accounts/accounts-manager"],
});

test("both products offer DBS's full module list", () => {
  const screens = (product) => Object.entries(MODULES_BY_PRODUCT[product]).map(([key, module]) => `${key}: ${Object.keys(module.screens).join(", ")}`);
  assert.deepEqual(screens("MEDIA_STUDIO_OPERATIONS"), [
    "hrm: employee-repository, employee-attendance, tasks, interview, payroll",
    "sales-crm: leads-followups, reports-analytics, contacts, bookings-converted, quotations",
    "client-management: client-offers, client-chats, invitation-cards, client-requests",
    "project-management: projects, pre-production, production, shoot-board, crd-documents, client-gifts, feedback",
    "visual-curation: ai-feature, photo-selling, image-selection, album-proofing",
    "accounts: accounts-manager, payment-requests",
    "resource-management: assets, vendors, client-storage, recycling-bin",
  ]);
  assert.deepEqual(screens("ACCOUNT_MANAGER"), screens("MEDIA_STUDIO_OPERATIONS"));
});

test("a client can be given one screen of a module - HRM with only Interview", () => {
  assert.equal(subscriptionSchema.safeParse({ ...valid(), product: "MEDIA_STUDIO_OPERATIONS", modules: ["hrm/interview"] }).success, true);
  assert.equal(subscriptionSchema.safeParse({ ...valid(), product: "MEDIA_STUDIO_OPERATIONS", modules: ["hrm"] }).success, false);
  assert.equal(subscriptionSchema.safeParse({ ...valid(), product: "MEDIA_STUDIO_OPERATIONS", modules: ["hrm/constructor"] }).success, false);
});

test("a complete setup is accepted", () => {
  assert.equal(subscriptionSchema.safeParse(valid()).success, true);
  assert.equal(subscriptionSchema.parse({ ...valid(), subdomain: "  VelavaAgencies " }).subdomain, "velavaagencies");
});

test("each rule refuses what it should", () => {
  const bad = [
    { subdomain: "-velava" }, { subdomain: "ve" }, { subdomain: "velava_agencies" },
    { adminUsername: "ab" }, { adminUsername: "has space" },
    { usersAllowed: 0 }, { usersAllowed: 2.5 },
    { validUntil: "2026-10-31" },
    { modules: [] }, { modules: ["hrm/constructor"] }, { modules: ["user-management/users"] },
    { product: "HRM" },
  ];
  for (const change of bad) assert.equal(subscriptionSchema.safeParse({ ...valid(), ...change }).success, false, JSON.stringify(change));
});

test("a generated password is 12 unambiguous letters and digits", () => {
  for (let i = 0; i < 50; i += 1) assert.match(generatePassword(), /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{12}$/);
  assert.notEqual(generatePassword(), generatePassword());
});

test("status: active through the last day, expired after it, nothing before setup", () => {
  const client = { activatedAt: new Date("2026-11-01"), validUntil: new Date("2027-10-31T00:00:00Z") };
  assert.equal(subscriptionStatus(client, new Date("2027-10-31T17:00:00Z")), "Active"); // 22:30 IST on the last day
  assert.equal(subscriptionStatus(client, new Date("2027-10-31T19:00:00Z")), "Expired"); // 00:30 IST the next day
  assert.equal(subscriptionStatus({ activatedAt: null }, new Date()), null);
});

test("the account message is the spec's text", () => {
  assert.equal(accountMessage({ contactName: "Arun", subdomain: "velavaagencies", adminUsername: "velavaagencies", password: "Ab3dEf6hJk9m", validUntil: new Date("2027-10-31T00:00:00Z") }), [
    "Hi Arun,",
    "",
    "Your Beam Craft account is ready.",
    "Login: https://velavaagencies.beamcraft.tech",
    "Username: velavaagencies",
    "Password: Ab3dEf6hJk9m",
    "Valid until: 31 Oct 2027",
    "",
    "Please change the password after your first login and keep it to yourself.",
  ].join("\n"));
});

const { assertCanSetUp, passwordChange } = require("../src/modules/subscribe/client-onboarding/controller");

test("only a submitted client can be set up", () => {
  assert.throws(() => assertCanSetUp({ client: null }), (error) => error.status === 400);
  assert.throws(() => assertCanSetUp(null), (error) => error.status === 404);
  assert.doesNotThrow(() => assertCanSetUp({ client: { id: "c1" } }));
});

test("a password is made on the first save or a reset, and never otherwise", () => {
  assert.equal(passwordChange({ firstTime: true, resetPassword: false }), true);
  assert.equal(passwordChange({ firstTime: false, resetPassword: true }), true);
  assert.equal(passwordChange({ firstTime: false, resetPassword: false }), false);
  assert.equal(passwordChange({ firstTime: false }), false);
});

const { assertProductEditable } = require("../src/modules/subscribe/client-onboarding/controller");

test("once an account is set up, Edit cannot move it to another product (its modules would not match)", () => {
  const setUp = { product: "MEDIA_STUDIO_OPERATIONS", client: { activatedAt: new Date() } };
  assert.throws(() => assertProductEditable(setUp, "ACCOUNT_MANAGER"), (error) => error.status === 400 && /Edit subscription/.test(error.message));
  assert.throws(() => assertProductEditable(setUp, null), (error) => error.status === 400);
  assert.doesNotThrow(() => assertProductEditable(setUp, "MEDIA_STUDIO_OPERATIONS"));
  assert.doesNotThrow(() => assertProductEditable(setUp, undefined));
  assert.doesNotThrow(() => assertProductEditable({ product: null, client: { activatedAt: null } }, "ACCOUNT_MANAGER"));
});

const { liveFields, publishPending } = require("../src/modules/subscribe/client-onboarding/controller");

test("a saved subscription becomes the columns the client's site reads", () => {
  const fields = liveFields({ product: "ACCOUNT_MANAGER", subdomain: "velava", usersAllowed: 5, adminUsername: "velava", validFrom: "2026-11-01", validUntil: "2027-10-31", modules: ["accounts/accounts-manager"] });
  assert.equal(fields.validFrom.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(fields.validUntil.toISOString(), "2027-10-31T00:00:00.000Z");
  assert.deepEqual(fields.modules, ["accounts/accounts-manager"]);
  assert.equal("resetPassword" in fields, false);
});

test("Update site puts the pending change live as the next version and clears it", () => {
  const pending = { product: "ACCOUNT_MANAGER", subdomain: "velava", usersAllowed: 8, adminUsername: "velava", validFrom: "2026-11-01", validUntil: "2027-10-31", modules: ["accounts/accounts-manager", "resource-management/vendors"] };
  const { data, version } = publishPending({ liveVersion: 1, pendingChanges: pending });
  assert.equal(version, 2);
  assert.equal(data.liveVersion, 2);
  assert.equal(data.usersAllowed, 8);
  assert.equal(data.pendingChanges, require("@prisma/client").Prisma.DbNull);
  assert.throws(() => publishPending({ liveVersion: 1, pendingChanges: null }), (error) => error.status === 400);
});

const { assertCanResetPassword } = require("../src/modules/subscribe/client-onboarding/controller");

test("a password can be reset only on an account that is set up", () => {
  assert.throws(() => assertCanResetPassword(null), (error) => error.status === 404);
  assert.throws(() => assertCanResetPassword({ client: null }), (error) => error.status === 400);
  assert.throws(() => assertCanResetPassword({ client: { activatedAt: null } }), (error) => error.status === 400);
  assert.doesNotThrow(() => assertCanResetPassword({ client: { activatedAt: new Date(), adminUsername: "velava" } }));
});

const { assertSubdomainFree } = require("../src/modules/subscribe/client-onboarding/controller");

test("a subdomain is taken when another client is live on it or has it in a change waiting for Update site", async () => {
  let asked = null;
  const db = (hit) => ({ subscriptionClient: { findFirst: async ({ where }) => { asked = where; return hit; } } });
  await assert.doesNotReject(assertSubdomainFree("studio", "c1", db(null)));
  assert.deepEqual(asked, { NOT: { id: "c1" }, OR: [{ subdomain: "studio" }, { pendingChanges: { path: "$.subdomain", equals: "studio" } }] });
  await assert.rejects(assertSubdomainFree("studio", "c1", db({ id: "c2" })), (error) => error.status === 409 && /another client/.test(error.message));
});

const { conflictMessage, resolveSubmittedImage: resolveImage } = require("../src/modules/subscribe/client-onboarding/controller");

test("a clash says what clashed: the subdomain, or a save someone else just made", () => {
  assert.match(conflictMessage({ code: "P2002", meta: { target: "subscription_client_subdomain_key" } }), /subdomain is already used/);
  assert.match(conflictMessage({ code: "P2002", meta: { target: ["subdomain"] } }), /subdomain is already used/);
  assert.match(conflictMessage({ code: "P2002", meta: { target: "subscription_version_client_id_version_key" } }), /just saved.*reload/i);
});

test("an image the team has since replaced asks the client to reload or choose it again", () => {
  const RULE = { types: ["image/png"], maxBytes: 1024, label: "Logo must be a PNG file" };
  assert.throws(() => resolveImage("https://cdn.example/old.png", "https://cdn.example/new.png", RULE), (error) => error.status === 400 && /changed.*reload/i.test(error.message));
});

test("the full address typed as the subdomain is read as the subdomain", () => {
  for (const typed of ["velavaagenciess.beamcraft.tech", "https://VelavaAgenciess.beamcraft.tech/", " velavaagenciess.BEAMCRAFT.tech ", "velavaagenciess"]) {
    assert.equal(subscriptionSchema.parse({ ...valid(), subdomain: typed }).subdomain, "velavaagenciess", typed);
  }
  assert.equal(subscriptionSchema.safeParse({ ...valid(), subdomain: "velava.example.com" }).success, false);
});
