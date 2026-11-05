const test = require("node:test");
const assert = require("node:assert/strict");
const { PRODUCTS, isProduct, inviteState, submissionSchema, checkUpload, phonesMatch } = require("../src/modules/subscribe/client-onboarding/rules");

const NOW = new Date("2026-11-04T10:00:00Z");
const png = (bytes) => `data:image/png;base64,${Buffer.alloc(bytes, 1).toString("base64")}`;

function validSubmission() {
  return {
    companyName: "Velava Agencies",
    address: "12 Anna Salai, Chennai 600002",
    gstNumber: "33ABCDE1234F1Z5",
    panNumber: "ABCDE1234F",
    logo: png(100),
    favicon: png(100),
    usersNeeded: 10,
    mainContactName: "Arun",
    mainContactPhone: "+91 98765 43210",
    mainContactDesignation: "Director",
    secondaryContactName: "Priya",
    secondaryContactPhone: "+91 91234 56789",
    secondaryContactDesignation: "Manager",
  };
}

test("the two products and nothing else", () => {
  assert.deepEqual(PRODUCTS, { MEDIA_STUDIO_OPERATIONS: "Orbyt", ACCOUNT_MANAGER: "Nilo" });
  assert.equal(isProduct("ACCOUNT_MANAGER"), true);
  assert.equal(isProduct("HRM"), false);
});

test("inviteState reads submitted, cancelled, expired and pending", () => {
  const future = new Date(NOW.getTime() + 60_000);
  assert.equal(inviteState({ submittedAt: NOW, expiresAt: future }, NOW), "Submitted");
  assert.equal(inviteState({ cancelledAt: NOW, expiresAt: future }, NOW), "Cancelled");
  assert.equal(inviteState({ expiresAt: new Date(NOW.getTime() - 1000) }, NOW), "Expired");
  assert.equal(inviteState({ expiresAt: future }, NOW), "Pending");
});

test("gst and pan are normalised before checking", () => {
  const parsed = submissionSchema.parse({ ...validSubmission(), gstNumber: " 33abcde1234f1z5 ", panNumber: "abcde1234f" });
  assert.equal(parsed.gstNumber, "33ABCDE1234F1Z5");
  assert.equal(parsed.panNumber, "ABCDE1234F");
  assert.equal(submissionSchema.safeParse({ ...validSubmission(), panNumber: "ABCDE1234" }).success, false);
  assert.equal(submissionSchema.safeParse({ ...validSubmission(), gstNumber: "33ABCDE1234F1X5" }).success, false);
});

test("every field is mandatory", () => {
  for (const key of Object.keys(validSubmission())) {
    const body = validSubmission();
    delete body[key];
    assert.equal(submissionSchema.safeParse(body).success, false, key);
    assert.equal(submissionSchema.safeParse({ ...validSubmission(), [key]: "   " }).success, false, `${key} blank`);
  }
});

test("usersNeeded must be a whole number of at least 1", () => {
  assert.equal(submissionSchema.safeParse({ ...validSubmission(), usersNeeded: 0 }).success, false);
  assert.equal(submissionSchema.safeParse({ ...validSubmission(), usersNeeded: 2.5 }).success, false);
  assert.equal(submissionSchema.parse({ ...validSubmission(), usersNeeded: "12" }).usersNeeded, 12);
});

test("logo must be png and favicon png or svg within size", () => {
  const LOGO = { types: ["image/png"], maxBytes: 5 * 1024 * 1024 };
  const FAVICON = { types: ["image/png", "image/svg+xml"], maxBytes: 1024 * 1024 };
  assert.match(checkUpload(`data:image/jpeg;base64,${Buffer.alloc(10).toString("base64")}`, LOGO), /PNG/);
  assert.match(checkUpload(png(1.2 * 1024 * 1024), FAVICON), /1 MB/);
  assert.equal(checkUpload(png(500), FAVICON), null);
  assert.equal(checkUpload(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`, FAVICON), null);
  assert.match(checkUpload("not a file", LOGO), /PNG/);
});

test("verify accepts the phone in another format", () => {
  assert.equal(phonesMatch("+91 98765-43456", "9876543456"), true);
  assert.equal(phonesMatch("+91 98765-43456", "9876500000"), false);
});

const { clientInviteSchema } = require("../src/modules/subscribe/client-onboarding/rules");

test("the invite asks who it is for and until when, all required; company details stay optional", () => {
  const contact = { contactName: " Kamalnath ", contactEmail: " Owner@Velava.in ", contactPhone: "+91 9442648610", expiresAt: "2026-11-12" };
  assert.deepEqual(clientInviteSchema.parse(contact), { contactName: "Kamalnath", contactEmail: "owner@velava.in", contactPhone: "+91 9442648610", expiresAt: "2026-11-12", company: {} });
  for (const field of Object.keys(contact)) assert.equal(clientInviteSchema.safeParse({ ...contact, [field]: "" }).success, false, `${field} is required`);
  assert.equal(clientInviteSchema.safeParse({ ...contact, contactEmail: "not-an-email" }).success, false);
  assert.deepEqual(clientInviteSchema.parse({ ...contact, company: { companyName: "Velava Agencies", address: "", gstNumber: " 33abcde1234f1z5 " } }).company, { companyName: "Velava Agencies", gstNumber: "33ABCDE1234F1Z5" });
  assert.equal(clientInviteSchema.safeParse({ ...contact, company: { panNumber: "ABC" } }).success, false);
});
