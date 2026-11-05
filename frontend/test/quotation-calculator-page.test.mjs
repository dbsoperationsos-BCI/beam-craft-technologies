import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", ...parts), "utf8");
const CALCULATOR = read("src", "components", "sales", "QuotationCalculatorPage.js");
const ROUTE = read("src", "app", "(app)", "sales", "quotation-calculator", "page.js");
const CRM = read("src", "components", "sales", "CRMPage.js");
const PERMISSIONS = read("src", "constants", "modulePermissions.js");
const NAVIGATION = read("src", "constants", "navigation.mjs");

/*
 * The Quotation Calculator, a screen of its own.
 *
 * It was a dialog inside `CRMPage.js` - a portal over the lead popup, dismissed with Escape or a
 * close button. Pricing a quotation is not a question somebody answers in a moment: it is a screen
 * they sit on, with the catalogue, the bookings for a date and a dozen rows, and on a phone a dialog
 * that tall is a page with a border drawn round it.
 *
 * What did **not** change is the arithmetic, the catalogue it prices against, or the handoff to the
 * Quotation Generator. The frame changed and the way in changed; nothing about the pricing did.
 */

test("it is a page, reached by a route that only composes it", () => {
  assert.match(ROUTE, /import QuotationCalculatorPage from "@\/components\/sales\/QuotationCalculatorPage";/);
  assert.match(ROUTE, /<QuotationCalculatorPage \/>/);
  // A page holds no markup of its own - the component is where the screen is.
  assert.equal(/className=|<div/.test(ROUTE), false, "the route should compose the component and nothing else");
  // And the component wears the module page frame rather than a dialog's.
  assert.match(CALCULATOR, /<ModulePageHeader\s*\n\s*title="Quotation Calculator"/);
  assert.equal(/createPortal|aria-modal|role="dialog"/.test(CALCULATOR), false, "the dialog frame should be gone");
});

test("the dialog is gone from the board, and the button navigates instead", () => {
  /*
   * Not left standing beside the page: two screens pricing the same thing is two sets of rules about
   * what a quotation costs, and the one nobody opens is the one that drifts.
   */
  /*
   * The code, not the name: a note where it used to be says where it went, and that is worth having
   * - somebody looking for the calculator in this file should find the answer rather than nothing.
   */
  assert.equal(/function QuotationCalculatorModal\(/.test(CRM), false, "the calculator's dialog is still defined in CRMPage");
  assert.equal(/<QuotationCalculatorModal/.test(CRM), false, "it is still being rendered");
  assert.equal(/\[showQuotationCalculator, setShowQuotationCalculator\]/.test(CRM), false, "the state that opened it is still here");
  // Its money formatter and discount list went with it rather than being left unused.
  assert.equal(/function formatRupees|const rupeeFormat|const discountOptions/.test(CRM), false);
  assert.match(CALCULATOR, /function formatRupees\(value\)/);
  /*
   * The lead popup's own button opens the page in a **new tab**, carrying the lead it is reading,
   * and leaves the popup where it was. Pricing a quotation is looked up against the lead - the
   * dates, the shoots, what was discussed - so navigating away from the lead to do it meant coming
   * back and opening it again.
   */
  assert.match(CRM, /window\.open\(`\/sales\/quotation-calculator\?lead=\$\{encodeURIComponent\(leadPopup\?\.id \|\| ""\)\}`, "_blank", "noopener,noreferrer"\)/);
  assert.match(CRM, /window\.open\(`\/sales\/quotation-calculator\?lead=\$\{encodeURIComponent\(leadId \|\| ""\)\}`, "_blank", "noopener,noreferrer"\)/);
  assert.equal(/router\.push\(`\/sales\/quotation-calculator/.test(CRM), false, "nothing navigates this tab to it any more");
});

test("Back leaves the tab the calculator was opened in, rather than doing nothing", () => {
  /*
   * In a tab opened for it there is no history to go back to, so `router.back()` sat there doing
   * nothing. The tab is closed instead - and where somebody reached the page by a pasted link, or
   * the browser refuses to close a tab it did not open by script, it falls back to the leads screen
   * rather than leaving them on a page with a dead button.
   */
  assert.match(CALCULATOR, /window\.history\.length/);
  assert.match(CALCULATOR, /window\.close\(\)/);
  assert.match(CALCULATOR, /router\.push\("\/sales\/crm"\)/);
});

test("the lead rides in the URL, and the page prices without one", () => {
  assert.match(CALCULATOR, /const leadFromUrl = searchParams\.get\("lead"\) \|\| "";/);
  assert.match(CALCULATOR, /const leadId = leadFromUrl \|\| pickedLead;/);
  // Which the calculator already allowed for as a dialog: no lead, no saved-quote read, and the
  // handoff carries no enquiry.
  assert.match(CALCULATOR, /if \(!leadId\) return undefined;/);
  assert.match(CALCULATOR, /leadId \? getCrmLead\(leadId\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)/);
});

test("the enquiry picker is drawn only to somebody who may read the list", () => {
  /*
   * `/api/sales/enquiries` answers to `SALES / Sales Manager`; this page answers to Quotation
   * Management. A picker drawn for somebody holding the second and not the first would come back
   * 403 - the trap of giving a screen a finer permission than the endpoint it reads. They price
   * without an enquiry instead, and reach a quotation by opening the calculator from the lead.
   */
  assert.match(CALCULATOR, /const \{ canRead: canPickEnquiry \} = useModuleAccess\("SALES", "Sales Manager"\);/);
  assert.match(CALCULATOR, /: canPickEnquiry && <div/);
  // Reused rather than rebuilt: the same control the quotation and group-name forms pick one with.
  assert.match(CALCULATOR, /import EnquiryCombobox from "@\/components\/sales\/EnquiryCombobox";/);
  // Opened from a lead there is no picker at all - a choice beside a fact is a second way to answer
  // a question already answered.
  assert.match(CALCULATOR, /\{leadFromUrl\s*\n\s*\? <p/);
});

test("the route is guarded, and deliberately not a menu screen", () => {
  /*
   * A route with no row here is open to anyone signed in, so it has one. It takes the generator's
   * own permission: pricing a quotation and raising one are the same job, and a feature key of its
   * own would have reached nobody but a Super Admin until somebody ticked it - taking the calculator
   * away from the people already using it.
   *
   * **Which is why it is not in the sidebar.** Two menu screens may not share a permission: Role
   * Management would have no way to offer one without the other, and the application is held to that
   * by `permission-catalogue-sidebar` on the server. So this is a guarded route with no menu entry -
   * the shape `/sales/crd-documents` already has - reached from a lead's own Quotation Calculator
   * button, which is where it was reached from when it was a dialog.
   */
  assert.match(PERMISSIONS, /\["\/sales\/quotation-calculator", \{ module: "SALES", feature: "Quotation Management" \}\]/);
  assert.equal(/quotation-calculator/.test(NAVIGATION), false, "a menu entry sharing Quotations' permission is what the rule forbids");
});

test("it fits a phone", () => {
  // One column at 360px, the body scrolling inside the shell's pane rather than the page scrolling,
  // and the content held to a readable width on a wide screen.
  assert.match(CALCULATOR, /<section className="flex h-full min-h-0 w-full min-w-0 flex-col">/);
  assert.match(CALCULATOR, /className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-6"/);
  assert.match(CALCULATOR, /className="mx-auto w-full max-w-5xl space-y-4"/);
  assert.match(CALCULATOR, /grid gap-4 sm:grid-cols-2/);
});
