import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * A column filter that takes several answers.
 *
 * The filter row's plain box asks "show me the rows containing this", which is right for a name
 * somebody is typing part of and wrong for a column of a dozen repeated values: reading two
 * people's rows meant filtering to one, reading them, then filtering to the other, and the table
 * could not put them side by side at all.
 *
 * `tableCells.js` and `DataTable.js` both hold JSX, so they are read as source here the way every
 * other test of these two files does.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const CELLS = read("components", "data-table", "tableCells.js");
const TABLE = read("components", "data-table", "DataTable.js");
const CONTROL = read("components", "shared", "FilterMultiSelect.js");

test("a filter holding a list matches any of it, and one holding text still matches a substring", () => {
  /*
   * Both questions, in one filter function, chosen by what the filter is holding - so every table
   * in the application gets the list filter without any of them being told about it, and no caller
   * that passes a string behaves differently than it did.
   */
  assert.match(CELLS, /if \(Array\.isArray\(query\)\) return query\.length === 0 \|\| query\.includes\(shown\) \|\| listParts\(shown\)/);
  // Text is Word Chunk Search: every chunk typed (lib/wordChunks.mjs) - except a date or
  // day, which is read as one phrase, so "12 Oct" means that date.
  assert.match(CELLS, /if \(type === "date" \|\| type === "day"\) return shown\.toLowerCase\(\)\.includes\(String\(query \|\| ""\)\.toLowerCase\(\)\);/);
  assert.match(CELLS, /return matchesWordChunks\(shown, query\);/);
  /*
   * Matched on what the cell **shows**, for both: a date filters as "01/09/2026" the way it reads,
   * and a value picked from the list is the same string the list was built from - so an exact match
   * is exact rather than accidentally a substring of a longer value.
   */
  assert.match(CELLS, /const shown = displayValue\(row\.getValue\(columnId\), type\);/);
});

test("a column offers a list only where its values are a set, and the cost is bounded", () => {
  /*
   * Decided from the rows actually loaded rather than declared per module: a column becomes a
   * picker the day its values become a set and stops being one the day they do not, and nothing has
   * to be kept in step by hand across a dozen tables.
   */
  assert.match(CELLS, /export function distinctFilterValues\(rows, accessorKey, type, limit = 40\)/);
  // Abandoned as soon as it passes the cap, so a Name column on ten thousand rows costs forty reads
  // rather than ten thousand - this is what keeps the filter row cheap on the biggest boards.
  assert.match(CELLS, /if \(seen\.size > limit\) return null;/);
  /*
   * A date and a **day** are a range, and a link and a picture are one per row by their nature: none
   * is a set anybody picks from, so all four keep the text box.
   *
   * `day` was added because the Interview register's dates carried no type at all, so a page
   * holding fewer than forty distinct days was offered a menu of dates to tick - where what
   * anybody wants is to type one.
   */
  assert.match(CELLS, /if \(type === "date" \|\| type === "day" \|\| type === "link" \|\| type === "image"\) return null;/);
  /*
   * And **one value per row is an identifier, not a set**: an Employee ID, an Event ID, a phone
   * number, an email address. A list of those is a list of every row, which answers nothing anybody
   * would ask it - what they want is to type the one they are after.
   *
   * The cap alone made the control depend on how big the studio had grown: a column of 20 employee
   * IDs was a menu of 20 IDs in a studio of 20 and a text box in a studio of 41 - the same screen,
   * the same code, flipping silently at the 41st hire. That is what the studio noticed between
   * develop and production, and both answers could not be right.
   *
   * Nine in ten rather than every one, so two people sharing a surname do not turn a column of names
   * back into a menu of names; and only from eight rows up, because below that every value trivially
   * differs and a real category column - three employees in three departments - would be mistaken
   * for an identifier.
   */
  assert.match(CELLS, /const IDENTITY_MIN_ROWS = 8;/);
  assert.match(CELLS, /const IDENTITY_SHARE = 0\.9;/);
  assert.match(CELLS, /if \(filled >= IDENTITY_MIN_ROWS && seen\.size >= filled \* IDENTITY_SHARE\) return null;/);
  // Judged on the rows that hold something: a column twelve people filled in is judged on those
  // twelve, not on the three hundred who left it empty.
  assert.match(CELLS, /if \(shown === "—"\) continue;\n\s+filled \+= 1;/);
  // A column that knows better than either rule still says so itself and is never asked.
  assert.match(CELLS, /\.\.\.\(listed && !listed\.has\(accessorKey\) \? \{ filter: "text" \} : \{\}\)/);
  // Blank cells are not an option on the list; a column of nothing offers no list at all - said
  // before the identity test now, so an empty column answers "no list" rather than "every row".
  assert.match(CELLS, /if \(!seen\.size\) return null;/);
  assert.match(CELLS, /return \[\.\.\.seen\]\.sort\(\(a, b\) => a\.localeCompare/);

  // Memoised on the data, because that is the only thing it depends on: typing in one filter must
  // not recount every column on the board.
  assert.match(TABLE, /const filterChoices = useMemo\(/);
  assert.match(TABLE, /}, \[columns, data, filtering, filterValues, knownLists\]\);/);
  /*
   * And skipped entirely for a **paged** table. Derived from the loaded rows, such a menu offers
   * the values of the hundred scrolled into view - it grows as you scroll and hides the rows you
   * opened it to find. Those tables pass `filterValues` and the menu asks the server instead.
   */
  assert.match(TABLE, /if \(!filtering \|\| filterValues\) return \{\};/);
});

