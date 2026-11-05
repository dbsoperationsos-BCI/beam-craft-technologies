import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { HOME_TABS, MAX_PEOPLE, peopleState, personFilterLabel, railPeople, railSlotsForRest, togglePerson } from "../src/lib/clientGalleryPeople.mjs";

test("pressing a person adds them, pressing again removes them, and the eleventh is refused", () => {
  assert.deepEqual(togglePerson([], "p1"), { next: ["p1"], refused: false });
  assert.deepEqual(togglePerson(["p1", "p2"], "p1"), { next: ["p2"], refused: false });
  const full = Array.from({ length: MAX_PEOPLE }, (_, i) => `p${i}`);
  assert.deepEqual(togglePerson(full, "extra"), { next: full, refused: true }, "the rail stops where the server's query does");
  assert.deepEqual(togglePerson(full, "p3").next.length, MAX_PEOPLE - 1, "one already chosen can still be let go");
  assert.equal(MAX_PEOPLE, 10);
});

test("the gallery home offers All Photos, People, Selected in that order", () => {
  assert.deepEqual(HOME_TABS, ["all", "people", "selected"]);
});

test("the People tab reads the server's answer as loading, unavailable, still organising, nobody, or people", () => {
  assert.equal(peopleState(), "loading");
  assert.equal(peopleState({ loaded: false, people: [{ id: "p1" }] }), "loading", "nothing is shown before the answer lands");
  assert.equal(peopleState({ loaded: true, available: false }), "unavailable");
  assert.equal(peopleState({ loaded: true, available: true, processing: true }), "processing");
  assert.equal(peopleState({ loaded: true, available: true, processing: false }), "empty");
  assert.equal(peopleState({ loaded: true, available: true, processing: true, people: [{ id: "p1" }] }), "ready", "people already found are shown while more are looked for");
  assert.equal(peopleState({ loaded: true, available: false, people: [{ id: "p1" }] }), "ready", "people that exist are offered whatever the switch says");
});

test("a folder opened from People is headed with the chosen people in the order they were chosen", () => {
  const people = [{ id: "p1", label: "Person 1" }, { id: "p2", label: "Person 2" }, { id: "p3", label: "Person 3" }];
  assert.equal(personFilterLabel([], people), "");
  assert.equal(personFilterLabel(["p1"], people), "Person 1");
  assert.equal(personFilterLabel(["p3", "p1"], people), "Person 3, Person 1");
  assert.equal(personFilterLabel(["gone", "p2"], people), "Person 2", "an id the list no longer has is left out");
});

test("the rail leads with everybody chosen, even those it was never handed", () => {
  // The rail is only given the first few of a gallery that may hold thousands.
  const page = [1, 2, 3].map((n) => ({ id: `p${n}`, label: `Person ${n}` }));
  const known = new Map([["p40", { id: "p40", label: "Person 40" }], ["p88", { id: "p88", label: "Person 88" }]]);
  assert.deepEqual(railPeople(page, [], known).map((p) => p.id), ["p1", "p2", "p3"], "nobody chosen leaves the page as it came");
  // Chosen from the picker, far past the page: they are drawn all the same, in the gallery's order.
  assert.deepEqual(railPeople(page, ["p88", "p40"], known).map((p) => p.label), ["Person 1", "Person 2", "Person 3", "Person 40", "Person 88"]);
  // Somebody on the page is not added twice.
  assert.deepEqual(railPeople(page, ["p2"], known).map((p) => p.id), ["p1", "p2", "p3"]);
  // An id nothing is known about cannot be drawn, and is simply left out rather than breaking the row.
  assert.deepEqual(railPeople(page, ["ghost"], known).map((p) => p.id), ["p1", "p2", "p3"]);
  assert.deepEqual(railPeople([], ["p40"], known).map((p) => p.id), ["p40"]);
});

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const ROW = src("components", "image-selection", "client-gallery", "PeopleFilterRow.js");
const PICKER = src("components", "image-selection", "client-gallery", "PeoplePickerDialog.js");
const PANEL = src("components", "image-selection", "client-gallery", "PeoplePanel.js");
const GALLERY = src("components", "image-selection", "PublicGallery.js");

test("More opens the picker instead of pouring the rest of the people into the rail", () => {
  assert.match(ROW, /onClick=\{onOpenMore\}/);
  // The rail no longer expands into a list to scroll through, and there is no Less to fold it back.
  assert.doesNotMatch(ROW, /setExpanded|showMore|showLess/, "the expanding rail is gone");
  assert.doesNotMatch(ROW, />Less</);
  // It leads with as many as its measured width fits - no fixed number - and never wraps.
  assert.doesNotMatch(ROW, /MAX_FEATURED/, "no cap on how many people fit");
  assert.match(ROW, /railSlotsForRest\(\{ slots, total, held: people\.length, chosen: active\.length, fallback: FEATURED \}\)/);
  assert.match(ROW, /new ResizeObserver\(measure\)/, "measured again as the window is resized");
});

