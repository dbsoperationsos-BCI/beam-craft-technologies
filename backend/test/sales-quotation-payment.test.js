const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { paymentDetailsOf, paymentDetailsForQuotation } = require("../src/modules/sales/quotation-brands/service");

/*
 * For Payment: the Assigned Branch's account, UPI ID and QR behind a quotation's public link.
 *
 * Three rules are worth holding. The page is handed only what a client needs to pay and nothing
 * else off the branch row; a branch with nothing to be paid into answers null rather than a card
 * of blanks; and the details are read live off the register by the quotation's own branch - never
 * the head office, the first branch, a branch guessed from a city, or one that has closed -
 * through the same public token checks the quotation itself answers to.
 */

const bangalore = {
  id: 7, name: "Bangalore KA", isActive: true,
  phone: "9876543210", email: "blr@example.com", gstNumber: "29ABCDE1234F1Z5",
  bankAccounts: [{ accountHolderName: "Don't Blink Studioz", bankName: "HDFC Bank – Bangalore", accountNumber: "123456789012", ifscCode: "HDFC0001234" }],
  upiIds: ["dontblinkstudioz@ybl", "9876543210@upi"], qrCodeUrl: "https://cdn.example.com/branches/qr-codes/blr.webp",
  createdAt: new Date(), updatedAt: new Date(),
};
const erode = {
  id: 1, name: "Erode TN", isActive: true,
  bankAccounts: [{ accountHolderName: "Don't Blink Studioz", bankName: "Union Bank – Erode", accountNumber: "987654321098", ifscCode: "UBIN0801234" }],
  upiIds: [], qrCodeUrl: null,
};
const headOffice = {
  ...erode, id: 2, name: "Erode Head Office",
  bankAccounts: [{ ...erode.bankAccounts[0], accountNumber: "111111111111" }],
};

/** A register the resolver reads from: `findUnique` by id, `findMany` the active rows. */
const registerOf = (rows) => ({
  branch: {
    findUnique: async ({ where }) => rows.find((row) => row.id === where.id) || null,
    findMany: async () => rows.filter((row) => row.isActive),
  },
});

test("the page is handed the payment fields and nothing else off the branch", () => {
  const details = paymentDetailsOf(bangalore);
  assert.deepEqual(details, {
    branchName: "Bangalore KA",
    // A list since the branch stopped holding one account in four columns of its own. Every account
    // whole, in the branch's own order, which is the order the page prints the cards in.
    accounts: [{
      accountHolderName: "Don't Blink Studioz",
      bankNameAndBranch: "HDFC Bank – Bangalore",
      accountNumber: "123456789012",
      ifsc: "HDFC0001234",
    }],
    upiIds: ["dontblinkstudioz@ybl", "9876543210@upi"],
    paymentQrUrl: "https://cdn.example.com/branches/qr-codes/blr.webp",
  });
  for (const leaked of ["id", "phone", "email", "gstNumber", "createdAt", "updatedAt", "isActive", "isHeadOffice"]) {
    assert.equal(leaked in details, false, `${leaked} must not reach the public page`);
  }
});

test("what the branch does not hold comes back empty, so the page hides the row rather than the label", () => {
  // Bank details but no QR and no UPI ID: the bank card alone. A branch written before the list
  // existed holds NULL where every branch since holds a list, and both read as none.
  const bankOnly = paymentDetailsOf({ ...bangalore, upiIds: null, qrCodeUrl: null });
  assert.deepEqual(bankOnly.upiIds, []);
  assert.equal(bankOnly.paymentQrUrl, "");
  assert.equal(bankOnly.accounts[0].accountNumber, "123456789012");
  assert.deepEqual(paymentDetailsOf({ ...bangalore, upiIds: ["", "  ", "abc@ybl"] }).upiIds, ["abc@ybl"]);

  /*
   * QR and UPI ID with a half-filled account: whatever is there, and nothing invented. The register
   * asks for all four fields of every account it holds, so this is the row the migration copied
   * across from a branch that held only a number - printed as what it is rather than filled in.
   */
  const partial = paymentDetailsOf({
    ...bangalore,
    bankAccounts: [{ accountHolderName: "  ", bankName: null, accountNumber: "123456789012", ifscCode: "" }],
  });
  assert.equal(partial.accounts[0].accountHolderName, "");
  assert.equal(partial.accounts[0].bankNameAndBranch, "");
  assert.equal(partial.accounts[0].ifsc, "");
  assert.equal(partial.accounts[0].accountNumber, "123456789012");
  assert.deepEqual(partial.upiIds, ["dontblinkstudioz@ybl", "9876543210@upi"]);

  // An account with no number at all is not a card: it is dropped, and a branch left with nothing
  // else to pay into offers no payment page at all.
  const numberless = paymentDetailsOf({
    ...bangalore,
    bankAccounts: [{ accountHolderName: "Don't Blink Studioz", bankName: "HDFC Bank", accountNumber: "", ifscCode: "HDFC0001234" }],
  });
  assert.deepEqual(numberless.accounts, []);
});