test("the filter row draws a list where there is one and the plain box everywhere else", () => {
  // The page's own answer where it has one, and the derived set otherwise - the two are the same
  // thing on a table that holds every row.
  assert.match(TABLE, /\(filterValues\?\.has\?\.\(column\.id\) \?\? Boolean\(filterChoices\[column\.id\]\)\)/);
  assert.match(TABLE, /options=\{filterValues \? \(filterValues\.get\(column\.id\) \|\| \[\]\) : filterChoices\[column\.id\]\}/);
  // Asked when the menu opens, not with the page: one per column, and most are never opened.
  // `filterValues?.onOpen`: a page can supply the values outright with nothing to ask for.
  assert.match(TABLE, /onOpen=\{filterValues\?\.onOpen \? \(\) => filterValues\.onOpen\(column\.id\) : undefined\}/);
  /*
   * The text box reads the filter value only when it **is** text. Without the check a column whose
   * filter holds a list would put `["Bala","Anitha"]` into an input as a comma-joined string the
   * moment the column stopped offering a list, which is a filter nobody typed.
   */
  assert.match(TABLE, /typeof column\.getFilterValue\(\) === "string" \? column\.getFilterValue\(\) : ""/);
  assert.match(TABLE, /values=\{Array\.isArray\(column\.getFilterValue\(\)\) \? column\.getFilterValue\(\) : \[\]\}/);
});

test("an emptied list is no filter at all, not a filter matching nothing", () => {
  /*
   * The difference is the whole table: a filter holding `[]` that matched nothing would empty the
   * board the moment somebody unticked their last choice, which reads as the table breaking rather
   * than as the filter being cleared.
   */
  // One rule for every way the list can empty - unticking the last value, or clearing them all.
  assert.match(CONTROL, /const commit = \(next\) => onChange\?\.\(next\.length \? next : undefined\);/);
  assert.match(CELLS, /query\.length === 0 \|\| query\.includes\(shown\)/);
  // And Clear says so in one press, rather than by unticking each choice in turn.
  assert.match(CONTROL, /onClick=\{\(\) => onChange\?\.\(undefined\)\}/);
});