test("More appears only for the people who genuinely do not fit", () => {
  // Plenty of room: everybody, no More.
  assert.equal(railSlotsForRest({ slots: 20, total: 4, held: 4 }), 4);
  assert.equal(railSlotsForRest({ slots: 14, total: 12, held: 12 }), 12, "twelve people in fourteen slots: all twelve");
  assert.equal(railSlotsForRest({ slots: 12, total: 12, held: 12 }), 12, "exactly fits: no slot given to More");
  // Not enough room: More takes one slot and stands for the rest - 9 slots, 8 people, More +4.
  assert.equal(railSlotsForRest({ slots: 9, total: 12, held: 12 }), 8);
  // Chosen people always lead and take their slots first.
  assert.equal(railSlotsForRest({ slots: 9, total: 12, held: 12, chosen: 2 }), 6);
  assert.equal(railSlotsForRest({ slots: 20, total: 12, held: 12, chosen: 2 }), 10, "everybody fits: the ten not chosen beside the two chosen");
  // The rail is handed only the first page: a gallery with more than it holds always has a More.
  assert.equal(railSlotsForRest({ slots: 30, total: 60, held: 40 }), 29);
  // A screen with room past what the rail holds shows everybody it holds, and More the rest.
  assert.equal(railSlotsForRest({ slots: 46, total: 45, held: 40 }), 40);
  // Before the strip is measured it leads with the fallback.
  assert.equal(railSlotsForRest({ slots: null, total: 12, held: 12, fallback: 5 }), 5);
});