test("a branch is payable only through an account number, a UPI ID or a QR - a name over nothing is not", () => {
  assert.equal(paymentDetailsOf(null), null);
  assert.equal(paymentDetailsOf({ id: 1, name: "Erode TN" }), null);
  const nothingToPayInto = { ...bangalore, bankAccounts: [], upiIds: [], qrCodeUrl: null };
  // A holder's name and a bank's name alone would print a Bank Transfer card naming no account.
  assert.equal(paymentDetailsOf(nothingToPayInto), null);
  assert.equal(paymentDetailsOf({
    ...nothingToPayInto,
    bankAccounts: [{ accountHolderName: "Don't Blink Studioz", bankName: "HDFC Bank", accountNumber: "", ifscCode: "HDFC0001234" }],
  }), null);
  // Any one of the three is enough.
  assert.deepEqual(paymentDetailsOf({ ...nothingToPayInto, upiIds: ["abc@ybl"] })?.upiIds, ["abc@ybl"]);
  assert.equal(paymentDetailsOf({ ...nothingToPayInto, qrCodeUrl: "https://cdn.example.com/qr.webp" })?.paymentQrUrl, "https://cdn.example.com/qr.webp");
});

test("the resolved branch id is what is paid to, and a closed branch is no answer rather than somebody else's", async () => {
  const register = registerOf([headOffice, erode, bangalore]);
  const paid = await paymentDetailsForQuotation({ branchId: 7, sourceBranch: "Erode TN", payload: {} }, register);
  assert.equal(paid.branchName, "Bangalore KA");
  assert.equal(paid.accounts[0].accountNumber, "123456789012");

  // The id names a branch that has since been closed: nothing, and the text is not tried instead.
  const closed = registerOf([headOffice, erode, { ...bangalore, isActive: false }]);
  assert.equal(await paymentDetailsForQuotation({ branchId: 7, sourceBranch: "Erode TN", payload: {} }, closed), null);

  // A row from before the reference was written, whose snapshot froze the branch it was raised in.
  const snapshotted = { branchId: null, sourceBranch: null, payload: { brandSnapshot: { presentation: { branch: { id: 7, name: "Bangalore KA" } } } } };
  assert.equal((await paymentDetailsForQuotation(snapshotted, register)).branchName, "Bangalore KA");
});

test("without an id, only the branch's exact name is read - never a city, a prefix, the head office or the first branch", async () => {
  const register = registerOf([headOffice, erode, bangalore]);
  const byName = await paymentDetailsForQuotation({ branchId: null, sourceBranch: "erode tn", payload: {} }, register);
  assert.equal(byName.branchName, "Erode TN");
  assert.equal(byName.accounts[0].accountNumber, "987654321098");

  // "Erode" is a city two branches sit in, and a prefix of both: the sheet may guess a phone
  // number from it, but not an account.
  assert.equal(await paymentDetailsForQuotation({ branchId: null, sourceBranch: "Erode", payload: {} }, register), null);
  // The payload's spellings are read the same way, and the first exact match answers.
  assert.equal((await paymentDetailsForQuotation({ branchId: null, sourceBranch: "Erode", payload: { assignedBranch: "Bangalore KA" } }, register)).branchName, "Bangalore KA");
  // Two active branches of one name is no answer.
  const twins = registerOf([erode, { ...bangalore, name: "Erode TN" }]);
  assert.equal(await paymentDetailsForQuotation({ branchId: null, sourceBranch: "Erode TN", payload: {} }, twins), null);
  // A quotation naming nothing, and an id that names no row and no text to fall back on.
  assert.equal(await paymentDetailsForQuotation({ branchId: null, sourceBranch: null, payload: {} }, register), null);
  assert.equal(await paymentDetailsForQuotation({ branchId: 99, sourceBranch: null, payload: {} }, register), null);
  // An id that names no row at all falls back to the text - the row was deleted, not closed.
  assert.equal((await paymentDetailsForQuotation({ branchId: 99, sourceBranch: "Erode TN", payload: {} }, register)).branchName, "Erode TN");
});