test("the control reads as part of the filter row, and says what is being shown", () => {
  /*
   * Nothing chosen reads as the placeholder (the column is not filtered), one reads as that value,
   * and more read as a count - a trigger this narrow cannot list four names, and a truncated list
   * of them says less than the number does.
   */
  assert.match(CONTROL, /chosen\.length === 0 \? placeholder : \(chosen\.length === 1 \? String\(chosen\[0\]\) : `\$\{chosen\.length\} selected`\)/);
  // Portalled and tracked, like `FilterCombobox`: the table scrolls horizontally underneath it, and
  // a menu that stayed where it was drawn would sit over the wrong column.
  assert.match(CONTROL, /createPortal\(/);
  assert.match(CONTROL, /window\.requestAnimationFrame\(track\)/);
  // A search box wherever the list is long enough to hunt through, which is five values up - a box
  // over Yes and No is furniture, and a list of services or branches is not.
  assert.match(CONTROL, /const SEARCH_FROM = 5;/);
  assert.match(CONTROL, /const searchable = normalized\.length >= SEARCH_FROM;/);
  assert.match(CONTROL, /\{searchable && <div/);
  // Escape closes it and leaves the row exactly as it was, with focus back on the field.
  assert.match(CONTROL, /useEscapeKey\(\(\) => \{ setMenu\(false\); triggerRef\.current\?\.focus\(\); \}, open\)/);
});

const COMBO = read("components", "shared", "FilterCombobox.js");

const KEYS = read("components", "shared", "useListKeyboard.js");

test("the walk is written once and both column filters take it", () => {
  /*
   * A filter row reachable by Tab that could only be answered by clicking is a filter row that is
   * not reachable. Down and Up walk the list and wrap at either end, Home and End reach the ends,
   * and the highlight is scrolled into view; Escape was already the shared listener's.
   *
   * One copy of it, because two were already drifting: the same thirty-five lines sat in both
   * controls, and only one of them forgot the walk when its menu closed.
   */
  assert.match(KEYS, /export default function useListKeyboard\(\{ count = 0, listRef \}\)/);
  assert.match(KEYS, /if \(next < 0\) return count - 1;/);
  assert.match(KEYS, /if \(next >= count\) return 0;/);
  assert.match(KEYS, /scrollIntoView\(\{ block: "nearest" \}\)/);
  /*
   * Home and End are claimed only once a walk is under way. Focus in both controls sits in a text
   * box - the search box in one, the filter field itself in the other - where those keys move the
   * caret, so a menu that took them outright stopped somebody reaching the start of what they were
   * typing. Taken unconditionally at first, which is exactly that.
   */
  assert.match(KEYS, /if \(\(event\.key === "Home" \|\| event\.key === "End"\) && activeIndex >= 0 && count\)/);
  // It says whether it took the key, so a caller can hand it everything and deal with the rest.
  assert.match(KEYS, /return false;\s*\n\s*\}/);

  for (const [name, source] of [["FilterMultiSelect", CONTROL], ["FilterCombobox", COMBO]]) {
    assert.match(source, /const \{ activeIndex, setActiveIndex, walk \} = useListKeyboard\(/, `${name} should share the walk`);
    // Down on a closed menu opens it, which is what the key means on every other listbox.
    assert.match(source, /if \(!open\) \{ event\.preventDefault\(\); setMenu\(true\); return; \}/, `${name} should open on ArrowDown`);
    assert.match(source, /if \(!open \|\| walk\(event\)\) return;/, `${name} should let the walk go first`);
    /*
     * Enter acts only on a row somebody has actually walked to. Without the guard it would take
     * whichever option happened to be first, which is not a choice anybody made - and on the
     * combobox it would overwrite text being typed the moment Enter was pressed.
     */
    assert.match(source, /const option = shown\[activeIndex\];\s*\n\s*if \(!option\) return;/, `${name} should need a highlight before Enter`);
    // Searching rebuilds the list underneath, so the walk starts again rather than pointing at
    // whatever now sits at the old index.
    assert.match(source, /setActiveIndex\(-1\);/, `${name} should reset the highlight as the list narrows`);
    // The pointer and the keyboard agree on which row is live.
    assert.match(source, /onMouseEnter=\{\(\) => setActiveIndex\(index\)\}/, `${name} should follow the pointer too`);
    /*
     * One background class, chosen in code. Which of two Tailwind classes wins is their order in
     * the generated stylesheet and not their order in the attribute, so `bg-blue-50 bg-blue-100`
     * on one element is a coin toss rather than an override.
     */
    assert.match(source, /const background = active/, `${name} should pick one background`);
    // And the row says which it is, for a reader who is not looking at the colour.
    assert.match(source, /aria-activedescendant=/, `${name} should name the active row`);
  }
  /*
   * Enter **ticks** on the multi-select and **closes** on the combobox. The difference is the
   * question each asks: several answers means coming back to the list, and one answer does not.
   */
  assert.match(CONTROL, /toggle\(option\.value\);/);
  assert.match(COMBO, /function choose\(option\) \{[\s\S]{0,160}?setMenu\(false\);/);
});

test("every way of closing either menu forgets the walk", () => {
  /*
   * Four gestures end these menus - Escape, a mousedown outside, the field scrolling out of view,
   * and the chevron - and a highlight left behind by one of them came back on the next open,
   * pointing at a row the reader never walked to and, where the options had been refetched
   * meanwhile, at a different value again. On the combobox that was one focus away: focusing the
   * field reopens the menu.
   *
   * So each control has **one** close, and it is the only thing that writes `open`.
   */
  for (const [name, source] of [["FilterMultiSelect", CONTROL], ["FilterCombobox", COMBO]]) {
    assert.match(source, /const setMenu = useCallback\(\(next\) => \{[\s\S]{0,200}?setActiveIndex\(-1\);/, `${name} should clear the walk on every close`);
    /* Scoped to a statement rather than to the word: both files explain in a comment what used to
       call `setOpen(false)` directly, and a bare count would read its own prose as code. */
    assert.equal([...source.matchAll(/^\s*setOpen\(/gm)].length, 1, `${name} should write open in one place`);
    // Stable, so the mousedown listener can name it and still attach once per opening.
    assert.match(source, /\}, \[setActiveIndex\]\);/, `${name} should keep the close helper stable`);
    assert.match(source, /\}, \[open, setMenu\]\);/, `${name} should depend on it rather than close over a stale one`);
  }
});

test("the search box takes focus, but only when nobody else has it", () => {
  /*
   * Opening a filter and typing is one gesture. Without the focus it is a click on the trigger and
   * a second one into the box, which is what made the search feel like it was not there.
   *
   * An effect rather than `autoFocus`, because the box does not always exist when the menu opens: a
   * column whose values are fetched opens with no options and no search box, and mounts one when
   * the answer lands - hundreds of milliseconds later. `autoFocus` runs on mount, so it would have
   * snatched focus back from wherever the reader had moved on to.
   */
  // Scoped to the attribute: the word survives in the comment that explains why it went.
  assert.doesNotMatch(CONTROL, /^\s*autoFocus$/m);
  assert.match(CONTROL, /const held = document\.activeElement;\s*\n\s*if \(held && held !== document\.body && held !== triggerRef\.current\) return;/);
  /* Keyed on the box existing, not on the menu being open: the portal is drawn a render late, so
     an effect watching `open` fires once, finds no input, and never runs again. */
  assert.match(CONTROL, /const menuMounted = open && Boolean\(menuStyle\);/);
  assert.match(CONTROL, /\}, \[menuMounted, searchable\]\);/);
});

