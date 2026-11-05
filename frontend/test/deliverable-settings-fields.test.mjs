import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A deliverable is sold by several companies, in several variants each, and is asked what its own
 * type needs.
 *
 * Size, Frame Inches and Length shared one box once - "Length / Size" - so a deliverable switched
 * from Image to Video read its print size as a running time. They were then split, and a deliverable
 * held one of each; the same album is sold by Canvera and by Pictoo in several sizes at several
 * prices, so it holds brands now, and a brand holds variants. An image's variant is asked for its
 * size, its frame and a price, a video's for its length and a price, and neither is ever shown the
 * other's boxes.
 *
 * Reads the source, the way the other settings tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", "components", "project-management", ...parts), "utf8");
const DIALOG = read("DeliverableDefinitionDialog.js");
const PANEL = read("ProjectSettingsPanel.js");

test("an image variant is asked for its size and frame, a video's for its length, and neither for the other's", () => {
  assert.match(DIALOG, /const isImage = form\.mediaType === "IMAGE";/);
  assert.match(DIALOG, /const isVideo = form\.mediaType === "VIDEO";/);
  assert.match(DIALOG, /\{isImage && <TextField\s*\n\s*label="Size"/);
  assert.match(DIALOG, /\{isImage && <TextField\s*\n\s*label="Frame Inches"/);
  assert.match(DIALOG, /\{isVideo && <TextField\s*\n\s*label="Length"/);
  // Price is asked of every variant, whatever the deliverable's type.
  assert.doesNotMatch(DIALOG, /\{(isImage|isVideo) && <TextField\s*\n\s*label="Price"/);
});

test("brands and variants are each added and removed, and the last of either keeps its row", () => {
  assert.match(DIALOG, /\+ Add Variant</);
  assert.match(DIALOG, /\+ Add Another Brand</);
  assert.match(DIALOG, /\{form\.brands\.length > 1 && <Button/);
  assert.match(DIALOG, /\{brand\.variants\.length > 1 && <Button/);
  assert.match(DIALOG, /Delete Brand</);
});

test("a change of type that would throw variants away is asked about first", () => {
  assert.match(DIALOG, /const losing = variantsLosingValues\(form\.brands, value\);/);
  assert.match(DIALOG, /if \(losing\.length\) return setConfirmTypeChange\(/);
  // The values stay in the form until the deliverable is saved, so Cancel really does leave it as
  // it was - the question has to say so rather than claim the data has gone.
  assert.match(DIALOG, /Nothing is removed until then\./);
});

test("the deliverable's own brand, size, frame, length and price are not sent - the server mirrors them", () => {
  assert.match(DIALOG, /brands: brandsForSave\(form\.brands, form\.mediaType\),/);
  for (const field of ["brandName:", "imageSize:", "videoLength:", "frameInches:", "price:"]) {
    assert.doesNotMatch(DIALOG, new RegExp(`\\n\\s*${field}`), `${field} is still sent by the dialog`);
  }
});

test("No. of Count and Image Selection are picked, and Remarks is written", () => {
  // Two questions with two answers each, and a note. The note is a textarea because it is written
  // rather than chosen, and it opens on whatever the deliverable holds - nothing, to begin with.
  assert.match(DIALOG, /<Dropdown\s*\n\s*label="No\.of\.Count"/);
  assert.match(DIALOG, /<Dropdown\s*\n\s*label="Image Selection"/);
  assert.match(DIALOG, /<TextAreaField\s*\n\s*label="Remarks"/);
  assert.doesNotMatch(DIALOG, /<TextAreaField\s*\n\s*label="(No\. of Count|Image Selection)"/);
});

test("the two dropdowns write the words their columns hold, not a boolean's true and false", () => {
  // The columns are text. `booleanOptions` writes "true" / "false" and belongs to the Service
  // dialog, whose Remarks really is a boolean column; handing it to these two would store "true".
  assert.match(PANEL, /const yesNoOptions = \[\{ label: "Yes", value: "Yes" \}, \{ label: "No", value: "No" \}\];/);
  assert.match(PANEL, /yesNoOptions=\{yesNoOptions\}/);
  assert.equal([...DIALOG.matchAll(/options=\{yesNoOptions\}/g)].length, 2, "both answers pick from the words");
  /*
   * `booleanOptions` writes "true" / "false" and belongs to a column that really is a boolean.
   * Complimentary is one, so it takes that list; No. of Count and Image Selection are text and must
   * not, or they would store "true" where the word belongs.
   */
  const complimentary = DIALOG.slice(DIALOG.indexOf('label="Complimentary"'));
  assert.match(complimentary, /options=\{booleanOptions\}/);
  assert.doesNotMatch(DIALOG.slice(0, DIALOG.indexOf('label="Complimentary"')), /options=\{booleanOptions\}/);
  // Image Selection offers Yes and No and nothing else.
  assert.doesNotMatch(DIALOG, /imageSelectionOptions/);
  assert.doesNotMatch(PANEL, /imageSelectionOptions/);
});

test("an answer cleared to nothing is sent as unanswered rather than as a No", () => {
  assert.match(DIALOG, /photoCountEnabled: form\.photoCount\.trim\(\) \|\| null,/);
  assert.match(DIALOG, /imageSelectionEnabled: form\.imageSelection\.trim\(\) \|\| null,/);
  assert.match(DIALOG, /remarksEnabled: form\.remarks\.trim\(\) \|\| null,/);
});

/*
 * Remarks decides nothing any more.
 *
 * It was the switch for a project deliverable line's own remarks box. Read as a switch, a note
 * beginning "Not applicable" or "No frames for this one" turned that box off across every project
 * using the deliverable, with nothing on screen to say so. Every deliverable answered Yes to it, so
 * making the box unconditional changes no project that exists.
 */
test("a project's deliverable line always keeps its remarks box", () => {
  const section = fs.readFileSync(path.join(HERE, "..", "src", "components", "project-management", "ProjectServiceCreationSection.js"), "utf8");
  assert.match(section, /function deliverableRemarksEnabled\(\) \{\n\s*return true;\n\}/);
  // And the definition's answer is not consulted on the way past.
  assert.doesNotMatch(section, /deliverableAnswerNotOff/);
});

test("the server stores a line's remark whatever the deliverable's note says", () => {
  const controller = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  const start = controller.indexOf("async function deliverableAllocationDataForDefinition(");
  const body = controller.slice(start, controller.indexOf("\n}", start));
  assert.match(body, /remarks: input\.remarks \|\| null,/);
  // The gate itself is gone - not merely the word, which the comment there still explains.
  assert.doesNotMatch(body, /const remarksEnabled =/);
  assert.doesNotMatch(body, /remarks: remarksEnabled/);
  // No. of Count still decides, exactly as it did.
  assert.match(body, /const photoCountEnabled = deliverableAnswerNotOff\(definition\?\.photoCountEnabled\);/);
  assert.match(body, /numberOfPhotos: photoCountEnabled \?/);
});

test("the Deliverables table reads in the dialog's own order", () => {
  const start = PANEL.indexOf("const deliverableColumns = useMemo(() => [");
  assert.ok(start > -1, "deliverableColumns is not declared");
  const ids = [...PANEL.slice(start, PANEL.indexOf("], [", start)).matchAll(/\{ id: "([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, [
    "name", "brandName", "type", "imageSize", "videoLength", "frameInches", "price",
    "photoCount", "imageSelection", "complimentary", "remarks",
  ]);
  assert.match(PANEL.slice(start), /id: "actions",/);
});

test("the three answers read as the words they were typed as", () => {
  assert.match(PANEL, /photoCount: deliverableAnswerText\(row\.photoCountEnabled\) \|\| "—",/);
  assert.match(PANEL, /imageSelection: deliverableAnswerText\(row\.imageSelectionEnabled\) \|\| "—",/);
  assert.match(PANEL, /remarks: deliverableAnswerText\(row\.remarksEnabled\) \|\| "—",/);
});

/*
 * The Deliverables table opens the way the Services table does, over the three levels a deliverable
 * has rather than a service's two: the deliverable, the companies that sell it, and the variants
 * each company sells it in. Each level answers only its own questions, so nothing is run together
 * into a sentence inside one cell.
 */
test("a deliverable opens into its brands, and a brand opens into its variants", () => {
  assert.match(PANEL, /expandable=\{\{/);
  assert.match(PANEL, /getSubRows: \(row\) => row\.brands \|\| row\.variants \|\| \[\],/);
  assert.match(PANEL, /canExpand: \(row\) => \(row\.brands \|\| row\.variants \|\| \[\]\)\.length > 0,/);
  // A brand carries the variants that hang under it, which is what makes the second level exist.
  assert.match(PANEL, /variants: variantRowsOf\(deliverable, brand, index\),/);
  assert.match(PANEL, /brands,\n\s*\};/);
});

test("every row under a deliverable has a key of its own", () => {
  // Two deliverables' first brands, and two brands' first variants, would otherwise collide.
  assert.match(PANEL, /id: `\$\{deliverable\.id\}:brand:\$\{index\}`,/);
  assert.match(PANEL, /id: `\$\{deliverable\.id\}:brand:\$\{brandIndex\}:variant:\$\{index\}`,/);
});

test("the head row answers only what belongs to the deliverable, and prices itself as a range", () => {
  // Size, Length and Frame Inches belong to a variant - the head row claims none of them, exactly
  // as a service's head row claims neither its Session Timing nor its Duration.
  assert.match(PANEL, /imageSize: brands\.length \? "—" : \(row\.imageSize \|\| "—"\),/);
  assert.match(PANEL, /videoLength: brands\.length \? "—" : \(row\.videoLength \|\| "—"\),/);
  assert.match(PANEL, /frameInches: brands\.length \? "—" : \(row\.frameInches \|\| "—"\),/);
  // The companies are read off the brand rows, the way a service's Shoot Type is read off its lines.
  assert.match(PANEL, /\[\.\.\.new Set\(brands\.map\(\(brand\) => brand\.brandName\)\)\]\.join\(", "\)/);
  assert.match(PANEL, /price: brands\.length \? \(priceRangeOf\(variants\) \|\| "—"\) : deliverablePricingLabel\(row\)/);
});

test("a brand and a variant draw nothing in the cells that are not theirs", () => {
  const start = PANEL.indexOf("const deliverableColumns = useMemo(() => [");
  const columns = PANEL.slice(start, PANEL.indexOf("], [", start));
  // The deliverable's name, and its ⋮ - a brand is edited in its deliverable's own dialog.
  assert.match(columns, /render: \(row\) => \(row\.isLine \? null : <span className="font-medium text-slate-800">\{row\.name\}<\/span>\)/);
  assert.match(columns, /render: \(row\) => \(row\.isLine \? null : <OptionsMenu/);
  // The company is named once, on the brand row - not again on each of its variants.
  assert.match(columns, /render: \(row\) => \(row\.isVariant \? null : row\.brandName\)/);
});

test("a variant is never asked for the boxes its deliverable's type does not have", () => {
  // Blank rather than a dash: a dash on a video's Frame Inches reads as an answer about the
  // variant, when the question was never put to it.
  assert.match(PANEL, /imageSize: isVideo \? "" : \(variant\.size \|\| "—"\),/);
  assert.match(PANEL, /videoLength: isImage \? "" : \(variant\.videoLength \|\| "—"\),/);
  assert.match(PANEL, /frameInches: isVideo \? "" : \(variant\.frameInches \|\| "—"\),/);
});
