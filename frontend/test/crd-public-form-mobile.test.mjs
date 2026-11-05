import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The public CRD form - what a client fills in on their phone from the studio's WhatsApp link -
 * laid out for that phone: a compact header, a slim footer with its actions side by side, fields a
 * thumb can hit that iOS does not zoom into, and no box scrolling inside the page.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const SHARED = read("components", "sales", "crdDocumentShared.js");
const DUM_DUM = read("components", "sales", "PublicCrdDocumentFormDumDum.js");
const QUA_QUA = read("components", "sales", "PublicCrdDocumentFormQuaQua.js");
const CSS = read("app", "globals.css");

test("both verticals draw the one shared header and footer, not copies of their own", () => {
  for (const form of [DUM_DUM, QUA_QUA]) {
    assert.match(form, /<CrdDocumentHeader title=/);
    assert.match(form, /<CrdDocumentFooter completion=\{completion\}>/);
    assert.doesNotMatch(form, /<header|<button type="(button|submit)" disabled=\{saving \|\| submitting\}/, "no header or raw footer buttons of its own");
  }
});

test("on a phone the header is compact and the footer's actions sit side by side, clear of the home bar", () => {
  assert.match(SHARED, /<DocumentLogo variant="documentCompact" src=\{logoUrl\} priority className="shrink-0 sm:hidden" \/>/);
  assert.match(SHARED, /<h1 className="text-sm font-semibold leading-snug text-slate-900 sm:text-xl">\{title\}<\/h1>/);
  assert.match(SHARED, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(SHARED, /<div className="grid auto-cols-fr grid-flow-col gap-2 sm:flex sm:gap-3">\{children\}<\/div>/);
  assert.match(SHARED, /<Button variant=\{variant\} size="lg" className="w-full whitespace-nowrap !px-2 !text-sm !font-semibold disabled:opacity-60 sm:w-auto sm:!px-6"/);
  // Three actions to a row in Qua Qua: the short word on a phone.
  assert.match(QUA_QUA, /<span className="sm:hidden">Submit<\/span><span className="hidden sm:inline">Submit document<\/span>/);
});

test("the section tabs keep the one being read in view, with a fade saying there are more", () => {
  assert.match(SHARED, /aria-current=\{active \? "true" : undefined\}/);
  assert.match(SHARED, /nav\.scrollTo\(\{ left: tab\.offsetLeft - \(nav\.clientWidth - tab\.offsetWidth\) \/ 2, behavior: "smooth" \}\);/);
  assert.match(SHARED, /\[scrollbar-width:none\] \[&::-webkit-scrollbar\]:hidden/);
  // Only while there is more of the strip to the right - not dimming the last tab once it is reached.
  assert.match(SHARED, /\{moreToRight && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent lg:hidden" \/>\}/);
});

test("on a phone the fields are 16px and thumb-high - on this page only - and the terms are not a scroll inside a scroll", () => {
  assert.match(SHARED, /<main className="crd-public-form flex h-\[100dvh\]/);
  assert.match(CSS, /@media \(max-width: 639\.98px\) \{\s+\.crd-public-form :is\(input:not\(\[type="checkbox"\], \[type="radio"\], \[type="file"\], \[type="hidden"\]\), textarea, select, button\[aria-haspopup\], \[data-field-control\]\) \{\s+font-size: 16px;/);
  assert.match(CSS, /min-height: 44px;/);
  // The date field's trigger and read-only face are reachable by that rule, and nothing else changes.
  assert.equal((read("components", "shared", "DateField.js").match(/data-field-control/g) || []).length, 2);
  for (const form of [DUM_DUM, QUA_QUA]) {
    assert.match(form, /className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 shadow-inner sm:h-72 sm:overflow-y-auto sm:p-5"/);
    assert.doesNotMatch(form, /h-60 overflow-y-auto/);
  }
});
