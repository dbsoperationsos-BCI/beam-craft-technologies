import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isFinalizedQuotation, quotationVersionStatus } from "../src/components/sales/quotationLinkStatus.js";
import { STATUS_TONES } from "../src/lib/statusTones.mjs";

/*
 * Create Project shows every version of the enquiry's quotations with its status, and lets only a
 * finalized one be chosen - read off each version's own `status` and `finalization`, never its name
 * or number. The register offers Create Project only on a finalized version. The server makes the
 * same check on save (`sales-project-finalized-quotation`).
 */
const SECTION = readFileSync(new URL("../src/components/sales/SaleDetailsSection.js", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("../src/components/sales/CreateProjectFormPanel.js", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../src/components/sales/QuotationPage.js", import.meta.url), "utf8");
const DROPDOWN = readFileSync(new URL("../src/components/shared/Dropdown.js", import.meta.url), "utf8");
const SERVICE = readFileSync(new URL("../src/services/sales/projects.service.js", import.meta.url), "utf8");

test("each version's status is its state, not its name", () => {
  assert.equal(isFinalizedQuotation({ quotationId: "DBS-QO-DD-ERD-000043-02", finalization: { state: "FINALIZED" } }), true);
  // Two statuses only: Finalized, and Unfinalized for everything else - a saved draft included.
  assert.deepEqual(quotationVersionStatus({ finalization: { state: "FINALIZED" } }), { label: "Finalized", tone: "success" });
  assert.deepEqual(quotationVersionStatus({ finalization: { state: "UNFINALIZED" } }), { label: "Unfinalized", tone: "neutral" });
  assert.deepEqual(quotationVersionStatus({ status: "Draft", finalization: { state: "UNFINALIZED" } }), { label: "Unfinalized", tone: "neutral" });
  // A version number says nothing: V4 unfinalized is not selectable, V1 finalized is.
  assert.equal(isFinalizedQuotation({ quotationId: "DBS-QO-DD-ERD-000043-04", version: 4, finalization: { state: "PREVIOUSLY_FINALIZED" } }), false);
});

test("every version is listed under its quotation, V1 first, and only a finalized one is enabled", () => {
  assert.match(SECTION, /getSalesQuotations\(\{ enquiryId: enquiry, withDrafts: true \}\)/, "drafts are fetched to be shown");
  assert.match(SERVICE, /if \(enquiryId && withDrafts\) params\.set\("withDrafts", "1"\);/);
  assert.match(SECTION, /\.sort\(\(a, b\) => \(Number\(a\.version\) \|\| 0\) - \(Number\(b\.version\) \|\| 0\)\)/);
  assert.match(SECTION, /\{ heading: chain\.quotationNumber \},/);
  assert.match(SECTION, /status: quotationVersionStatus\(quotation\),\s*disabled: !selectable,/);
  assert.match(SECTION, /isFinalizedQuotation\(quotation\) \|\| \(Boolean\(savedQuotationId\) && quotationValue\(quotation\) === savedQuotationId\)/);
  assert.match(SECTION, /const quotation = eligibleVersions\.find\(\(row\) => quotationValue\(row\) === value\);/, "a pick is taken only from the selectable ones");
  // Only a booking being edited keeps its version; a prefill from a lead or a quotation does not.
  assert.match(PANEL, /savedQuotationId=\{mode === "edit" \? project\?\.quotationId \|\| "" : ""\}/);
});

test("a disabled version cannot be chosen by click, Enter or the arrow keys, and looks it", () => {
  assert.match(DROPDOWN, /function select\(option\) \{\s*if \(option\.disabled\) return;/);
  assert.match(DROPDOWN, /while \(next >= 0 && next < visibleOptions\.length && visibleOptions\[next\]\.disabled\) next \+= step;/);
  assert.match(DROPDOWN, /\$\{option\.status \? "disabled:opacity-60" : ""\}/);
  assert.match(DROPDOWN, /index === activeIndex && !option\.disabled \? "bg-slate-100 text-slate-900"/);
  assert.match(DROPDOWN, /\$\{statusToneClass\(option\.status\.tone\)\}/);
  assert.match(STATUS_TONES.success, /bg-green-50 text-green-700/);
});

test("empty, loading, failed and withdrawn are each said", () => {
  assert.match(SECTION, /No finalized quotations available for this enquiry\. Please finalize a quotation before creating a project\./);
  assert.match(SECTION, /quotationsReady && !eligibleVersions\.length/);
  assert.match(SECTION, /disabled=\{isLoadingQuotations \|\| quotationVersions\.length === 0\}/, "the menu opens while versions exist, even if none can be chosen");
  assert.match(SECTION, /isLoadingQuotations \? "Loading quotations\.\.\."/);
  assert.match(SECTION, /onClick=\{\(\) => void loadQuotations\(form\.enquiryId\)\}>Try again<\/Button>/);
  assert.match(SECTION, /is no longer finalized, so it was taken off this project/);
  assert.match(SECTION, /if \(!picked \|\| !quotationsReady \|\| picked === savedQuotationId\) return undefined;/);
});

test("the list is never another enquiry's, never a stale reply's, and is re-read on return to the tab", () => {
  assert.match(SECTION, /if \(request !== quotationRequest\.current\) return;/);
  assert.match(SECTION, /useAutoRefresh\(\(\{ quiet \} = \{\}\) => loadQuotations\(form\.enquiryId, \{ quiet \}\)/);
  assert.match(SECTION, /\.\.\.\(nextEnquiryId === current\.enquiryId \? \{\} : \{ quotationId: "", quotationRowId: "" \}\)/);
});

test("the register offers Create Project only on a finalized version", () => {
  // At the quotation's finalized version, whichever it is - not just the newest.
  assert.match(PAGE, /canCreateProject && !quotation\.isDraft && finalizedVersionOf\(quotation\) && !bookedFromChain\(quotation\)/);
  assert.match(PAGE, /onSelect: \(\) => void openBooking\(finalizedVersionOf\(quotation\)\.id\)/);
});
