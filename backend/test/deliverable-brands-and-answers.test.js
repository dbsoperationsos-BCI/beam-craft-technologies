const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  deliverableAnswerText,
  deliverableAnswered,
  deliverableAnswerOn,
  deliverableAnswerNotOff,
} = require("../src/services/deliverableAnswers");

/*
 * A deliverable's brands, and the three questions asked of it whatever its type.
 *
 * It held one company, one size, one frame, one length and one price, which is not how they are
 * sold: the same album is sold by Canvera and by Pictoo in several sizes at several prices. So it
 * holds brands, each holding the variants it sells the deliverable in, and what a variant carries
 * follows the deliverable's type and nothing else.
 *
 * The three questions underneath - No. of Count, Image Selection, Remarks - were a Yes/No dropdown
 * each and are typed words now. They still decide things: Image Selection is the one thing admitting
 * a deliverable to that module, and the other two decide whether an allocation stores a photo count
 * and a remark. The rule is the point of these tests, because getting it wrong moves deliverables in
 * and out of Image Selection silently.
 */

test("Yes and No go on meaning what they meant, however they were stored", () => {
  assert.equal(deliverableAnswerText(true), "Yes");
  assert.equal(deliverableAnswerText(false), "No");
  assert.equal(deliverableAnswerText(null), "");
  assert.equal(deliverableAnswerText("  2 sets "), "2 sets");
});

test("an answer starting with no is No, anything else typed is Yes, and blank is neither", () => {
  // What `=== true` used to be: blank counts as off.
  assert.equal(deliverableAnswerOn("Yes"), true);
  assert.equal(deliverableAnswerOn(true), true);
  assert.equal(deliverableAnswerOn("No"), false);
  assert.equal(deliverableAnswerOn(false), false);
  assert.equal(deliverableAnswerOn(null), false);
  assert.equal(deliverableAnswerOn(""), false);
  assert.equal(deliverableAnswerOn("   "), false);
  assert.equal(deliverableAnswerOn("50 photos"), true);
  assert.equal(deliverableAnswerOn("N/A"), true);
  assert.equal(deliverableAnswerOn("NO - not this one"), false);

  // What `!== false` used to be: blank counts as on, so an allocation on a deliverable nobody has
  // answered about still stores its remarks, exactly as it always did.
  assert.equal(deliverableAnswerNotOff(null), true);
  assert.equal(deliverableAnswerNotOff(""), true);
  assert.equal(deliverableAnswerNotOff("No"), false);
  assert.equal(deliverableAnswerNotOff(false), false);
  assert.equal(deliverableAnswerNotOff("anything else"), true);

  // Blank is a real state, and it is not a No: Image Selection reports the three apart.
  assert.equal(deliverableAnswered(null), false);
  assert.equal(deliverableAnswered("  "), false);
  assert.equal(deliverableAnswered("No"), true);
});

/*
 * The normalizer the deliverable's PATCH runs its brands through. Loaded after the helpers so a
 * failure above reads as a failure of the rule rather than of the controller's own imports.
 */
const { deliverableBrandsForSave } = require("../src/modules/sales/projects/controller");

test("a video variant can never be left carrying a frame size, whatever the form sends", () => {
  const brands = [{ name: "Canvera", variants: [{ size: "12x18", frameInches: "1.5 inch", videoLength: "3 minutes", price: 2000 }] }];
  assert.deepEqual(deliverableBrandsForSave(brands, "VIDEO"), [
    { name: "Canvera", variants: [{ size: null, frameInches: null, videoLength: "3 minutes", price: 2000 }] },
  ]);
  assert.deepEqual(deliverableBrandsForSave(brands, "IMAGE"), [
    { name: "Canvera", variants: [{ size: "12x18", frameInches: "1.5 inch", videoLength: null, price: 2000 }] },
  ]);
});

