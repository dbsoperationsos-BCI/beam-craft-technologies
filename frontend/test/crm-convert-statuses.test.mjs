import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Converted and Converted & Followup both open a project, and the lead keeps the one that was
 * pressed.
 *
 * Converting is not a status change - it is the start of a project. The pill asks, then hands the
 * lead to Sales Manager in a second tab, and it is that project's own save which marks the lead
 * converted. **Converted & Followup** is Qua Qua's status for a client who has bought and is still
 * being worked, so it needs a project every bit as much as the plain one does; it was setting a
 * status and stopping, which made it the one press that should have opened Create Project and
 * quietly did not.
 *
 * Two things have to hold together for that to be worth anything:
 *
 *   1. Both statuses open the tab, from the popup's pills and from the info panel's alike.
 *   2. The lead ends up reading the status that was pressed, rather than a flattened "Converted" -
 *      otherwise the two pills do the same thing and the distinction is lost at the last step.
 *
 * The second one crosses the tab boundary: the status travels in the link, onto the project form,
 * into the create payload and finally into `markCrmLeadConverted`. Each hop is checked here,
 * because a break in any one of them is silent - the project saves, and the lead simply reads the
 * wrong status.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const PAGE = read("frontend", "src", "components", "sales", "CRMPage.js");
const MANAGER = read("frontend", "src", "components", "sales", "SalesManagerPage.js");
const BOOKING = read("frontend", "src", "components", "sales", "projectBooking.js");
const SALE = read("frontend", "src", "components", "sales", "SaleDetailsSection.js");
const LEAD_SERVICE = read("backend", "src", "modules", "sales", "crm-leads", "crmLeadService.js");
const PROJECTS = read("backend", "src", "modules", "sales", "projects", "controller.js");

