import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * My Profile → My Details → Offer Letter: one card, in the details cards' own style, for every employee
 * by default - where their letter stands and a Download once it is ready. No tab of its own.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

test("a card on My Details, beside References, for every login that is an employee - no tab, no permission to hold", () => {
  const profile = read("components", "profile", "ProfilePage.js");
  assert.doesNotMatch(profile, /id: "offer-letter"|tab === "offer-letter"/);
  assert.match(profile, /<OnboardingDetailsView onboarding=\{profile\.onboarding\} aside=\{profile\.employeeId \? \{ after: "references", node: <MyOfferLetter \/> \} : null\} \/>/);
  const details = read("components", "profile", "OnboardingDetailsView.js");
  // References gives up half its row to it, its fields still two to a row; where References is not filled
  // in, the card still shows, at the end - or above the "nothing filled in" note.
  assert.match(details, /wide: !\(aside && section\.id === aside\.after\) && /);
  assert.match(details, /\.\.\.\(section\.beside \? \[asideCard\] : \[\]\)/);
  assert.match(details, /\{!asidePlaced && asideCard\}/);
  assert.doesNotMatch(profile, /My Offer Letter/);
});

test("the card: its label, where the letter stands, and a Download when ready - no letter drawn on the page", () => {
  const card = read("components", "hrm", "MyOfferLetter.js");
  const service = read("services", "hrm", "myOfferLetter.service.js");
  assert.match(service, /const ROOT = "\/api\/hrm\/my-offer-letter";/);
  assert.match(service, /downloadPdf\(`\$\{ROOT\}\/pdf`/);
  // The details cards' own frame and heading.
  assert.match(card, /<section className="flex h-full flex-col items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">/);
  assert.match(card, /<h3 className="text-sm font-semibold text-slate-800">Offer Letter<\/h3>/);
  assert.match(card, /\{ready && <Button[^>]*>Download<\/Button>\}/);
  assert.doesNotMatch(card, /A4DocumentPreview/);
  for (const status of ["READY", "PENDING", "NOT_SET", "NO_JOINING_DATE"]) assert.match(card, new RegExp(`${status}: `));
  assert.doesNotMatch(card, /apiRequest|fetch\(/);
});