test("one handler hears every key, and takes Enter only from the two controls that mean it", () => {
  /*
   * There is exactly **one** key handler, on the field, although the search box it serves sits in a
   * menu portalled to `document.body`. A React portal propagates its events up the React tree
   * rather than the document one, so the key already arrives; a second handler on the menu - added
   * on the assumption that it could not - ran every keystroke twice, and one ArrowDown moved the
   * highlight by two.
   *
   * That same reach is why Enter is taken only from the search box and the trigger. Select all,
   * Clear and the option rows are buttons inside that portal, so their Enter arrives here too, and
   * taking it would tick the highlighted row and swallow the button the reader had tabbed to.
   */
  assert.equal(CONTROL.split("onKeyDown={handleKeyDown}").length - 1, 1);
  assert.match(CONTROL, /onKeyDown=\{handleKeyDown\}\s*\n\s*className=\{`relative flex min-h-7/);
  assert.match(CONTROL, /if \(event\.target !== searchRef\.current && event\.target !== triggerRef\.current\) return;/);
  // The combobox needs neither: its search box **is** the field, so focus never leaves it and the
  // portalled menu is never what a key is pressed in.
  assert.equal(COMBO.split("onKeyDown={handleKeyDown}").length - 1, 1);
});

test("a listbox holds options and nothing else", () => {
  /*
   * The role used to sit on the portal wrapper, which also holds the search field and the Select
   * all / Clear row - and an `<input role="combobox">` nested inside a listbox is a shape a screen
   * reader is entitled to skip. It is on the scroller now, which holds the option rows alone, and
   * that is what `aria-controls` on the search box names.
   */
  assert.match(CONTROL, /id=\{listId\}\s*\n\s*role="listbox"\s*\n\s*aria-multiselectable="true"/);
  assert.match(CONTROL, /aria-controls=\{listId\}/);
  assert.match(CONTROL, /id=\{`\$\{listId\}-\$\{index\}`\}/);
});

test("neither menu can open outside the window", () => {
  /*
   * The filter row scrolls sideways with the table, so a column half off the left edge gave its
   * menu a negative `left` and a column wider than a phone gave it a `minWidth` wider than the
   * screen - a menu overflowing both edges at once, with no way to scroll to either. Measured at
   * 360px: the trigger's own cell was 594px wide at left -103.
   *
   * Three steps, in order, because each needs the one before it: fit the width to the room, slide
   * the menu back inside, then cap it at the room to the right of where it landed. Capping before
   * the slide left one long option free to grow past the edge again, which is what happened.
   */
  for (const [name, source] of [["FilterMultiSelect", CONTROL], ["FilterCombobox", COMBO]]) {
    assert.match(source, /const room = window\.innerWidth - padding \* 2;/, `${name} should measure the room`);
    assert.match(source, /const width = Math\.min\(.*, room\);/, `${name} should fit the width to it`);
    assert.match(source, /const left = Math\.min\(Math\.max\(rect\.left, padding\), window\.innerWidth - padding - width\);/, `${name} should slide back inside`);
    assert.match(source, /maxWidth: window\.innerWidth - padding - left,/, `${name} should cap against where it landed`);
  }
  // The multi-select keeps its 180px floor, so a narrow column still opens a readable menu.
  assert.match(CONTROL, /const width = Math\.min\(Math\.max\(rect\.width, 180\), room\);/);
});

test("a long option narrows the menu rather than the window", () => {
  /*
   * The combobox drew its options `whitespace-nowrap` against a menu with no width cap, so one long
   * value - a service named in full, a venue - stretched the menu past the edge of the window and
   * carried the end of every other option out with it.
   */
  assert.match(COMBO, /className=\{`block w-full truncate px-3 py-2 text-left/);
  // Scoped to the class attribute: the word survives in the comment that explains why it went.
  assert.doesNotMatch(COMBO, /className=\{`block w-full whitespace-nowrap/);
  // The multi-select already truncated its own.
  assert.match(CONTROL, /className="min-w-0 flex-1 truncate"/);
});

/*
 * The leads board draws through the shared `DataTable` now, but it keeps its filters server-side
 * and asks the server what values a column holds - so what these pin is the board's half: which
 * columns are lists, how a list value is read, and that the answer is the server's alone.
 */
const CRM = read("components", "sales", "CRMPage.js");
const QUERY = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "sales", "crm-leads", "leadQueryService.js"), "utf8");

test("the leads board's closed-set columns take several values, and the server reads them", () => {
  // Status and every other column that offers a list are the board's `filterValues.has`, and the
  // table draws each of them with the one multi-select.
  assert.match(CRM, /has: \(columnId\) => \["status", "choice"\]\.includes\(columnFilterKind\(columnId\)\),/);
  assert.equal(TABLE.split("<FilterMultiSelect").length - 1, 1);
  // A board saved with the old single-string filter still reads - it is a list of one - so nothing
  // anybody had open stops working.
  assert.match(CRM, /const asFilterList = \(value\) => \{/);
  assert.match(CRM, /if \(Array\.isArray\(value\)\) return value;/);

  /*
   * The filters travel as JSON, so a list needs no new transport - only a server that reads one.
   * Exact `IN` rather than `LIKE`, because the values were built from what the board holds: "Bala"
   * chosen from that list means that value, not everyone whose name contains it.
   */
  assert.match(QUERY, /if \(Array\.isArray\(rawValue\)\) \{/);
  assert.match(QUERY, /clauses\.push\(`\$\{sql\} IN \(\$\{values\.map\(\(\) => "\?"\)\.join\(", "\)\}\)`\);/);
  // A string still narrows by matching text, which is what a typed filter has always meant.
  assert.match(QUERY, /clauses\.push\(`\$\{sql\} LIKE \?`\);/);
  // An empty list is no filter, not a filter matching nothing - the same reading the control gives.
  assert.match(QUERY, /if \(!values\.length\) continue;/);
});

test("changing the board clears the filters, as changing the tab already did", () => {
  /*
   * A filter carried onto a board nobody set it on is a board that opens already narrowed, by a
   * value chosen against different rows. It used to keep any filter whose column the new board also
   * had - and the two boards share column ids on purpose, so that was most of them.
   */
  assert.match(CRM, /setFilters\(NO_FILTERS\);\s*\n\s*setAppliedFilters\(NO_FILTERS\);/);
  // Both, because `appliedFilters` is what the load reads: clearing only the boxes would leave the
  // board narrowed by a filter now shown nowhere.
  assert.equal(CRM.split("setAppliedFilters(NO_FILTERS)").length - 1, 2, "on the tab change and the board change");
});

test("filtering does not resize the board under the reader", () => {
  /*
   * The leads table is laid out automatically until a column is resized, so the browser sizes every
   * column to its **contents** - and each keystroke and each tick re-measured the whole board, which
   * is the shake. Pinning the widths already on screen changes nothing visible and stops it.
   */
  // The board asks for the automatic layout, and the table pins the widths before it applies a
  // filter under that layout.
  assert.match(CRM, /layout: "auto",/);
  assert.match(TABLE, /if \(autoLayout\) pinCurrentWidths\(\);/);
  // Does nothing once widths are stored, so calling it on every filter change costs one branch.
  assert.match(TABLE, /function pinCurrentWidths\(\) \{\s*\n\s*if \(Object\.keys\(shownSizing\)\.length\) return;/);
  // The same measurement the first resize makes, so the two cannot drift into different rules.
  assert.match(TABLE, /measured\[column\.id\] = Math\.round\(node\.getBoundingClientRect\(\)\.width\);/);
});

test("Select all takes what is shown; Clear takes everything, in all three multi-selects", () => {
  /*
   * The asymmetry is what a stranded selection taught, on the leads board's Status filter.
   *
   * A column whose values are fetched shows a **fallback** list while the answer is on its way.
   * Select all against that provisional list chose values the real one turned out not to have; the
   * list then shrank to four, the trigger still counted ten, and a Clear that acted only on what
   * was shown removed four and left six filtering the board from nowhere - with no control on
   * screen that could reach them.
   *
   * So: selecting is additive and respects the search, and clearing is total. And the row is not
   * offered at all while the values are still a guess.
   */
  const FORM = read("components", "shared", "MultiSelectField.js");
  const SEARCHABLE = read("components", "shared", "SearchableMultiSelect.js");
  for (const [name, source] of [["FilterMultiSelect", CONTROL], ["MultiSelectField", FORM], ["SearchableMultiSelect", SEARCHABLE]]) {
    // Select all is additive over the shown values only.
    assert.match(source, /selectAllShown = \(\) =>/, `${name} should select what is shown`);
    assert.match(source, /allShownChosen/, `${name} should know whether everything shown is chosen`);
    // Clear is total, and reachable whenever anything is chosen - including values off the list.
    assert.match(source, /Clear\{/, `${name} should offer Clear`);
    assert.match(source, /\|\| (values|value|chosen)\.length > 0\)/, `${name} should offer it whenever anything is chosen`);
  }
  // Total, not "the shown ones": each clears to nothing rather than subtracting what is visible.
  assert.match(CONTROL, /onClick=\{\(\) => onChange\?\.\(undefined\)\}/);
  assert.match(FORM, /onClick=\{\(\) => onChange\?\.\(\[\]\)\}/);
  assert.match(SEARCHABLE, /onClick=\{\(\) => onChange\(\[\]\)\}/);
  // And neither control is offered against a list that is still being fetched.
  assert.match(CONTROL, /\{!loading && \(shown\.length > 1 \|\| chosen\.length > 0\)/);
});

test("a column filter offers what the column holds, and never a fallback catalogue", () => {
  /*
   * The board used to fall back to the whole register - every status, every branch, the whole Sales
   * roster - while a column's real values were being fetched and if they never came. A single-select
   * could live with that: a stale menu offering a value no row has just empties the board, and the
   * reader sees it happen. A multi-select could not - Select all against the fallback chose values
   * the answer did not have, the list shrank under them, and those choices went on filtering from
   * off the list.
   *
   * And a column that genuinely holds nothing should offer nothing, rather than a catalogue of
   * values no row in front of the reader has.
   */
  // The server's answer is the whole of what the table is given to offer.
  assert.match(CRM, /get: columnFilterValues,/);
  assert.match(TABLE, /options=\{filterValues \? \(filterValues\.get\(column\.id\) \|\| \[\]\) : filterChoices\[column\.id\]\}/);
  // The fallback lists are gone with their last caller rather than left dead behind it.
  for (const gone of ["leadStatusFilterOptionsForBoard(", "crmChoiceValues", "branchChoiceValues"]) {
    assert.equal(CRM.includes(gone), false, `${gone} should be gone with the fallback it fed`);
  }
  // "Loading..." is what the menu says while the answer is on its way, so an empty list reads as
  // "still asking" rather than as "nothing here".
  assert.match(CONTROL, /\{loading \? "Loading\.\.\." : "No matches\."\}/);
});

test("the old Select all toggle is gone, and with it the state it could not leave", () => {
  /*
   * A list that has been searched is one somebody has narrowed on purpose, so "all" means all of
   * those - picking the whole catalogue from behind a search would be the control overruling the
   * search. With no search the two are the same thing, which is the ordinary case.
   *
   * A toggle rather than a pair of controls: once everything shown is chosen, the same row clears
   * them, which is the only other thing anybody wants from it. Values the search is hiding are left
   * alone by both halves, so clearing a narrowed list cannot silently drop a choice off screen.
   */
  /*
   * A single row that read "Select all" until everything shown was ticked and "Clear all" after was
   * the fault: with a selection partly off the list it never reached the second state, so there was
   * no way to clear. Neither control subtracts "the shown ones" any more.
   */
  for (const source of [CONTROL, read("components", "shared", "MultiSelectField.js")]) {
    assert.equal(/Clear all" : "Select all"/.test(source), false, "the toggle is gone");
    assert.equal(/filter\(\(value\) => !shownValues\.includes\(value\)\)/.test(source), false, "clearing is total");
  }
});

test("a blank option is not something a multi-select can be filtered to", () => {
  /*
   * The single-select filters are handed an **"All"** row with an empty value, because a menu can
   * only move a field from one answer to another and that row is the way back to no filter. A
   * multi-select has no such problem - unticking everything is the way back - so there that row is
   * a value somebody can tick, which filters the column to the empty string and, before the query
   * schema was taught about lists, answered "Invalid query."
   */
  assert.match(CONTROL, /\.filter\(\(option\) => String\(option\?\.value \?\? ""\)\.trim\(\) !== ""\)/);
  // And the schema names both shapes now, so a board filtered to two statuses is a query rather
  // than a refusal.
  const CONTROLLER = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "sales", "crm-leads", "controller.js"), "utf8");
  assert.match(CONTROLLER, /filters: z\.record\(z\.string\(\), z\.union\(\[z\.string\(\), z\.array\(z\.string\(\)\)\]\)\)\.default\(\{\}\)/);
  assert.equal(CONTROLLER.split("z.union([z.string(), z.array(z.string())])").length - 1, 2, "both query schemas");
});

test("a paged table's filter asks the column, not the rows the browser happens to hold", () => {
  /*
   * The register is read a page at a time. A menu derived from the loaded rows therefore offered
   * the values of the hundred scrolled into view - so the Position filter showed a handful of the
   * 34 the column holds, and grew as the reader scrolled. It hid the very rows it was opened to
   * find, which is the one thing a filter must not do.
   */
  const PAGE = read("components", "hrm", "InterviewPage.js");
  assert.match(PAGE, /filterValues,/);
  assert.match(PAGE, /getCandidateColumnValues\(column, statusFilter === ALL_CANDIDATE_STATUSES \? "" : statusFilter, appliedFilters\)/);
  // Asked when the menu opens, and a column already answered is not asked again.
  assert.match(PAGE, /if \(held\.byColumn\[column\]\) return held;/);
  /*
   * Held against the stage, because that is what the answer describes: an answer arriving after the
   * reader has moved to another tab belongs to the tab they left.
   */
  assert.match(PAGE, /latest\.key === columnValuesKey/);

  // The server answers for a named set of columns and nothing else - the column is checked against
  // an allowlist rather than trusted, and both sides name the same set.
  const CONFIG = read("constants", "interviewConfig.js");
  const SERVICE = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "hrm", "interview", "service.js"), "utf8");
  assert.match(CONFIG, /export const FILTERABLE_CANDIDATE_COLUMNS = \[/);
  assert.match(SERVICE, /const FILTERABLE_COLUMNS = new Set\(\[/);
  assert.match(SERVICE, /if \(!FILTERABLE_COLUMNS\.has\(field\)\) return \[\];/);
  /* Bounded by the array's own closing bracket rather than by a character count, or the slice runs
     on into whatever is declared next and counts its strings too. */
  const named = (source, start) => {
    const from = source.indexOf(start) + start.length;
    return [...source.slice(from, source.indexOf("]", from)).matchAll(/"(\w+)"/g)].map((m) => m[1]);
  };
  assert.deepEqual(
    named(CONFIG, "FILTERABLE_CANDIDATE_COLUMNS = [").sort(),
    named(SERVICE, "FILTERABLE_COLUMNS = new Set([").sort(),
    "the screen and the server disagree about which columns offer a list",
  );
  // Narrowed by the stage being read, so the menu describes the tab rather than the register.
  assert.match(SERVICE, /if \(status\) where\.status = status;/);
});
