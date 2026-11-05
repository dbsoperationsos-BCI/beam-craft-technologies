const test = require("node:test");
const assert = require("node:assert/strict");

const { createBranchSchema, updateBranchSchema, REQUIRED } = require("../src/modules/admin/branches/validation");
const { createBranchesService } = require("../src/modules/admin/branches/service");

/**
 * Settings → Branding → Branches.
 *
 * The two rules worth testing are the ones no column can express: exactly one branch is the head
 * office, and a branch something still points at is closed rather than deleted. The rest is the
 * schema — that the identifiers on an invoice are checked rather than taken as typed.
 */

/**
 * A branch with everything a document needs, which is what the schema now insists on. Each test
 * below starts from this and takes one thing away, or sends one thing wrongly.
 */
const full = {
  code: "ERODE_TN",
  name: "Erode TN",
  addressLine1: "12 Perundurai Road",
  city: "Erode",
  state: "Tamil Nadu",
  postalCode: "638011",
  phone: "9876543210",
  gstNumber: "33ABCDE1234F1Z5",
  panNumber: "ABCDE1234F",
  bankAccountName: "Beam Craft",
  bankName: "Union Bank — Erode",
  bankAccountNumber: "123456789012",
  bankIfsc: "UBIN0801234",
};
const withoutField = (...fields) => { const copy = { ...full }; for (const field of fields) delete copy[field]; return copy; };

test("a branch is refused until it carries everything a document has to say about it", () => {
  const parsed = createBranchSchema.safeParse(full);
  assert.equal(parsed.success, true);
  // The two flags have obvious defaults: a new branch is open and is not the head office.
  assert.equal(parsed.data.isActive, true);
  assert.equal(parsed.data.isHeadOffice, false);

  // A name on its own names every single thing that is missing, rather than the first one.
  const bare = createBranchSchema.safeParse({ name: "Erode TN" });
  assert.equal(bare.success, false);
  assert.deepEqual(Object.keys(bare.error.flatten().fieldErrors).sort(), [...REQUIRED].filter((field) => field !== "name").sort());
  assert.deepEqual(bare.error.flatten().fieldErrors.phone, ["Phone is required."]);
  // And the registration is not among them: a branch trading before its GSTIN comes through is a
  // branch the register has to be able to hold.
  assert.equal(bare.error.flatten().fieldErrors.gstNumber, undefined);
  assert.equal(bare.error.flatten().fieldErrors.panNumber, undefined);

  // Each one alone is enough to refuse the branch, and it is reported against its own field.
  for (const field of REQUIRED.filter((name) => name !== "name")) {
    const missing = createBranchSchema.safeParse(withoutField(field));
    assert.equal(missing.success, false, field);
    assert.ok(missing.error.flatten().fieldErrors[field], `${field} says so itself`);
  }
  // A name of one character is not a name.
  assert.equal(createBranchSchema.safeParse({ ...full, name: "E" }).success, false);
  assert.equal(createBranchSchema.safeParse({ ...full, name: "   " }).success, false);
});