test("a register that cannot be read is no payment page, not a broken quotation", async () => {
  const broken = { branch: { findUnique: async () => { throw new Error("down"); }, findMany: async () => { throw new Error("down"); } } };
  assert.equal(await paymentDetailsForQuotation({ branchId: 7, payload: {} }, broken), null);
  assert.equal(await paymentDetailsForQuotation({ branchId: null, sourceBranch: "Erode TN", payload: {} }, broken), null);
  assert.equal(await paymentDetailsForQuotation(null, broken), null);
});

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const BRAND_SERVICE = read("src", "modules", "sales", "quotation-brands", "service.js");
const PUBLIC_CONTROLLER = read("src", "modules", "sales", "quotations-public", "controller.js");
const PUBLIC_ROUTES = read("src", "modules", "sales", "quotations-public", "routes.js");
const PROJECTS_CONTROLLER = read("src", "modules", "sales", "projects", "controller.js");

test("the details are read live off the register and never frozen onto the version", () => {
  assert.match(BRAND_SERVICE, /async function branchForPayment\(row, client = prisma\)[\s\S]*?client\.branch\.findUnique/);
  assert.doesNotMatch(BRAND_SERVICE, /brandSnapshot: \{[\s\S]*?paymentDetails[\s\S]*?snapshotAt/, "payment details must not be snapshotted onto a version");
});

test("the payment route answers by the quotation's token with the quotation's own refusals", () => {
  assert.match(PUBLIC_ROUTES, /router\.get\("\/:token\/payment"/);
  assert.ok(PUBLIC_ROUTES.indexOf('"/:token/payment"') < PUBLIC_ROUTES.indexOf('router.get("/:token", linkLimiter, publicQuotation)'), "above /:token, which would swallow it");
  assert.match(PUBLIC_ROUTES, /createRateLimiter\(\{[\s\S]*?quotation-payment/, "bank details are rate limited");
  // The PDF is printed by the shared headless browser: held per caller and per quotation.
  assert.match(PUBLIC_ROUTES, /quotation-pdf:\$\{clientIp\(req\)\}:\$\{\/\^\[A-Za-z0-9_-\]\{8\}\$\/\.test\(String\(req\.params\.token \|\| ""\)\) \? req\.params\.token : "invalid"\}/, "a made-up token cannot open a fresh budget");
  assert.match(PUBLIC_ROUTES, /router\.get\("\/:token\/pdf", linkLimiter, pdfLimiter, publicQuotationPdf\)/);
  assert.match(PUBLIC_CONTROLLER, /\/\^\[A-Za-z0-9_-\]\{8\}\$\/\.test\(token\)/);
  // A draft has been sent to nobody, so its token answers as if there were nothing there.
  assert.match(PUBLIC_CONTROLLER, /quotation\.deletedAt \|\| isDraftQuotation\(quotation\)\) return res\.status\(404\)/);
  assert.match(PUBLIC_CONTROLLER, /quotationLinkState\(quotation\)\.linkExpired[\s\S]*?sendQuotationExpired\(res\)/, "the same 410 the quotation gives, with what the expired page names");
  assert.match(PUBLIC_CONTROLLER, /quotationBrands\.paymentDetailsForQuotation\(quotation\)/);
  assert.match(PUBLIC_CONTROLLER, /res\.set\("Cache-Control", "private, no-store"\)/, "bank details are never cached");
  assert.doesNotMatch(PUBLIC_CONTROLLER, /require\(.*admin\/branches|createBranchesService/, "the admin register is not what the public page reads");
});

test("the quotation record says only whether a payment page exists, and the terms link is untouched", () => {
  const handler = PROJECTS_CONTROLLER.match(/async function publicQuotation\(req, res\) \{[\s\S]*?\n\}/)[0];
  assert.match(handler, /quotationBrands\.paymentDetailsForQuotation\(quotation\)/);
  assert.match(handler, /paymentDetailsAvailable: Boolean\(paymentDetails\)/);
  assert.doesNotMatch(handler, /accountNumber|upiId|qrCodeUrl/, "the details themselves never ride on the record");
});