test("a deliverable whose type was never answered keeps whatever it is given", () => {
  // Nothing has decided which of the two it is, so throwing either away would be the form deciding.
  const saved = deliverableBrandsForSave([{ name: "Canvera", variants: [{ size: "12x18", videoLength: "3 minutes", price: null }] }], null);
  assert.equal(saved[0].variants[0].size, "12x18");
  assert.equal(saved[0].variants[0].videoLength, "3 minutes");
});

test("a brand still being filled in is not stored, and neither is an empty variant", () => {
  const saved = deliverableBrandsForSave([
    { name: "Canvera", variants: [{ size: "12x18", price: 2000 }, { size: "", frameInches: "", price: null }] },
    { name: "  ", variants: [{ size: " ", price: null }] },
  ], "IMAGE");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].variants.length, 1);
});

test("a brand with no name but a real variant is still a brand", () => {
  // A studio selling its own albums has nobody to name; its sizes and prices are still real.
  const saved = deliverableBrandsForSave([{ name: "", variants: [{ size: "12x18", price: 2000 }] }], "IMAGE");
  assert.deepEqual(saved, [{ name: "", variants: [{ size: "12x18", frameInches: null, videoLength: null, price: 2000 }] }]);
});

test("an unpriced variant is stored as not priced yet rather than as free", () => {
  const saved = deliverableBrandsForSave([{ name: "Canvera", variants: [{ size: "12x18" }] }], "IMAGE");
  assert.equal(saved[0].variants[0].price, null);
});

/*
 * The migration is read rather than run: the suite has no MySQL, and the thing worth asserting is
 * textual anyway - that the conversion writes the words back rather than MySQL's own 1 and 0.
 */
const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260918090000_deliverable_brands_variants_and_text_answers", "migration.sql"),
  "utf8",
);

test("the conversion keeps every Yes and every No as the word it was chosen as", () => {
  // A straight ALTER of a BOOLEAN to VARCHAR writes '1' and '0', which no reader of the column would
  // recognise: '0' does not start with "no", so every deliverable answered No would have been
  // admitted to Image Selection the moment the migration ran.
  for (const column of ["photo_count_enabled", "image_selection_enabled", "remarks_enabled"]) {
    assert.match(MIGRATION, new RegExp(`\`${column}_text\` = CASE WHEN \`${column}\` = 1 THEN 'Yes' WHEN \`${column}\` = 0 THEN 'No' ELSE NULL END`));
  }
  // And a row never answered stays never answered, rather than becoming a No.
  assert.match(MIGRATION, /ELSE NULL END/);
});

test("the brands a deliverable already described are carried over rather than left behind", () => {
  assert.match(MIGRATION, /INSERT INTO `project_deliverable_brand`/);
  assert.match(MIGRATION, /INSERT INTO `project_deliverable_variant`/);
  // Only once, so re-running it cannot duplicate a brand or put back one removed on purpose.
  assert.match(MIGRATION, /AND NOT EXISTS \(SELECT 1 FROM `project_deliverable_brand` `existing`\);/);
  assert.match(MIGRATION, /AND NOT EXISTS \(SELECT 1 FROM `project_deliverable_variant` `existing`\);/);
  // The backfilled variant carries only what the deliverable's own type asked for.
  assert.match(MIGRATION, /CASE WHEN COALESCE\(`definition`\.`media_type`, ''\) = 'VIDEO' THEN NULL ELSE `definition`\.`image_size` END/);
  assert.match(MIGRATION, /CASE WHEN COALESCE\(`definition`\.`media_type`, ''\) = 'IMAGE' THEN NULL ELSE `definition`\.`video_length` END/);
});

test("the brands and variants go with the deliverable they belong to", () => {
  // They are one form's worth of answer, rewritten whole on every save; orphaned rows would show up
  // as brands on a deliverable nobody can see.
  assert.match(MIGRATION, /REFERENCES `project_deliverable_definition`\(`id`\) ON DELETE CASCADE/);
  assert.match(MIGRATION, /REFERENCES `project_deliverable_brand`\(`id`\) ON DELETE CASCADE/);
});