/** One top-level declaration, from its opening line to the line that closes it. */
function declaration(source, opening, closing) {
  const start = source.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found`);
  const end = source.indexOf(closing, start);
  assert.notEqual(end, -1, `the end of ${opening} was not found`);
  return source.slice(start, end + closing.length);
}

const lifted = [
  declaration(PAGE, 'const CONVERTED_AND_FOLLOWUP_STATUS =', ';'),
  declaration(PAGE, 'const PROJECT_OPENING_STATUSES = [', '];'),
  declaration(PAGE, 'const opensProjectFor =', ';'),
  declaration(PAGE, 'function convertProjectUrl(', '\n}'),
].join("\n\n");

const { opensProjectFor, convertProjectUrl } = new Function(
  `${lifted}\nreturn { opensProjectFor, convertProjectUrl };`,
)();

test("both converted statuses open a project; nothing else does", () => {
  assert.equal(opensProjectFor("Converted"), true);
  assert.equal(opensProjectFor("Converted & Followup"), true);
  for (const status of ["Interested", "Followup", "CNA", "Invalid", "Rejected", "Yet to connect", ""]) {
    assert.equal(opensProjectFor(status), false, status || "an empty status");
  }
});

test("the link carries the status only when it is not the one the server assumes", () => {
  // Plain Converted is the server's own fallback, so saying it adds nothing.
  assert.equal(convertProjectUrl("DBS-EID-QQ-ERD-1", "Converted"), "/sales/manager?convertLead=DBS-EID-QQ-ERD-1");
  assert.equal(convertProjectUrl("DBS-EID-QQ-ERD-1", ""), "/sales/manager?convertLead=DBS-EID-QQ-ERD-1");
  // Qua Qua's own status has to travel, and be escaped on the way - it carries an ampersand, which
  // would otherwise start a second query parameter and arrive as "Converted ".
  const url = convertProjectUrl("DBS-EID-QQ-ERD-1", "Converted & Followup");
  assert.match(url, /convertStatus=Converted\+%26\+Followup/);
  assert.equal(new URL(url, "http://x").searchParams.get("convertStatus"), "Converted & Followup");
  // The lead id is escaped for the same reason, whatever it contains.
  assert.equal(new URL(convertProjectUrl("a b&c"), "http://x").searchParams.get("convertLead"), "a b&c");
});

test("both ways into the board open the tab, rather than writing a status", () => {
  // The lead popup's pills, through the gate that checks the required fields first: converting
  // writes the lead now, so it cannot be pressed on a half-filled form.
  assert.match(PAGE, /onChange=\{\(value\) => \(opensProjectFor\(value\)\n\s*\? attemptConvert\(value\)/);
  assert.match(PAGE, /function attemptConvert\(status\) \{/);
  // The info panel's pills beside the table, which had only ever known about plain Converted.
  assert.match(PAGE, /if \(opensProjectFor\(value\)\) \{\n\s*clearInfoStatusDraft\(\);\n\s*setConvertLead\(\{ lead: selectedLead, status: value \}\);/);
  // And neither one still tests the bare string, which is what left Converted & Followup behind.
  // (Plain Converted is still named on its own where it means that status alone - the date stamped
  // when a form moves to it - which is not a way into the board.)
  assert.doesNotMatch(PAGE, /opensProjectFor\(value\)[^\n]*value === "Converted"|value === "Converted"[^\n]*opensProjectFor/, "a convert path is matching the bare status again");
});

/*
 * ── The status crossing the tab boundary ──────────────────────────────────────────────────────
 *
 * Deliberately not written to the lead before the tab opens: the confirmation promises that a tab
 * closed without saving leaves the lead as it was, and pre-setting the status would break that.
 */
test("the chosen status travels to the project form and into the payload", () => {
  // Read off the link...
  assert.match(MANAGER, /const convertStatus = searchParams\.get\("convertStatus"\) \|\| "";/);
  // ...onto the prefill...
  assert.match(MANAGER, /crmLeadStatus: convertedStatus,/);
  // ...kept by the form, which has no control for it...
  assert.match(SALE, /crmLeadStatus: project\?\.crmLeadStatus \|\| "",/);
  // ...and sent only when the conversion named one.
  assert.match(BOOKING, /\.\.\.\(project\.crmLeadStatus \? \{ crmLeadStatus: project\.crmLeadStatus \} : \{\}\),/);
});

test("the server applies the chosen status, and only a converted one", () => {
  // Taken off the project row - it is about the lead, and Prisma would refuse the create with it.
  assert.match(PROJECTS, /const \{ shoots, quotationId, crmLeadStatus, \.\.\.raw \} = parsed\.data;/);
  // Read from the parsed payload, not from the transaction's result - that one is the project.
  assert.match(PROJECTS, /markCrmLeadConverted\(data\.enquiryId, \{[^}]*\}, parsed\.data\.crmLeadStatus\);/);

  const marker = declaration(LEAD_SERVICE, "async function markCrmLeadConverted(", "\n}");
  // Checked against the list of converted statuses rather than trusted: it arrives from a browser
  // and decides what the lead reads as afterwards.
  assert.match(marker, /const requested = CONVERTED_STATUS_KEYS\.has\(asked\.toLowerCase\(\)\) \? asked : "";/);
  // What was just chosen wins; then a converted status the lead already holds; then plain Converted.
  assert.match(marker, /const status = requested \|\| \(CONVERTED_STATUS_KEYS\.has\(current\.toLowerCase\(\)\) \? current : "Converted"\);/);
});

test("the list the server checks against holds the status the CRM can send", () => {
  const keys = declaration(LEAD_SERVICE, "const CONVERTED_STATUS_KEYS = new Set([", "]);");
  // The exact string Qua Qua's pill sends, lowercased - if these two ever drift, the status is
  // silently ignored and the lead reads "Converted" with no error anywhere.
  assert.ok(keys.includes('"converted & followup"'), "the CRM's own Converted & Followup is not an accepted status");
  assert.ok(keys.includes('"converted"'));
});

/*
 * ── Converting writes the lead, here, in this tab ────────────────────────────────────────────
 *
 * It used to write nothing: the lead was handed to Sales Manager in a second tab and the project's
 * own save marked it, so a tab closed without saving left the lead exactly as it was. The studio
 * asked for the opposite - the decision is made when the pill is pressed, so it is recorded then -
 * and for Create Project to open in the same tab rather than beside it.
 *
 * Three things follow from that, and each is easy to lose in a later edit:
 *
 *   1. Convert is now a **write**, so it has to ask for the same fields a write asks for.
 *   2. It has to be **saved before it navigates**, and not navigate at all if the save was refused.
 *   3. The confirmation has to offer the case where there is no project to book yet.
 */
test("converting asks for the required fields before it will even confirm", () => {
  const body = PAGE.slice(PAGE.indexOf("function attemptConvert(status)"), PAGE.indexOf("function attemptSave("));
  // Asked of the status being written, so Converted & Followup is held to its next follow-up date.
  // The same marking the Update buttons use, so the boxes are shown rather than named in a message.
  assert.match(body, /if \(!requiredMarks\.check\(leadFieldProblems\(leadAsSaved\(displayLead, status\), \{ vertical, popup: true \}\)\)\) return;\s*\n\s*onConvert\?\.\(status\);/);
});

test("the Contacts panel converts through its own save, status forced onto it", () => {
  /*
   * That panel is only ever open on the lead it is showing, so its ordinary save is the right
   * writer - and going through it is what makes a conversion carry its remark, its activity entry
   * and its Last Follow-up Date like any other update.
   */
  assert.match(PAGE, /const saved = await save\(!openProject, false, status\);/);
});

test("the board converts the lead the dialog names, not whatever the popup holds", () => {
  /*
   * The board's confirmation is reached from the popup's pills **and** from the info panel beside
   * the table, where the popup is often closed or open on a different lead.
   *
   * Written through `savePopupLead` at first, which writes `leadPopup`. From the info panel that was
   * either nothing at all - that save refuses on its own `if (!leadPopup)` guard, so the press did
   * nothing and said nothing - or, with the popup open on another lead, it converted *that* one
   * while navigating to this one. So the write is done by id, as `markLeadCna` does it.
   */
  const body = PAGE.slice(PAGE.indexOf("async function confirmConvertLead({ openProject })"));
  assert.doesNotMatch(body.slice(0, body.indexOf("router.push(")), /savePopupLead\(/, "the board converts through the popup's save again");
  assert.match(body, /const id = lead\.id;/);
  assert.match(body, /const currentLead = leads\.find\(\(row\) => row\.id === id\) \|\| lead;/);
  assert.match(body, /apiRequest\(`\/api\/sales\/crm-leads\/\$\{encodeURIComponent\(id\)\}`/);
  // Both halves, as every other status write on this board does.
  assert.match(body, /const nextLead = \{ \.\.\.currentLead, \.\.\.patch \};/);
  assert.match(body, /const nextDetails = \{ \.\.\.currentDetails, \.\.\.patch, \.\.\.leadWorkedTodayPatch\(\) \};/);
  // And it closes the popup only when the popup is on this very lead.
  assert.match(body, /if \(showLeadPopupId === id\) \{ discardPopupDraft\(\); setShowLeadPopupId\(null\); \}/);
});

test("a conversion that was refused does not open Create Project", () => {
  /*
   * The one that matters: without it the reader is taken to Create Project for a lead that never
   * converted, and can book a project against a record still reading Interested.
   */
  const contacts = PAGE.slice(PAGE.indexOf("async function convert({ openProject })"));
  const guard = contacts.indexOf("if (!saved) return;");
  assert.ok(guard !== -1 && guard < contacts.indexOf("router.push("), "the Contacts panel navigates before checking its save");

  const board = PAGE.slice(PAGE.indexOf("async function confirmConvertLead({ openProject })"));
  // The board writes directly, so it returns from the catch rather than checking a flag.
  assert.match(board, /\} catch \(error\) \{\s*\n[\s\S]{0,400}?showError\(error\.message \|\| "Unable to convert this lead\."\);\s*\n\s*return;/);
  assert.ok(board.indexOf("Unable to convert this lead.") < board.indexOf("router.push("), "the board navigates before the write has landed");
});

test("both saves answer whether they wrote anything", () => {
  // `return false` on the refusal *and* on the catch - a save that reported an error and answered
  // undefined would read as success to the `if (!saved)` above.
  for (const opening of ['async function save(closeAfter = false', 'async function savePopupLead(closeAfter = false']) {
    const body = PAGE.slice(PAGE.indexOf(opening), PAGE.indexOf("\n  }\n", PAGE.indexOf(opening)));
    assert.match(body, /return true;/, `${opening} never reports success`);
    assert.match(body, /return false;/, `${opening} never reports failure`);
  }
});

test("it opens in this tab, and nothing opens a second one any more", () => {
  assert.match(PAGE, /router\.push\(convertProjectUrl\(leadId, status\)\)/);
  assert.match(PAGE, /router\.push\(convertProjectUrl\(id, status\)\)/);
  assert.doesNotMatch(PAGE, /window\.open\(convertProjectUrl/, "a convert still opens a second tab");
  assert.match(PAGE, /import \{ useRouter, useSearchParams \} from "next\/navigation";/);
});

test("the confirmation offers the conversion that books no project", () => {
  // "Update and Close": the lead is converted and recorded, and the reader stays where they are.
  assert.match(PAGE, /confirmConvertLead\(\{ openProject: false \}\)/);
  assert.match(PAGE, /convert\(\{ openProject: false \}\)/);
  assert.match(PAGE, /confirmConvertLead\(\{ openProject: true \}\)/);
  assert.match(PAGE, /convert\(\{ openProject: true \}\)/);
  /*
   * Counting the label would be meaningless - "Update and Close" is also the popup's own footer
   * button and is quoted in the unsaved-changes message. What matters is that each dialog has a
   * button wired to the no-project branch, which the four assertions above check directly.
   */
});

test("the dialog no longer promises what it stopped doing", () => {
  /*
   * It used to say the lead is marked "once that project is saved, so closing the tab without
   * saving leaves this lead as it is". Both halves are now untrue - it is marked on the press, and
   * there is no second tab to close - and a dialog that misdescribes what its buttons do is worse
   * than one that says nothing.
   */
  assert.doesNotMatch(PAGE, /once that project is saved/);
  assert.doesNotMatch(PAGE, /opens in Sales Manager as a new project/);
});
