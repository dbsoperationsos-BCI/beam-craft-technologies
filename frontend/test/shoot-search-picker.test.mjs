import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The expense line's **Shoot ID** picker, and the remote search `Dropdown` grew for it.
 *
 * The picker filtered a list of 200 shoots sent up front, so the cap was not a page but the limit of
 * what a line could name - and ordered newest-first, what it dropped was the oldest, which is a
 * studio's imported history. Three things have to hold for the fix to be real: the typing reaches the
 * server, the local filter gets out of the way (or it would re-hide rows the server matched on a
 * project code the label does not show), and a shoot already chosen keeps its label when the next
 * search does not offer it back.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const DROPDOWN = read("frontend/src/components/shared/Dropdown.js");
const LINES = read("frontend/src/components/hrm/PaymentRequestExpenseLines.js");
/*
 * The three things below used to be written into the expense line itself. They are one hook now
 * (`useRemoteOptions`), because the vendor picker on the same form and the pickers on Extra
 * Quotations need exactly the same three - so this reads the hook for them and the line for the
 * wiring that hands them to its Dropdown.
 */
const REMOTE = read("frontend/src/components/shared/useRemoteOptions.js");
const SERVICE = read("frontend/src/services/hrm/payment-requests.service.js");

test("Dropdown gained remote search rather than a second picker being written", () => {
  // Rule 1: the control nearly fitted, so it took the prop.
  assert.match(DROPDOWN, /onSearch,\n\s*searchLoading = false,\n\s*searchTotal = 0,/);
  assert.match(DROPDOWN, /if \(onSearch\) askToSearch\(event\.target\.value\);/);
  // The typing pauses first: a picker over a few thousand rows is otherwise a request per letter.
  assert.match(DROPDOWN, /const SEARCH_PAUSE_MS = 250;/);
  assert.match(DROPDOWN, /searchTimer\.current = setTimeout\(\(\) => \{ onSearch\?\.\(text\); \}, SEARCH_PAUSE_MS\);/);
  assert.match(DROPDOWN, /useEffect\(\(\) => \(\) => \{ if \(searchTimer\.current\) clearTimeout\(searchTimer\.current\); \}, \[\]\);/, "a menu closed mid-type asks for nothing");
});

test("the local filter stands aside when the caller owns the searching", () => {
  assert.match(DROPDOWN, /const visibleOptions = searchable && search\.trim\(\) && !onSearch/);
  // Otherwise a row the server matched on its project code would be filtered out again by a label
  // that does not contain what was typed.
});

test("an empty menu says which kind of empty it is", () => {
  assert.match(DROPDOWN, /Searching\.\.\./);
  assert.match(DROPDOWN, /onSearch && search\.trim\(\) \? "Nothing matches what you typed\." : "No options available\."/);
  // And a page is said to be a page, since a list that stops silently reads as one that lost rows.
  assert.match(DROPDOWN, /Showing \{visibleOptions\.length\} of \{searchTotal\}\. Type more to narrow it\./);
});

test("the expense line searches the server and keeps the shoot it already named", () => {
  assert.match(SERVICE, /export function searchPaymentRequestShoots\(search = ""\)/);
  // The path is built once for both pickers on this form; `shoots` is the half this test is about.
  assert.match(SERVICE, /return searched\("shoots", search\);/);
  assert.match(SERVICE, /apiRequest\(`\/api\/hrm\/payment-requests\/\$\{what\}/);
  // The hook answers with exactly the three props the remote Dropdown needs, and the line spreads them.
  assert.match(REMOTE, /const props = \{ onSearch: ask, searchLoading: searching, searchTotal: found\?\.total \|\| 0 \};/);
  assert.match(LINES, /\{\.\.\.shoots\.props\}/);
  /*
   * A line holds the shoot's id, and the label comes from a list the next search replaces - so every
   * shoot a search has offered is kept, and a chosen one is put back into the options when the
   * current search does not include it. Otherwise the line reads as blank while being saved
   * correctly, which is worse than an error.
   */
  assert.match(REMOTE, /const \[seen, setSeen\] = useState\(\{\}\);/);
  assert.match(REMOTE, /setSeen\(\(held\) => Object\.fromEntries\(\[\.\.\.Object\.entries\(held\), \.\.\.rows\.map\(\(row\) => \[row\.id, row\]\)\]\)\);/);
  assert.match(LINES, /shoots\.optionsFor\(/);
  // State, not a ref: it is read while the options are built, and React forbids that of a ref.
  assert.doesNotMatch(REMOTE, /useRef/);
});

test("a failed search leaves the menu as it was rather than emptying it", () => {
  const block = REMOTE.slice(REMOTE.indexOf("} catch {"), REMOTE.indexOf("const optionsFor"));
  assert.match(block, /\} catch \{\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\} finally \{/, "nothing is set on failure");
  assert.match(block, /setSearching\(false\)/);
});