test("the second line, the second number, the email and the web address stay optional", () => {
  // These three are each a second way to say something the branch already says, so a branch is
  // complete without them — and left out reads as cleared, never as an empty string.
  const parsed = createBranchSchema.safeParse({ ...full, addressLine2: "  ", alternatePhone: "", email: "  ", websiteUrl: "" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.addressLine2, null);
  assert.equal(parsed.data.alternatePhone, null);
  assert.equal(parsed.data.email, null);
  assert.equal(parsed.data.websiteUrl, null);
  // Written as it is given, with or without a scheme; a sentence in the box is refused.
  assert.equal(createBranchSchema.safeParse({ ...full, websiteUrl: "  beamcraft.in  " }).data.websiteUrl, "beamcraft.in");
  assert.equal(createBranchSchema.safeParse({ ...full, websiteUrl: "https://Beam-Craft.in/erode" }).data.websiteUrl, "https://Beam-Craft.in/erode");
  assert.equal(createBranchSchema.safeParse({ ...full, websiteUrl: "we do not have one" }).success, false);
  assert.equal(createBranchSchema.safeParse(full).data.description, null);

  // A required field sent as blank is the same as leaving it out: refused, not stored empty.
  const blank = createBranchSchema.safeParse({ ...full, phone: "   ", city: "" });
  assert.equal(blank.success, false);
  assert.deepEqual(blank.error.flatten().fieldErrors.phone, ["Phone is required."]);
  assert.deepEqual(blank.error.flatten().fieldErrors.city, ["City is required."]);
});

test("the registration is optional, and still checked once it is there", () => {
  // A branch with no GSTIN and no PAN saves. Both left out, and both emptied, read as cleared
  // rather than as an empty string sitting in the column.
  const none = createBranchSchema.safeParse(withoutField("panNumber", "gstNumber"));
  assert.equal(none.success, true);
  assert.equal(none.data.gstNumber, null);
  assert.equal(none.data.panNumber, null);
  const emptied = createBranchSchema.safeParse({ ...full, gstNumber: "  ", panNumber: "" });
  assert.equal(emptied.success, true);
  assert.equal(emptied.data.gstNumber, null);
  assert.equal(emptied.data.panNumber, null);

  // Optional is not unchecked: a number that is there is still held to its real shape, so a typo
  // is caught here rather than on an invoice.
  assert.equal(createBranchSchema.safeParse({ ...full, gstNumber: "33ABCDE1234F1X5" }).success, false);
  assert.equal(createBranchSchema.safeParse({ ...full, panNumber: "ABCD01234F" }).success, false);
  // And an edit may now clear either one, which a required field may not be.
  for (const field of ["gstNumber", "panNumber"]) {
    const cleared = updateBranchSchema.safeParse({ [field]: "" });
    assert.equal(cleared.success, true, field);
    assert.equal(cleared.data[field], null, field);
  }
});

test("a branch may carry the QR its clients scan to pay it", () => {
  // The picture arrives as the data URI the browser made; the schema takes it as the string it is
  // and leaves uploading it to the controller.
  const picture = `data:image/webp;base64,${"A".repeat(2000)}`;
  const picked = createBranchSchema.safeParse({ ...full, qrCodeUrl: picture });
  assert.equal(picked.success, true);
  assert.equal(picked.data.qrCodeUrl, picture);

  // A save that changed something else sends back the link the branch already holds, untouched.
  const kept = updateBranchSchema.safeParse({ qrCodeUrl: "https://cdn.example.com/branches/qr-codes/erode.webp" });
  assert.equal(kept.data.qrCodeUrl, "https://cdn.example.com/branches/qr-codes/erode.webp");

  // Optional on the way in, and clearable on the way out: a branch that stops taking QR payments
  // takes the picture down.
  assert.equal(createBranchSchema.safeParse(full).data.qrCodeUrl, null);
  const removed = updateBranchSchema.safeParse({ qrCodeUrl: "" });
  assert.equal(removed.success, true);
  assert.equal(removed.data.qrCodeUrl, null);
});

test("the identifiers that go on an invoice are checked, and folded to upper case", () => {
  const good = createBranchSchema.safeParse({
    ...full,
    gstNumber: "33abcde1234f1z5",
    panNumber: "abcde1234f",
    bankIfsc: "sbin0001234",
    email: "erode@example.com",
    phone: "+91 98765 43210",
  });
  assert.equal(good.success, true);
  assert.equal(good.data.gstNumber, "33ABCDE1234F1Z5");
  assert.equal(good.data.panNumber, "ABCDE1234F");
  assert.equal(good.data.bankIfsc, "SBIN0001234");
  assert.equal(good.data.phone, "+919876543210", "punctuation is not part of a phone number");

  // The second number is the first one's equal in shape, and optional where the first is not.
  const two = createBranchSchema.safeParse({ ...full, phone: "98765 43210", alternatePhone: "+91 424 222 3333" });
  assert.equal(two.success, true);
  assert.equal(two.data.phone, "9876543210");
  assert.equal(two.data.alternatePhone, "+914242223333");
  assert.equal(createBranchSchema.safeParse({ ...full, alternatePhone: "12345" }).success, false, "five digits is not a number");
  assert.equal(createBranchSchema.safeParse({ ...full, phone: "12345" }).success, false, "and the rule does not soften for the first");

  const bad = (patch) => createBranchSchema.safeParse({ ...full, ...patch }).success;
  assert.equal(bad({ panNumber: "ABCD01234F" }), false, "a digit where a letter belongs");
  assert.equal(bad({ gstNumber: "33ABCDE1234F1X5" }), false, "the fixed Z is not a Z");
  assert.equal(bad({ gstNumber: "33ABCDE1234F1Z" }), false, "fourteen characters is not a GSTIN");
  assert.equal(bad({ bankIfsc: "SBI00001234" }), false, "three letters for the bank");
  assert.equal(bad({ bankAccountNumber: "12345678" }), false, "eight digits is too few");
  assert.equal(bad({ bankAccountNumber: "1234567890123456789" }), false, "nineteen is too many");
  assert.equal(bad({ email: "not-an-email" }), false);
});

test("the address is kept in its parts, and the PIN code is six digits", () => {
  const parsed = createBranchSchema.safeParse({
    ...full,
    addressLine1: "  12 Perundurai Road  ",
    addressLine2: "Above Canara Bank, 2nd floor",
    postalCode: "638 011",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.addressLine1, "12 Perundurai Road", "a line is trimmed like every other text column");
  assert.equal(parsed.data.addressLine2, "Above Canara Bank, 2nd floor");
  assert.equal(parsed.data.city, "Erode");
  assert.equal(parsed.data.state, "Tamil Nadu");
  assert.equal(parsed.data.postalCode, "638011", "the spacing somebody types is not part of a PIN code");

  const bad = (patch) => createBranchSchema.safeParse({ ...full, ...patch }).success;
  assert.equal(bad({ postalCode: "63801" }), false, "five digits is not a PIN code");
  assert.equal(bad({ postalCode: "6380112" }), false, "seven is not either");
  assert.equal(bad({ addressLine1: "x".repeat(256) }), false, "a line is 255 characters at most");
  assert.equal(bad({ city: "x".repeat(121) }), false);
});

test("an edit may leave a required field out, but may not empty one", () => {
  // Left out is "not changing this", which is what makes a one-field edit possible at all.
  assert.equal(updateBranchSchema.safeParse({ phone: "9000000000" }).success, true);
  assert.equal(updateBranchSchema.safeParse({}).success, true);
  for (const field of REQUIRED.filter((name) => name !== "code")) {
    const cleared = updateBranchSchema.safeParse({ [field]: "" });
    assert.equal(cleared.success, false, `${field} may not be cleared`);
    assert.ok(cleared.error.flatten().fieldErrors[field], field);
  }
  // The three that were never required may still be cleared, which is how a branch drops a landline.
  for (const field of ["addressLine2", "alternatePhone", "email", "description"]) {
    const cleared = updateBranchSchema.safeParse({ [field]: "" });
    assert.equal(cleared.success, true, field);
    assert.equal(cleared.data[field], null, field);
  }
});

test("an unknown key is refused rather than quietly dropped, and an edit may send one field", () => {
  assert.equal(createBranchSchema.safeParse({ name: "Erode TN", code: "ERODE" }).success, false, "the code is the server's to mint");
  assert.equal(createBranchSchema.safeParse({ name: "Erode TN", isDeleted: true }).success, false);
  const patch = updateBranchSchema.safeParse({ isHeadOffice: true });
  assert.equal(patch.success, true);
  assert.deepEqual(patch.data, { isHeadOffice: true }, "an edit changes only what it names");
});

/* ── The two rules the database cannot hold ──────────────────────────────────────────────────── */

/** A stand-in for the branch table, holding just enough for the service to work against. */
function fakeClient(rows = []) {
  const state = { rows: rows.map((row) => ({ ...row })), nextId: rows.length + 1, counts: {}, deleted: [] };
  const zero = new Proxy({}, { get: () => ({ count: async () => 0 }) });
  const client = {
    state,
    branch: {
      findMany: async () => state.rows,
      findFirst: async ({ where }) => state.rows.find((row) => Object.entries(where).every(([field, value]) => {
        // The only shapes this service asks for: a plain value, and "not this id".
        if (value && typeof value === "object" && "not" in value) return row[field] !== value.not;
        // Text compares case-insensitively, as the database's own collation does.
        return typeof value === "string" ? String(row[field] ?? "").toLowerCase() === value.toLowerCase() : row[field] === value;
      })) || null,
      findUnique: async ({ where }) => state.rows.find((row) => (where.id ? row.id === where.id : row.code === where.code)) || null,
      create: async ({ data }) => { const row = { id: state.nextId, ...data }; state.nextId += 1; state.rows.push(row); return row; },
      update: async ({ where, data }) => { const row = state.rows.find((item) => item.id === where.id); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }) => {
        const hit = state.rows.filter((row) => row.isHeadOffice === where.isHeadOffice && (!where.id || row.id !== where.id.not));
        hit.forEach((row) => Object.assign(row, data));
        return { count: hit.length };
      },
      delete: async ({ where }) => { state.deleted.push(where.id); state.rows = state.rows.filter((row) => row.id !== where.id); return {}; },
    },
    $transaction: async (run) => run(client),
  };
  // Everything the usage count asks about answers zero unless the test says otherwise.
  for (const model of ["user", "asset", "employee", "roleBranch", "salesCrmLead", "salesProject", "salesQuotation", "cashEntry", "paymentRequest", "hrmTask", "salesWhatsappGroupName"]) {
    client[model] = { count: async () => state.counts[model] || 0 };
  }
  return Object.assign(client, { zero });
}

test("the branch code is stored exactly as it is typed, and is required", () => {
  // Whatever the studio writes is what the register holds: no case folding, no substitutions.
  assert.equal(createBranchSchema.safeParse({ ...full, code: "erode tn" }).data.code, "erode tn");
  assert.equal(createBranchSchema.safeParse({ ...full, code: "Erode-TN" }).data.code, "Erode-TN");
  assert.equal(createBranchSchema.safeParse({ ...full, code: "ERD/02" }).data.code, "ERD/02");
  // Only the spaces around it are not part of it.
  assert.equal(createBranchSchema.safeParse({ ...full, code: "  ERODE_TN  " }).data.code, "ERODE_TN");

  const missing = (code) => createBranchSchema.safeParse({ ...full, code }).error?.flatten().fieldErrors.code;
  assert.deepEqual(missing(""), ["Branch code is required."]);
  assert.deepEqual(missing("   "), ["Branch code is required."]);
  assert.deepEqual(missing("E"), ["Branch code is required."], "one character is not a code");
  const withoutCode = { ...full };
  delete withoutCode.code;
  assert.deepEqual(createBranchSchema.safeParse(withoutCode).error.flatten().fieldErrors.code, ["Branch code is required."]);
  assert.equal(createBranchSchema.safeParse({ ...full, code: "x".repeat(51) }).success, false, "fifty characters at most");
});

test("an edit may change the code, but not empty it", () => {
  const changed = updateBranchSchema.safeParse({ code: "Erode Main" });
  assert.equal(changed.success, true);
  assert.equal(changed.data.code, "Erode Main", "stored as written here too");
  assert.equal(updateBranchSchema.safeParse({ code: "" }).success, false);
  assert.deepEqual(updateBranchSchema.safeParse({ code: "  " }).error.flatten().fieldErrors.code, ["Branch code is required."]);
  assert.equal(updateBranchSchema.safeParse({ name: "Erode Main" }).success, true, "an edit still changes only what it names");
});

test("naming a head office takes it off whoever held it, in the same write", async () => {
  const client = fakeClient([
    { id: 1, code: "ERODE_TN", name: "Erode TN", isHeadOffice: true, isActive: true },
    { id: 2, code: "TIRUPPUR_TN", name: "Tiruppur TN", isHeadOffice: false, isActive: true },
  ]);
  const service = createBranchesService(client);
  await service.update(2, { isHeadOffice: true });
  assert.deepEqual(client.state.rows.map((row) => [row.name, row.isHeadOffice]), [["Erode TN", false], ["Tiruppur TN", true]]);

  // And a new branch claiming it takes it from the one that has it.
  await service.create({ code: "CHENNAI_TN", name: "Chennai TN", isHeadOffice: true, isActive: true });
  assert.deepEqual(client.state.rows.filter((row) => row.isHeadOffice).map((row) => row.name), ["Chennai TN"]);
});

test("an edit that says nothing about the head office leaves it where it is", async () => {
  const client = fakeClient([
    { id: 1, code: "ERODE_TN", name: "Erode TN", isHeadOffice: true, isActive: true },
    { id: 2, code: "TIRUPPUR_TN", name: "Tiruppur TN", isHeadOffice: false, isActive: true },
  ]);
  await createBranchesService(client).update(2, { phone: "9876543210" });
  assert.deepEqual(client.state.rows.map((row) => [row.name, row.isHeadOffice]), [["Erode TN", true], ["Tiruppur TN", false]]);
});

test("a branch is disabled rather than deleted, and gives up the head office when it is", async () => {
  const client = fakeClient([
    { id: 1, code: "ERODE_TN", name: "Erode TN", isActive: true, isHeadOffice: true },
    { id: 2, code: "TIRUPPUR_TN", name: "Tiruppur TN", isActive: true, isHeadOffice: false },
  ]);
  const service = createBranchesService(client);

  const off = await service.update(1, { isActive: false });
  assert.equal(off.isActive, false);
  // The studio is not registered from a place it has stopped working out of.
  assert.equal(off.isHeadOffice, false, "a disabled branch is not the head office");
  assert.equal(client.state.rows.length, 2, "nothing was deleted");
  assert.deepEqual(client.state.deleted, []);

  // And back on again: the same edit the other way, and it does not reclaim the head office.
  const on = await service.update(1, { isActive: true });
  assert.equal(on.isActive, true);
  assert.equal(on.isHeadOffice, false);
});

test("there is no way to delete a branch", () => {
  const service = createBranchesService(fakeClient([]));
  assert.equal(typeof service.remove, "undefined", "the register has no delete");
  const { listBranches, createBranch, updateBranch, ...rest } = require("../src/modules/admin/branches/controller");
  assert.ok(listBranches && createBranch && updateBranch);
  assert.deepEqual(Object.keys(rest), [], "and neither has the controller");
});

test("an edit may not take another branch's code", async () => {
  const client = fakeClient([
    { id: 1, code: "ERODE_TN", name: "Erode TN", isActive: true },
    { id: 2, code: "TIRUPPUR_TN", name: "Tiruppur TN", isActive: true },
  ]);
  const service = createBranchesService(client);
  await assert.rejects(
    () => service.update(1, { code: "TIRUPPUR_TN" }),
    (error) => error.status === 409 && error.fieldErrors.code[0] === "Tiruppur TN already uses this code.",
  );
  // Its own code back again is not a clash, and a code nobody holds is simply accepted.
  assert.equal((await service.update(1, { code: "ERODE_TN" })).code, "ERODE_TN");
  assert.equal((await service.update(1, { code: "Erode Main" })).code, "Erode Main");
});

test("a branch is not its own duplicate", async () => {
  const client = fakeClient([
    { id: 1, code: "ERODE_TN", name: "Erode TN", isActive: true, gstNumber: "33ABCDE1234F1Z5", bankAccountNumber: "123456789012" },
    { id: 2, code: "TIRUPPUR_TN", name: "Tiruppur TN", isActive: true, gstNumber: "33ZZZZZ9999Z1Z5", bankAccountNumber: "999888777666" },
  ]);
  const service = createBranchesService(client);
  // Saving a branch with the details it already has must not refuse it.
  const saved = await service.update(1, { name: "Erode TN", gstNumber: "33ABCDE1234F1Z5", bankAccountNumber: "123456789012", phone: "9876543210" });
  assert.equal(saved.phone, "9876543210");
  // But taking another branch's GSTIN still is a clash.
  await assert.rejects(() => service.update(1, { gstNumber: "33ZZZZZ9999Z1Z5" }), (error) => error.status === 409 && Boolean(error.fieldErrors.gstNumber));
});

test("a closed branch still holds its registration", async () => {
  const client = fakeClient([
    { id: 1, code: "OLD_TN", name: "Old TN", isActive: false, gstNumber: "33ABCDE1234F1Z5", bankAccountNumber: "123456789012" },
  ]);
  await assert.rejects(
    () => createBranchesService(client).create({ code: "NEW_TN", name: "New TN", gstNumber: "33ABCDE1234F1Z5", isHeadOffice: false, isActive: true }),
    (error) => error.status === 409,
    "a branch that has stopped trading has not given its GSTIN back",
  );
});

test("a branch that has already gone is a 404, not a crash", async () => {
  const service = createBranchesService(fakeClient([]));
  await assert.rejects(() => service.update(9, { name: "Gone" }), (error) => error.status === 404);
});
