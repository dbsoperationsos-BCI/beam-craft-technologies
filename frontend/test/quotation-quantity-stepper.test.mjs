import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Quotation Calculator's quantity box, which is typed into as well as stepped.
 *
 * Some of these rows count in **sheets**: an album is quoted at up to 35 of them, and the box used
 * to be a read-only span between a `−` and a `+`, so reaching 35 was thirty-five presses. It is an
 * input now, held inside the limit the product sets - 35 for the top album tiers, 25 for the
 * covers, none for a frame - so where there is a limit the answers run from 0 to it and no further.
 * A quotation past the limit is not one the studio can honour, so it is refused at the box rather
 * than discovered at the bindery. `min` is the floor: 0 by default, and 1 on a row that is on the
 * quote - a line on a quotation counts at least once, the Quotation Generator's rule, and Remove is
 * what takes it off.
 *
 * Read off the source, like the other calculator tests beside it: no DOM, no renderer, and it fails
 * on the edit that takes the behaviour out rather than on the quotation that comes back wrong.
 */

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "QuotationCalculatorLines.js"), "utf8");

/** The body of `QuantityStepper`, which is the whole of what this file is about. */
function stepper() {
  const start = PAGE.indexOf("export function QuantityStepper(");
  assert.notEqual(start, -1, "QuantityStepper is gone");
  const end = PAGE.indexOf("\n}\n", start);
  return PAGE.slice(start, end);
}

test("the quantity is typed into, not only stepped", () => {
  const body = stepper();
  assert.match(body, /<input/, "the quantity is a read-only span again - 35 sheets is 35 presses");
  assert.match(body, /inputMode="numeric"/, "a phone gets the letter keyboard for a number");
  // The limit is said in the label, since the row's own text is a separate element beside the box.
  assert.match(body, /aria-label=\{ceiling === null \? `Quantity of \$\{itemLabel\}` : `Quantity of \$\{itemLabel\}, up to \$\{ceiling\}`\}/);
});

test("the limit comes from the product, and no limit is a real answer", () => {
  const body = stepper();
  assert.match(body, /function QuantityStepper\(\{ value = 0, onChange, itemLabel, max = null, min = 0 \}\)/);
  // A ceiling of 0 or a nonsense one is treated as none: a row that can only hold nothing is worse
  // than an uncapped one.
  assert.match(body, /const ceiling = Number\(max\) > 0 \? Math\.floor\(Number\(max\)\) : null;/);
  // No row on the calculator carries a limit today - the services and deliverables come from
  // Settings, which states none - so every stepper is uncapped, and the cap stays in the control
  // for the product that next needs one.
  assert.doesNotMatch(PAGE, /max=\{(item|group)\.max\}/);
});

test("nothing above the limit can be typed, or left behind", () => {
  const body = stepper();
  // Held as it is typed: a box that accepts 400 and silently shows 35 a moment later reads as the
  // number having been lost.
  assert.match(body, /setDraft\(ceiling !== null && Number\(digits\) > ceiling \? String\(ceiling\) : digits\)/);
  // And again when the box is left, which is what actually reaches the caller.
  assert.match(body, /return onChange\(ceiling !== null && typed > ceiling \? ceiling : typed\);/);
  // Nothing typed, or nothing left once the non-digits go, or less than the floor: the floor.
  assert.match(body, /if \(!Number\.isFinite\(typed\) \|\| typed <= floor\) return onChange\(floor\);/);
});

test("the plus button stops at the limit instead of walking past it", () => {
  const body = stepper();
  assert.match(body, /const atCeiling = ceiling !== null && value >= ceiling;/);
  assert.match(body, /disabled=\{atCeiling\}/, "the + button no longer goes dead at the limit");
  assert.match(body, /onChange\(ceiling === null \? value \+ 1 : Math\.min\(ceiling, value \+ 1\)\)/);
  // Nothing below the floor, as before there was nothing below nothing.
  assert.match(body, /onClick=\{\(\) => onChange\(Math\.max\(floor, value - 1\)\)\}/);
  assert.match(body, /disabled=\{value <= floor\}/, "the − button no longer goes dead at the floor");
});

test("typing is judged when the box is left, not thrown away", () => {
  const body = stepper();
  assert.match(body, /const \[draft, setDraft\] = useState\(null\);/);
  assert.match(body, /onBlur=\{\(event\) => settle\(event\.target\.value\)\}/);
  // Enter settles it and Escape abandons it, so the box is finishable from the keyboard.
  assert.match(body, /if \(event\.key === "Enter"\)/);
  assert.match(body, /if \(event\.key === "Escape"\) \{ setDraft\(null\);/);
});

test("a row on the quote is floored at one, and Remove is what takes it off", () => {
  // Every stepper the calculator draws is on a chosen row, so none may step down to nothing.
  // Lazily to the closing `/>`: the handlers on the tag carry `=>`, so `[^>]*` would stop short.
  const steppers = PAGE.match(/<QuantityStepper[\s\S]*?\/>/g) || [];
  assert.ok(steppers.length >= 2, "the services and deliverables both step");
  for (const stepper of steppers) assert.match(stepper, /min=\{1\}/);
  assert.match(PAGE, /onClick=\{\(\) => onRemoveService\(service\.id\)\}/);
  assert.match(PAGE, /onClick=\{\(\) => onRemoveDeliverable\(row\.id\)\}/);
  // And nothing on the row is a price.
  assert.doesNotMatch(PAGE, /formatRupees|row\.price|line\.price(?!\s*!==\s*null)/);
});

test("the calculator chooses with the Quotation Generator's own picker, and asks the option on the row", () => {
  assert.match(PAGE, /import \{ SearchablePicker \} from "@\/components\/project-management\/ProjectServiceCreationSection"/);
  assert.match(PAGE, /label="Choose Services"/);
  assert.match(PAGE, /label="Choose Deliverables"/);
  // Picking adds the row there and then - no second Add button, as on the generator.
  // One entry per priced booking, the whole booking in its name; picking one chooses it.
  assert.match(PAGE, /name: serviceDisplayLabel\(service\.name, line\)/);
  assert.match(PAGE, /onSelect=\{\(option\) => onAddService\(option\.serviceId, option\.id\)\}/);
  assert.match(PAGE, /onSelect=\{\(option\) => onAddDeliverable\(option\.id\)\}/);
  // The booking a service is priced as is asked on its row, only where there is a choice.
  assert.match(PAGE, /below=\{lines\.length > 1 && \(/);
  assert.match(PAGE, /onChange=\{\(value\) => onServiceLine\(service\.id, value\)\}/);
});

test("a chosen service identifies itself as Service Name - Shoot Type - Session Timing - Duration", () => {
  assert.match(PAGE, /const itemLabel = chosen \? serviceDisplayLabel\(service\.name, chosen\) : service\.name;/);
  assert.match(PAGE, /name=\{itemLabel\}/);
});