test("the picker chooses people without filtering anything until Apply", () => {
  // Ticking edits a draft; the gallery hears only on Apply, and hears nothing at all on Cancel.
  assert.match(PICKER, /const \[draft, setDraft\] = useState\(activePersonIds\)/);
  assert.match(PICKER, /onClick=\{\(\) => requestClose\(\(\) => onApply\(draft\)\)\}/, "Apply plays the panel out, then commits the draft");
  const cancel = PICKER.slice(PICKER.indexOf("<footer"));
  assert.match(cancel, /onClick=\{\(\) => requestClose\(\)\}[\s\S]*?>Cancel</, "Cancel simply closes, so the draft is dropped");
  assert.doesNotMatch(PICKER, /onApply\(\[\.\.\.draft/, "nothing is applied as it is ticked");
  // A gallery of thousands is read a page at a time, scrolling inside itself.
  assert.match(PICKER, /useInfiniteScroll\(\{/);
  assert.match(PICKER, /overflow-y-auto overscroll-contain/, "the list scrolls, not the gallery behind it");
  // The three orders are the server's, over the whole gallery rather than the page in hand; only
  // Selected is drawn from the draft the browser already holds.
  assert.match(PICKER, /loadPeople\(\{ page: nextPage, pageSize: PAGE_SIZE \}\)/);
  // The first page is asked for once; choosing somebody is not in that effect at all, so a press
  // never reloads the grid or moves it under the hand.
  assert.match(PICKER, /void load\(1\);/);
  assert.match(PICKER, /\}, \[load\]\);/);
  // No page numbers anywhere: the page counter never leaves `pageRef`.
  assert.doesNotMatch(PICKER, />\s*(Previous|Next)\s*</, "the picker draws no pager");
  assert.match(PICKER, /onLoadMore: \(\) => load\(pageRef\.current \+ 1\)/, "the next page comes from scrolling");
  // Focus is trapped and handed back to More on close, as every dialog here does.
  assert.match(PICKER, /const panelRef = useFocusTrap\(\);/);
  // No search, no order, no list-or-grid switch: the grid is everybody, in the gallery's order.
  assert.doesNotMatch(PICKER, /setSearch|searchRef|SearchRounded|search:|placeholder=/, "no search box, state or request");
  assert.doesNotMatch(PICKER, /SORTS|setSort|<select|Most Photos|List view|Grid view|setView/, "the order and the view switch are gone");
  // One grid, two across on a phone and four where the column is widest.
  assert.match(PICKER, /<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">/);
  // The gallery behind cannot scroll while the panel is open, and is put back as it was found.
  assert.match(PICKER, /document\.body\.style\.overflow = "hidden";[\s\S]*?document\.body\.style\.overflow = previous;/);
  // Ten is the server's ceiling, which is why no control offers to select everybody.
  assert.doesNotMatch(PICKER, />\s*Select all/i, "no select-all control is drawn");
  assert.match(PICKER, /Up to \$\{MAX_PEOPLE\} at a time/);
});

test("a card carries nothing until it is chosen, and the whole of it is the target", () => {
  const card = PICKER.slice(PICKER.indexOf("const personCard"), PICKER.indexOf("const selectedCard"));
  // The tick is drawn only when the card is chosen - an unchosen one has no box on it at all.
  assert.match(card, /\{active && \(\s*\n\s*<span aria-hidden="true" className="absolute right-1\.5 top-1\.5[\s\S]*?<CheckRounded/);
  assert.doesNotMatch(card, /border-slate-300 bg-white">\s*\n?\s*\{active && <CheckRounded/, "no empty box is drawn behind the tick");
  // Chosen: the card tints, its edge and the ring round the face go blue, the name follows.
  assert.match(card, /active \? "border-blue-300 bg-blue-50\/70" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"/);
  assert.match(card, /active \? "ring-2 ring-blue-400" : "ring-1 ring-slate-200"/);
  assert.match(card, /active \? "text-blue-800" : "text-slate-800"/);
  // The whole card is the button, so Enter and Space work where a press does.
  assert.match(card, /<button\s*\n\s*type="button"\s*\n\s*aria-pressed=\{active\}\s*\n\s*onClick=\{\(\) => toggle\(person\.id\)\}/);
  assert.match(card, /cursor-pointer/);
  assert.match(card, /focus:ring-2 focus:ring-blue-300/);
});

test("the footer is Cancel and Apply, and emptying the choice lives beside the people it empties", () => {
  const footer = PICKER.slice(PICKER.indexOf("<footer"));
  assert.doesNotMatch(footer, />\s*Clear\s*</, "the footer no longer carries Clear");
  assert.match(footer, /justify-end/, "the two actions sit together, with no gap where Clear was");
  assert.match(footer, /onClick=\{\(\) => requestClose\(\)\}[\s\S]*?>Cancel</);
  assert.match(footer, /onClick=\{\(\) => requestClose\(\(\) => onApply\(draft\)\)\}/);
  // Clear all is still in the column that lists the chosen people, and still only the draft.
  const aside = PICKER.slice(PICKER.indexOf("<aside"), PICKER.indexOf("</aside>"));
  assert.match(aside, /onClick=\{clearDraft\}[\s\S]*?>Clear all</);
  assert.match(PICKER, /const clearDraft = \(\) => \{ setDraft\(\[\]\); setRefused\(false\); \};/, "Clear all empties the draft and nothing else");
  // Clear and the per-person remove edit the draft only - a photo's own tick is never touched.
  assert.match(PICKER, /const clearDraft = \(\) => \{ setDraft\(\[\]\); setRefused\(false\); \};/, "Clear empties the draft and nothing else");
  assert.match(PICKER, /onClick=\{clearDraft\}/);
  assert.doesNotMatch(PICKER, /setGalleryImageSelection|photoSelections/, "the panel cannot reach a photo selection");
  // Ten is still the ceiling, and it is said where the choice is made.
  assert.match(PICKER, /togglePerson\(draft, personId\)/);
  assert.match(PICKER, /up to \{MAX_PEOPLE\} people at once/);
});

test("the People tab is always one grid of this shoot's photographs, never a card to open first", () => {
  // No card list is drawn here any more - All is the whole shoot, in the same grid.
  assert.doesNotMatch(PANEL, /FolderCardList/, "the People tab no longer sends the client through cards");
  assert.match(PANEL, /<SelectionPhotoGrid/, "the photos are the gallery's own grid, not a second one");
  // The heading names the chosen people - and, with the Scene filter in force, the scene - or the whole shoot.
  assert.match(PANEL, /const heading = \[filtering \? personLabel \|\| "Selected people" : "", inScene \? sceneName : ""\]\.filter\(Boolean\)\.join\(" · "\) \|\| "All Photos";/);
  // One listing over the shoot, with the chosen people as the only extra condition.
  assert.match(GALLERY, /listGalleryFolderImages\(token, sessionRef\.current, "all", \{[\s\S]*?personId: personIds\.length \? personIds\.join\(","\) : undefined[\s\S]*?folderGroupId/);
  // The grid is asked for whenever the tab is open, chosen or not.
  assert.match(GALLERY, /if \(homeTab !== "people" \|\| activeFolderId\) return undefined;/);
  assert.doesNotMatch(GALLERY, /loadPeopleFolders|peopleFolderCards/, "nothing counts folder cards for the People tab now");
});

test("people are numbered by how many photographs they are in, within the shoot being browsed", () => {
  const FACES = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "modules", "image-selection", "faces", "service.js"), "utf8");
  // Person 1 is whoever is in the most of them; ties are settled by which was found first, so the
  // order is decided rather than left to chance.
  assert.match(FACES, /\.sort\(\(left, right\) => right\.photoCount - left\.photoCount \|\| left\.found - right\.found\)/);
  assert.match(FACES, /\.map\(\(\{ id, photoCount \}, rank\) => \(\{ id, label: `Person \$\{rank \+ 1\}`, photoCount \}\)\)/);
  // The counts those ranks are built from are the scope's, which is the shoot in view.
  assert.match(GALLERY, /listGalleryPeople\(token, sessionRef\.current, undefined, \{ folderGroupId, page: 1, pageSize: RAIL_PEOPLE \}\)/);
  assert.match(GALLERY, /loadPeople\(activeFolderGroupId \|\| undefined\)/);
  // And the picker asks in the same scope, so its numbers agree with the rail's.
  assert.match(GALLERY, /const loadPickerPeople = useCallback\([\s\S]*?folderGroupId: activeFolderGroupId \|\| undefined/);
  // No second ordering on top of the ranking - it could only disagree with the numbers on screen.
  assert.doesNotMatch(FACES, /function sortPeople/);
});

test("the grid is not thrown away by a press that changes nothing, and never outlives its filter", () => {
  // Apply with the same people ticked is not a new question: every page read would be lost.
  assert.match(GALLERY, /if \(next\.length === activePersonIds\.length && next\.every\(\(id, index\) => id === activePersonIds\[index\]\)\) return;/);
  // Letting the last person go is not a view closing: the grid widens to the whole shoot.
  assert.doesNotMatch(GALLERY, /forgetPeoplePhotos/, "All is a listing, not an empty grid");
  assert.match(GALLERY, /if \(personId === null\) \{ setActivePersonIds\(\[\]\); return; \}/);
  // Another page keeps what is on screen and replaces it when it lands - the panel dims instead
  // of flashing a spinner on every press.
  assert.match(GALLERY, /setPeoplePhotos\(\(current\) => \(\{ \.\.\.current, loading: true, replacing: nextPage === 1 \}\)\);/);
  assert.doesNotMatch(GALLERY, /nextPage === 1 \? \{ items: \[\] \}/);
  // Moving to another shoot's selection setting drops the filter and what was known of its people:
  // the numbering is the project's but the counts are the shoot's.
  assert.match(GALLERY, /function changeShoot\(outerFolderId\) \{[\s\S]*?setActivePersonIds\(\[\]\);[\s\S]*?peopleKnown\.current\.clear\(\);/);
  // There are no folder cards under People to re-read after a pick; the grid is the tab.
  assert.doesNotMatch(GALLERY, /loadPeopleFolders/);
});

test("a photo ticked in the People grid is the same photo the folder view ticks", () => {
  // One write path, and every list holding that photo follows it - there is no People selection.
  assert.match(GALLERY, /setPeoplePhotos\(\(prev\) => \(\{ \.\.\.prev, items: prev\.items\.map\(\(item\) => \(item\.id === image\.id \? withSelection\(item\) : item\)\) \}\)\)/);
  assert.match(GALLERY, /setGalleryImageSelection\(token, sessionRef\.current, image\.id, nextSelected, target\)/);
  assert.doesNotMatch(GALLERY, /peopleSelection|peopleGallerySelection/, "no second selection state");
  // Clearing the filter widens the grid to the whole shoot; it never touches a pick.
  assert.match(GALLERY, /if \(personId === null\) \{ setActivePersonIds\(\[\]\); return; \}/);
});

test("only a replacing answer dims the grid - the next page is added below without dimming what is there", () => {
  // Every page loaded on scroll used to dim the whole grid and snap back: in a gallery of hundreds
  // of photos the client saw it flash faded on every scroll.
  assert.match(PANEL, /photosLoading && replacing && items\.length \? "opacity-60" : "opacity-100"/);
  assert.match(PANEL, /loading=\{photosLoading && \(!items\.length \|\| !replacing\)\}/);
  assert.match(GALLERY, /loading: false,\s*replacing: false,/);
  assert.match(GALLERY, /setPeoplePhotos\(\(current\) => \(\{ \.\.\.current, loading: false, replacing: false \}\)\);/);
});

test("a photo whose preview cannot be loaded shows a quiet tile, not a broken image or an endless pulse", () => {
  const LAZY = src("components", "image-selection", "client-gallery", "PublicGalleryLazyImage.js");
  assert.match(LAZY, /onError=\{\(\) => setFailedSrc\(src\)\}/);
  assert.match(LAZY, /setObjectUrl\(""\); setFailedSrc\(src\);/);
  assert.match(LAZY, /const failed = Boolean\(src\) && failedSrc === src;/);
  assert.match(LAZY, /title="Preview unavailable"/);
});
