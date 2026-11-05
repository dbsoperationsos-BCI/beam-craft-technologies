import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The CRM's board view: the same leads the table holds, stood up in columns by status.
 *
 * A salesperson works a pipeline, and a table sorted by a status column is not a pipeline - it is a
 * list you have to read to find the shape of. The board is that shape: how many are waiting on a
 * follow-up, how many are interested and untouched, what is left to convert.
 *
 * **It is a view, not a second editor.** Nothing on it writes. A card opens the lead popup, which is
 * where a lead has always been changed, so there is one place that edits a lead and one set of rules
 * about remarks and reasons. Dragging a card drafts the target status into that popup - or, for the
 * two statuses that book a project rather than being written, raises the conversion dialog over it -
 * rather than moving the stage itself: a status change without a reason is the one thing this CRM
 * refuses everywhere else, and a board that quietly wrote one would be the hole in that rule.
 */

const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const BOARD = src("components", "sales", "CrmKanbanBoard.js");
const PAGE = src("components", "sales", "CRMPage.js");

test("the columns are the module's own statuses, in its own colours", () => {
  /*
   * Not a list of its own. A status is one word with one colour in this CRM - the pills, the table's
   * Status cell and the tabs all read from `LEAD_STATUS_OPTIONS` - and a board inventing its own
   * would be a fourth spelling to keep in step. The vertical decides which it offers, so
   * Converted & Followup appears on the one vertical that has it and nowhere else.
   */
  /*
   * The board **is** the vertical on this page - "Dum Dum", "Qua Qua" - which is what decides whether
   * Converted & Followup is offered as a column. The pipeline's own list is built from it, led by
   * Yet to connect; see the test above for why that one is prepended rather than part of the list.
   */
  assert.match(PAGE, /offered: boardStatusOptions\(board\)\.map\(\(option\) => option\.value\),/);
  // Which is the vertical's own list, re-ordered for the board and not replaced by one.
  assert.match(PAGE, /const options = leadStatusOptionsForVertical\(vertical\);/);
  assert.match(BOARD, /column\.className/, "a column no longer wears its status's own colour");
  assert.equal(/const (COLUMNS|STATUSES) = \[/.test(BOARD), false, "the board should not hold a status list of its own");
});

test("a card opens on a single press, so a keyboard and a phone can open one", () => {
  /*
   * It was double-click only, to match the table's rows, and that was wrong twice over: a `<button>`
   * fires `click` on Enter and Space, so a keyboard could focus a card and never open it, and a phone
   * has no double-click at all. The table's convention is not a precedent - a table row is not a
   * focusable button, and it has a row menu and a tap path of its own.
   */
  assert.match(BOARD, /onClick=\{\(\) => onOpenLead\?\.\(lead\)\}/);
  assert.equal(/onDoubleClick/.test(BOARD), false, "double-click only is keyboard-dead and touch-dead");
  assert.match(BOARD, /aria-label=\{`Open lead/);
});

test("the untouched leads have a column of their own", () => {
  /*
   * Without one the board describes almost nothing. A lead nobody has given a status to **displays** as
   * "Yet to connect" - `unsetStatusSql` on the server, `resolveLeadStatus` here, deliberately mirrored -
   * and on this studio's data that is 541 leads of 555. They match no status column, so a board built
   * from the status pills alone showed a handful of Converted cards and five empty lanes.
   *
   * It leads the board rather than sitting among the pills, because that is what it is: the queue of
   * work nobody has picked up, which is where a pipeline starts. It is not one of
   * `LEAD_STATUS_OPTIONS` - nobody *chooses* it, a lead is in it by not having been chosen for
   * anything - so it is prepended rather than added to that list.
   */
  /*
   * `pipelineColumns`, not `boardColumns` - this page already uses "board" for the vertical, and its
   * table's own columns are `boardColumns`. A third meaning of the word would be one too many.
   */
  assert.match(PAGE, /columns=\{pipelineColumns\}/);
  assert.match(PAGE, /const pipelineColumns = useMemo\(/);
  assert.match(PAGE, /yetToConnect: YET_TO_CONNECT_STATUS,/);
  /*
   * And **Unassigned** beside it, which is the one that actually emptied the board: the display CASE
   * checks `crm = ''` *before* it looks at the status, so a lead nobody has been given reads
   * "Unassigned" whatever its status - 543 of this studio's 556 leads. They matched no column, and an
   * administrator, who sees the whole register including every unowned lead, saw the least of all.
   *
   * It leads even Yet to connect: a lead nobody owns is further from being worked than one that is
   * owned and not yet rung.
   */
  /*
   * In the module's own colours for those two, not greys invented here: violet for Unassigned, which
   * `leadStatusTone` reserves for it because a lead nobody owns is the absence of anybody doing it
   * rather than a state of the work, and `#c3c7ce` for Yet to connect. The board, the table's status
   * dot and the pills then say the same status the same way.
   *
   * It also fixes them in the dark tiers. `bg-slate-600` and `bg-slate-800` are not in the theme's
   * vocabulary - `globals.css` repaints `bg-white`, `bg-slate-50/100/200` and the slate borders inside
   * `.app-shell`, and nothing else - so those two headings kept their literal near-black on a near-black
   * ground and vanished, beside six vivid ones.
   */
  /*
   * And it is shown **only to somebody who hands work out**. An individual gets the leads that are
   * theirs, so a column of leads belonging to nobody is a lane they can neither work nor clear - and on
   * this register it would be the biggest one on their board. The CRM already draws this line: the
   * server surfaces unowned leads to a reader who sees everything, "they are the ones who hand leads
   * out", and `managesAnyone` is the page's own form of that question.
   */
  assert.match(PAGE, /\[UNASSIGNED_STATUS, "bg-\[#7c3aed\] text-white border-\[#7c3aed\]"\],/);
  assert.match(PAGE, /showUnassigned: Boolean\(managesAnyone\),/);
  assert.match(PAGE, /\[board, managesAnyone, boardStatuses\]/);
  assert.match(PAGE, /\[YET_TO_CONNECT_STATUS, "bg-\[#c3c7ce\] text-slate-900 border-\[#c3c7ce\]"\],/);
  // And it filters like any other column, because the server filters on the **displayed** status and
  // that is the word it displays - so this needs nothing new on the server.
  assert.match(PAGE, /offered: boardStatusOptions\(board\)/);
});

test("the columns stand in the pipeline's order, not in order of size", () => {
  /*
   * A lead nobody owns, then one not yet rung, then the two states it is worked in, then the ways it
   * ends: `Unassigned, Yet to connect, Followup, Interested, CNA, Converted & Followup, Converted,
   * Rejected, Invalid`. Read left to right it is the question the board exists to answer - where a
   * lead goes next - which is not a question the biggest column answers.
   *
   * It was ordered by **how many each held**, largest first, re-sorted as the counts arrived. Two
   * faults in one: a pipeline read out of sequence tells you nothing about the pipeline, and the
   * board would not keep still - seven columns answer at seven moments, so it visibly re-sorted as
   * they landed and a column could move out from under somebody reading it.
   */
  // One list, shared with CRM Reports' lead boards (`lib/crmBoardOrder.mjs`).
  assert.match(PAGE, /const BOARD_STATUS_ORDER = CRM_BOARD_STATUS_ORDER;/);
  const ORDER = fs.readFileSync(new URL("../src/lib/crmBoardOrder.mjs", import.meta.url), "utf8");
  assert.match(ORDER, /export const CRM_BOARD_STATUS_ORDER = \["Followup", "Interested", "CNA", "Converted & Followup", "Converted", "Rejected", "Invalid"\];/);
  assert.match(PAGE, /offered: boardStatusOptions\(board\)\.map\(\(option\) => option\.value\),/);
  // Drawn as handed over: the page knows what a status means, the board knows only that they are columns.
  assert.match(BOARD, /\{columns\.map\(\(column\) => \(/);
  assert.equal(/const ordered = useMemo\(/.test(BOARD), false, "the board should not re-order what it is given");
  assert.equal(/counts\[/.test(BOARD), false, "nothing orders by the counts any more");
  assert.equal(/onCount/.test(BOARD), false, "so a column no longer reports its total upward");
});

test("the order is the board's own, and the status pills keep theirs", () => {
  /*
   * `LEAD_STATUS_OPTIONS` is the order a status is **offered** in - the pills in the lead popup and
   * the info panel, read by somebody choosing one. The board is read left to right as a pipeline.
   * Two different questions, so two orders, and reordering the pills to match would have changed
   * every screen that offers a status in order to arrange one that draws them as columns.
   */
  assert.match(PAGE, /const LEAD_STATUS_OPTIONS = \[\s*\n\s*\{ value: "CNA"/);
  /*
   * A status the board's list does not name is **not dropped** - it falls in after the named ones. A
   * status added to the module later would otherwise have no column at all and its leads would be
   * invisible here, which is the fault the Unassigned column was added to fix.
   */
  assert.match(PAGE, /return at === -1 \? BOARD_STATUS_ORDER\.length : at;/);
  // And the sort is stable, so those unnamed ones keep the order the module lists them in.
  assert.match(PAGE, /`sort` is stable/);
});

test("a column is keyed on its status, so a board that changes shape keeps its columns", () => {
  /*
   * Keyed on the status, which is what the column *is*. Keyed on its position, React would reuse each
   * slot for whatever status moved into it - and the board does change shape: the Unassigned column
   * appears once the reader turns out to manage somebody, and Converted & Followup only on Qua Qua.
   * Each of those shifts every column after it, and with positional keys each one would throw away
   * its leads, its paging and its scroll, and fetch them again.
   */
  assert.match(BOARD, /key=\{column\.value\}/);
});

test("a card is dragged to a column, and that opens the lead with the status drafted", () => {
  /*
   * The board still writes nothing itself. Dropping a card does not move a stage - it opens the lead
   * popup with the target status **drafted**, so the save that follows is the ordinary one: it refuses
   * without a remark, and the register can still say why the lead moved. The drag is a way of reaching
   * the editor with the answer already filled in, not a second way of changing a lead.
   */
  assert.match(BOARD, /draggable/);
  assert.match(BOARD, /onDragStart=/);
  assert.match(BOARD, /onDrop=/);
  assert.match(PAGE, /onDropLead=\{openLeadAtStatus\}/);
  // Through the same path a pill press takes, so the occasion echo, the cleared follow-up and the
  // custom-field write all happen exactly as they do when somebody chooses the status by hand.
  assert.match(PAGE, /draftPopupDetails\("leadStatus", /);
});

test("the board follows the card to the columns past its edge", () => {
  /*
   * The columns are a rail wider than the screen and a browser scrolls nothing for a drag of its own
   * accord, so the statuses off the right edge could not be reached at all: the card could be held
   * against the edge for as long as you liked and the board would not move.
   *
   * **The rule is the application's, not this board's.** `lib/dragEdgeScroll.mjs` already answers "how
   * fast should this scroll while something is held against its edge" for the data table's columns and
   * the Sidebar Layout editor's rows, on both axes, and a third answer written here would be a third
   * feel for one gesture. The board asks it for the `x` axis and owns only the frame loop that moves
   * the rail, which is how that file says to use it.
   *
   * **Fed from the document, not from the rail.** `dragover` on an element stops firing once the
   * pointer leaves it - and a little past the right-hand edge is exactly where somebody pushes when
   * they want more board, so the scroll froze at the point the gesture was asking for it hardest. That
   * is what made it work sometimes and not others. The shared rule already treats past-the-edge as
   * full speed, and reads the other axis to decide the pointer has genuinely left.
   */
  assert.match(BOARD, /import \{ edgeScrollSpeed \} from "@\/lib\/dragEdgeScroll\.mjs";/);
  assert.match(BOARD, /edgeScrollSpeed\(railRef\.current\.getBoundingClientRect\(\), event\.clientX, event\.clientY, \{ axis: "x" \}\)/);
  assert.match(BOARD, /document\.addEventListener\("dragover", followDrag\)/);
  assert.match(BOARD, /document\.removeEventListener\("dragover", followDrag\)/);
  assert.match(BOARD, /<div ref=\{railRef\}/);
  // No rule of its own left behind beside the shared one.
  assert.equal(/DRAG_EDGE_ZONE|DRAG_EDGE_SPEED/.test(BOARD), false, "the board should not keep an edge-scroll rule of its own");
  // One loop however fast it becomes, and it gives up at the end of the rail rather than queueing
  // frames that move nothing.
  assert.match(BOARD, /if \(running\) return undefined;/);
  assert.match(BOARD, /if \(rail\.scrollLeft === before\) return stopEdgeScroll\(\);/);
  /*
   * **Carried out of the browser, the scroll stops.** Outside the window no `dragover` arrives at all,
   * and the loop reads its speed off a ref - so the last speed the pointer asked for would have gone
   * on being obeyed, and a card taken out over the desktop would have left the rail scrolled hard
   * against its end for no reason the reader could see. `dragleave` with no `relatedTarget` is the
   * drag leaving the document, which is the one moment nothing else will say so.
   */
  assert.match(BOARD, /document\.addEventListener\("dragleave", leaveWindow\)/);
  assert.match(BOARD, /if \(!event\.relatedTarget\) stopEdgeScroll\(\);/);
});

test("a card is let go of however the drag ends", () => {
  /*
   * **Esc.** A browser cancels a drag on Esc without a drop, and the board has to notice: the card had
   * only the source element's own `dragend` to tell it, and that element is not always still there to
   * hear one - a column re-reads itself, the card is re-keyed, and the event lands on nothing. The drag
   * state then stays set with no card in the air: the column under the pointer keeps its ring, every
   * eligible column still believes a drop is coming, and the rail goes on scrolling itself at the edge.
   * Nothing on screen says how to get out of it, because there is nothing left to drop.
   *
   * So the end of a drag is heard on the **window**, where it arrives whatever it started on and
   * whatever happened to that node since - a cancel, a drop anywhere, a drag let go of outside the
   * window. Esc is answered as well, for the browsers that deliver the key, and releasing twice is the
   * same as releasing once.
   */
  assert.match(BOARD, /window\.addEventListener\("dragend", release\)/);
  assert.match(BOARD, /window\.addEventListener\("drop", release\)/);
  assert.match(BOARD, /removeEventListener\("dragend", release\)/);
  /*
   * Escape through `useEscapeKey`, not a listener of the board's own: there is one listener and a
   * stack behind that hook, and an overlay that listens for itself is how one press came to close two
   * things. Registered on `carrying`, so the board is on the stack only while a card is in the air and
   * Escape means whatever it meant before as soon as the card is down.
   */
  assert.match(BOARD, /import useEscapeKey from "@\/components\/shared\/useEscapeKey";/);
  assert.match(BOARD, /useEscapeKey\(release, carrying\);/);
  // Releasing clears both what is in the air and the ring the column under it was wearing.
  assert.match(BOARD, /const release = useCallback\(\(\) => \{ setDragging\(null\); setHoveredColumn\(null\); \}, \[\]\);/);
});

test("a card is not something another application can accept", () => {
  /*
   * A drag has to carry something - some browsers refuse to start one with nothing on the transfer
   * object - and it used to carry the enquiry id as `text/plain`, which is the one format every other
   * application on the machine accepts. So a card taken out of the browser could be dropped into a
   * document, an email or a chat window as a bare id: not a disaster, but not something a reader asked
   * for either, and it makes the drag look like it is meant to leave.
   *
   * A type only this board speaks satisfies the browser and is refused everywhere else, so a card
   * carried outside has nowhere to land and comes back. The board's own drop reads none of it - what is
   * in the air is React state here, not the transfer object - so nothing depends on the format.
   *
   * The ghost under the pointer is the operating system's and cannot be called back; what this decides
   * is that letting go out there does nothing at all.
   */
  assert.match(BOARD, /setData\("application\/x-dbs-crm-lead"/);
  assert.equal(/setData\("text\/plain"/.test(BOARD), false, "a card must not be droppable into another application");
});

test("a lead nobody owns is dragged to a status, and that asks who it is for", () => {
  /*
   * Those cards were held back at first, and the reasoning was sound as far as it went:
   * `resolveLeadStatus` answers **Unassigned** for a lead with no CRM before it looks at any status,
   * so a status dropped onto one was stored and never shown - the dialog opened with no pill lit,
   * claiming nothing while appearing to have done something.
   *
   * Withholding the gesture was the wrong answer to that. What such a lead is missing is an **owner**,
   * and the lead popup has no Assign To field at all - the only control in this module that picks an
   * employee is Add Lead's. So the drop opens that form on the lead it already is: its own details,
   * its own enquiry id, the dropped status chosen, and Assign To waiting.
   *
   * Left unassigned, the card stays in Unassigned. That needs no rule of its own, which is the point:
   * the board already reads any lead with no CRM as unassigned whatever its status says.
   */
  assert.equal(/const canDrag/.test(BOARD), false, "every card is dragged now, the unowned ones included");
  assert.match(BOARD, /draggable\n/, "and it is not conditional");
  assert.match(PAGE, /if \(resolveLeadStatus\(lead\) === UNASSIGNED_STATUS\) \{\s*\n\s*openAssignLeadRef\.current\(lead\.id, status\);/);
});

test("assigning an unassigned lead writes over it rather than adding another", () => {
  /*
   * The form's other two jobs both **create**: a new lead, and placing a call (which has no lead
   * behind it until that moment). This one does not - the lead exists and holds its own enquiry id,
   * so a POST would mint a second one against the same client. That is the whole reason the mode
   * exists rather than the form simply being opened with values in it.
   */
  assert.match(PAGE, /const \[assigningLeadId, setAssigningLeadId\] = useState\(""\);/);
  assert.match(PAGE, /const saved = assigning\s*\n\s*\? await apiRequest\(`\/api\/sales\/crm-leads\/\$\{encodeURIComponent\(assigning\)\}`, \{ method: "PUT"/);
  // And its own arrival time stands: a lead arrived when it arrived, and being given an owner later
  // is not its arrival.
  assert.match(PAGE, /\.\.\.\(placing \|\| assigning \? \{\} : \{ addedTime: studioClockTime\(\), createdDate: studioDateKey\(\) \}\),/);
  // It opens on the lead as the register holds it, fetched rather than hunted for among the rows -
  // the board pages one column at a time and the table stands down behind it.
  assert.match(PAGE, /function leadFormFromLead\(lead = \{\}, details = \{\}, status = ""\)/);
  assert.match(PAGE, /setAddLeadForm\(leadFormFromLead\(leadFromRecord\(record\), record\.details \|\| \{\}, status\)\);/);
});

test("the form offers every status while assigning, and says which lead it is on", () => {
  /*
   * A card can be dragged out of Unassigned onto **any** column the board draws - CNA, Invalid and
   * Rejected among them - and the form hides those three when a lead is being typed from nothing.
   * Hiding the pill for the column it was dropped on would leave the form holding a status it does
   * not show, which is a value saved without having been seen.
   */
  assert.match(PAGE, /const hidden = assigningLeadId \? \[\] : assigningCallId \? \["CNA", "Invalid"\] : \["CNA", "Invalid", "Rejected"\];/);
  /*
   * And it names the lead, because a form that opens filled in reads as a new lead somebody half
   * typed unless it says whose details these are - with the enquiry id, which is the part that cannot
   * be mistaken for another client.
   */
  assert.match(PAGE, /Assigning <span className="font-medium text-slate-800">\{addLeadForm\.name \|\| assigningLeadId\}<\/span>/);
  // Said plainly, so leaving Assign To empty is a choice rather than a surprise.
  assert.match(PAGE, /left empty it stays unassigned\./);
});

test("a card opens the lead the way a link does, the table being unloaded behind the board", () => {
  /*
   * The table stands down while the board is shown, so `leads` is **empty** - and the popup resolves
   * the lead it shows out of that array. A card therefore opened nothing at all on a board reached
   * directly, which is what a remembered view means every morning; switching to the board from the
   * table in the same session left the rows loaded and it worked, which is why it looked intermittent
   * rather than broken. Where a lead was found, its *details* still were not - they are the table
   * page's too - so the status pills, which read the status off the details, came up empty on the one
   * screen whose whole point was to open a lead at a status.
   *
   * So a card opens a lead the way the Contacts directory does: `openLinkedLead` fetches that lead and
   * its details on their own and hands the popup both. It is the path written for exactly this - "a
   * lead that is not among the rows on screen" - and it keeps the table's own state untouched.
   */
  assert.match(PAGE, /const openBoardLead = useCallback\(\(lead\) => \{[\s\S]{0,200}?openLinkedLeadRef\.current\(lead\.id\);/);
  assert.match(PAGE, /onOpenLead=\{openBoardLead\}/);
  assert.match(PAGE, /openLinkedLeadRef\.current\(lead\.id\);[\s\S]{0,300}?setPendingDropStatus\(\{ id: lead\.id, status \}\);/);
});

test("a card dropped on Converted opens the lead at it, and the footer decides the project", () => {
  /*
   * Converted and Converted & Followup are not written like a status - they **book a project** - which
   * is why a drop was refused on them at first. But refusing made the two columns somebody most wants
   * to drag a lead into the two they could not, and on a Qua Qua board they are the far end of the
   * rail as well.
   *
   * They draft like every other status now, and the lead opens on the popup with the status chosen, so
   * the required fields and the remark are asked for in the one place that asks for them. The **footer**
   * decides what happens next: the save writes the lead as Converted - marked but not booked, which is
   * a state this register has always allowed - and then asks whether to open Create Project on it.
   *
   * It matters that the save comes first and the question second. Raising the question before the write
   * meant the details just filled in were not saved by the dialog that answered it, and a reader who
   * said "not now" could lose them; and a lead marked Converted with no project is somebody's work
   * either way, so it is written before anything is offered.
   */
  // Unassigned and Project deleted are read, never chosen, so neither takes a drop; every other column does.
  assert.match(PAGE, /const canDropAt = useCallback\(\(status\) => status !== UNASSIGNED_STATUS && status !== PROJECT_DELETED_STATUS\s*\n\s*&& \(status === YET_TO_CONNECT_STATUS \|\| leadStatusOptionsForVertical\(board\)\.some\(\(option\) => option\.value === status\)\), \[board\]\);/);
  // One branch, not two: every status a drop can carry is drafted the same way.
  assert.match(PAGE, /draftPopupDetails\("leadStatus", pendingDropStatus\.status\);/);
  assert.equal(
    /setConvertLead\(\{ lead: leadPopup, status: pendingDropStatus\.status \}\)/.test(PAGE),
    false,
    "a dropped convert status should reach the footer, not raise the conversion dialog on open",
  );
  /*
   * Asked after the write has gone through, and on the status this save **chose** rather than the one
   * the lead happens to hold: read off the saved status it would ask again every time somebody saved a
   * remark against a lead that converted weeks ago - a dialog standing in the way of ordinary work. A
   * drafted status is one somebody picked in this popup, which is what a dropped card leaves behind.
   */
  assert.match(PAGE, /if \(opensProjectFor\(forcedStatus \|\| popupEdits\.details\.leadStatus \|\| ""\)\) \{/);
  assert.match(PAGE, /setConvertedAsk\(\{ id: leadPopup\.id, name: leadPopup\.name \|\| leadPopup\.id, status: requestedStatus \}\);/);
  assert.match(PAGE, /confirmLabel="Open Create Project"/);
  assert.match(PAGE, /cancelLabel="Not now"/);
  // Only the confirm navigates; "Not now" leaves a lead that is converted and not yet booked.
  assert.match(PAGE, /router\.push\(convertProjectUrl\(ask\.id, ask\.status\)\)/);
});

test("the columns that cannot take a drop refuse it", () => {
  /*
   * Two, each for its own reason:
   *
   *   * **Unassigned** is not a status anybody sets - it is what the Status column prints when a lead
   *     has no CRM at all - so writing it as one would be a lie about the record.
   *   * The card's **own column**, which is not a move.
   *
   * Converted and Converted & Followup are **not** on that list any more; they take the drop and route
   * it to the conversion dialog, which the test above this one covers.
   */
  assert.match(PAGE, /const canDropAt = useCallback\(/);
  assert.match(PAGE, /status !== UNASSIGNED_STATUS && status !== PROJECT_DELETED_STATUS\s*\n\s*&& \(status === YET_TO_CONNECT_STATUS \|\| leadStatusOptionsForVertical\(board\)/);
  assert.match(BOARD, /canDropAt\?\.\(column\.value\)/);
  // Decided on the board, which is the only part that knows what is in the air.
  assert.match(BOARD, /dragging\.status !== column\.value && canDropAt\?\.\(column\.value\)/);
  /*
   * `dragleave` fires on the way into a child as well, so the hover is only given up when the pointer
   * has genuinely left the column - otherwise the ring flickers off every time it crosses a card.
   */
  assert.match(BOARD, /currentTarget\.contains\(event\.relatedTarget\)/);
});

test("nothing on the board writes", () => {
  /*
   * A card opens the lead popup - the one editor - rather than changing anything itself. The board
   * imports no service at all: what it draws arrives through `fetchColumn`, which the page builds
   * from the same query the table runs.
   */
  assert.equal(/from "@\/services\//.test(BOARD), false, "the board must not call the API itself");
  assert.match(BOARD, /onOpenLead\?\.\(lead\)/);
  /*
   * Dragging is allowed now and writing still is not - the two are not the same rule. A drop opens the
   * lead popup with the status drafted, so the save that follows is the ordinary one and still refuses
   * without a remark. What must stay absent is any write from the board itself.
   */
  assert.equal(/apiRequest|fetch\(/.test(BOARD), false, "the board must not write anything itself");
  assert.match(BOARD, /onDropLead\?\.\(dragging\.lead, column\.value\)/);
});

test("a column grows by scrolling, through the shared hook", () => {
  /*
   * Nothing to press. `shared/useInfiniteScroll` is what every other paged list here grows by, and it
   * already answers the things a hand-rolled scroll listener gets wrong: it observes against the
   * element that actually scrolls rather than the window - a sentinel below the fold of an inner pane
   * is otherwise clipped away and the next page is only asked for once the reader has run out - and it
   * guards against asking twice by only asking again once more items have arrived, which also stops an
   * empty page being requested for ever.
   *
   * `rootRef` is the column's own scroller, because each column scrolls inside itself; `resetKey` is
   * the status, so one column's paging is not mistaken for another's.
   */
  assert.match(BOARD, /useInfiniteScroll\(\{/);
  assert.match(BOARD, /hasMore: /);
  assert.match(BOARD, /rootRef: scrollerRef/);
  assert.match(BOARD, /resetKey: `\$\{column\.value\}-\$\{period\}-\$\{search\}`/);
  // The sentinel is drawn only while there is another page to read.
  assert.match(BOARD, /ref=\{sentinelRef\}/);
  /*
   * Asserted against the **control**, not the phrase: "Load more" is named in the comments that explain
   * what the sentinel replaced, and a test that reads prose as markup fails on its own explanation.
   */
  assert.equal(/>\s*Load more\s*</.test(BOARD), false, "the button it replaces should be gone");
  assert.equal(/onClick=\{\(\) => void load\(leads\.length\)\}/.test(BOARD), false, "nothing is pressed to page now");
});

test("each column pages itself, and says how many it is part of", () => {
  /*
   * Seven columns are seven questions, so each asks its own and keeps its own offset: a column with
   * four leads does not wait on the one with four hundred, and Load more on one does not disturb the
   * rest. The count in the header is that column's own `total`, which its first page already carried -
   * the page endpoint's `counts` answer for the **tabs**, not for the statuses, so it cannot serve here.
   */
  assert.match(BOARD, /fetchColumn\(column\.value, /);
  assert.match(BOARD, /response\?\.total/);
  assert.match(BOARD, /leads\.length < total/);
});

test("the page hands the board a fetcher, and keeps the query in one place", () => {
  /*
   * The board is dumb, the way the lead popup is: every narrowing the table already honours - the data
   * scope, the branch reach, the vertical, the search box, the column filters, the date range and the
   * My Leads switch - comes free because the page builds the query exactly as it does for the table and
   * only adds the column's status to it.
   */
  assert.match(PAGE, /fetchColumn=\{fetchLeadColumn\}/);
  /*
   * **One builder, not two.** The table's page and a board column ask the same question of the same
   * endpoint and differ only in the view, the status and the paging. Written twice, a parameter added
   * for the table would quietly stop reaching the board, and the two would describe different sets of
   * leads while claiming to be the same board.
   */
  assert.match(PAGE, /const leadPageQuery = useCallback\(/);
  /*
   * **`status`**, which is the column's own id - not `leadStatus`, which is what the lead object calls
   * the field. The server filters by column id, mapping `status` to `statusDisplaySql` so a filter
   * matches the value the Status cell actually shows. Keyed on anything else it matches nothing and is
   * silently ignored, which is how every column came back holding the whole unfiltered page.
   */
  // The column's status (and its own search box, as `_search`) added on top of the filter row.
  assert.match(PAGE, /const columnFilters = \{ \.\.\.\(leadStatus \? \{ status: \[leadStatus\] \} : \{\}\), \.\.\.\(search\.trim\(\) \? \{ _search: search\.trim\(\) \} : \{\}\) \};/);
  assert.match(PAGE, /filters: JSON\.stringify\(Object\.keys\(columnFilters\)\.length \? \{ \.\.\.\(appliedFilters \|\| \{\}\), \.\.\.columnFilters \} : \(appliedFilters \|\| \{\}\)\)/);
  assert.match(PAGE, /const query = leadPageQuery\(\{ view: activeTab, offset, limit, appending \}\);/);
  /*
   * And the fetcher is **memoised on what the query is made of**. As a plain function it was rebuilt on
   * every render of this page - a keystroke in the search box, the sync timer, opening a lead - and each
   * new identity re-ran every column's effect, refetching all seven from offset zero and throwing away
   * every Load more somebody had pressed.
   */
  assert.match(PAGE, /const fetchLeadColumn = useCallback\(/);
  assert.match(PAGE, /\}, \[leadPageQuery, activeTab\]\);/);
  /*
   * And a write re-reads the columns. The table's own read, its poller and its reload listener all stand
   * down on the board - nothing is fetched for a table nobody is looking at - so without this a lead whose
   * status had just changed would sit in its old column while the screen claimed to be current.
   */
  assert.match(PAGE, /if \(view !== "table"\) return undefined;/);
  assert.match(PAGE, /refreshKey=\{leadsChangedAt\}/);
  assert.match(BOARD, /\}, \[load, refreshKey\]\);/);
});

test("a card is given a lead, not the record it arrived in", () => {
  /*
   * The endpoint answers **records** - `{ lead, details }` - and the table maps every one through
   * `leadFromRecord` before it draws it. Handing the board `response.data` untouched gave each card a
   * wrapper instead of a lead, so `name`, `id` and the number were all undefined: every card read
   * "Client_Name", had no enquiry id and no number, and shared a React key of `undefined`.
   *
   * Mapped in the page, where `leadFromRecord` already lives, so the board stays dumb and a card and a
   * table row are guaranteed to be showing the same values of the same fields.
   */
  assert.match(PAGE, /data: \(Array\.isArray\(response\?\.data\) \? response\.data : \[\]\)\.map\(leadFromRecord\)/);
});

test("the board learns whether this reader has a team, as the table does", () => {
  /*
   * `managesAnyone` decides two things: whether the My Leads switch is offered at all, and - through
   * `showingAllLeads` - what the board asks for when it has not been answered yet. It starts `null`
   * and was only ever set from the **table's** reply, so once the table stopped fetching behind the
   * board it was never set there.
   *
   * What that cost: `showingAllLeads` collapses to `!mineOnly` while it is `null`, so a reader whose
   * stored My Leads was on had every column ask `mine=true` - and an administrator, who is rarely the
   * named CRM on any lead, got an empty board. The switch is hidden while `managesAnyone` is falsy, so
   * there was no way to turn it off either. A dead end reached by opening a view.
   *
   * The reply carries it on both paths, so the board reads it off its own columns.
   */
  assert.match(PAGE, /if \(response\?\.managesAnyone !== undefined\) setManagesAnyone\(Boolean\(response\.managesAnyone\)\);[\s\S]{0,600}?data: \(Array\.isArray/);
});

test("the answer about the reader's team is in hand before the columns are built", () => {
  /*
   * `pipelineColumns` reads `managesAnyone` to decide whether Unassigned is offered, which makes the
   * order of the two declarations part of whether the page renders at all. A `const` is unreachable
   * until its own line runs, and a `useMemo`'s dependency array is read **during** the render - so with
   * the state declared below the memo, every render of the CRM threw "Cannot access 'managesAnyone'
   * before initialization" and the page drew nothing. Not a board bug: the whole screen, table view
   * included.
   *
   * Nothing else catches it. The tests here read the source, and a dead zone is a runtime fault; the
   * build compiles it happily, because the code is legal and only the order is wrong. So the order is
   * asserted.
   */
  const state = PAGE.indexOf("const [managesAnyone, setManagesAnyone] = useState(null);");
  const memo = PAGE.indexOf("const pipelineColumns = useMemo(");
  assert.notEqual(state, -1);
  assert.notEqual(memo, -1);
  assert.ok(state < memo, "managesAnyone must be declared above the memo whose dependencies read it");
});

test("the view is remembered, and the table is still there", () => {
  // Remembered per person like the board, the tab and My Leads: somebody who works in columns should
  // not switch to them every morning.
  assert.match(PAGE, /usePreference\("tab:crm-view", "table"\)/);
  assert.match(PAGE, /<CrmKanbanBoard/);
  /*
   * The switch is a dropdown like the board switch beside it, next to My Leads - both answer "what am
   * I looking at" rather than doing something to the leads. Not offered on the Calls board: its rows
   * are calls, which have three outcomes rather than a lead's statuses, so there are no columns.
   */
  assert.match(PAGE, /const VIEW_OPTIONS = \[\{ value: "table", label: "Table" \}, \{ value: "board", label: "Board" \}\];/);
  assert.match(PAGE, /\{board !== CALLS_BOARD && <Dropdown\n\s+mode="switch"\n\s+ariaLabel="How the leads are shown"/);
  // Changing view drops the selection, as switching board and tab already do.
  assert.match(PAGE, /setView\(next\);[\s\S]{0,400}?clearSelection\(\);/);
});

test("an empty column says so in the middle of itself", () => {
  /*
   * Tucked against the top-left it read as a stray line of text under the heading, which on a column
   * that is otherwise a tall empty frame looks like something failed to draw. Centred, the sentence is
   * plainly the column's answer about itself.
   */
  assert.match(BOARD, /flex h-full items-center justify-center/);
  assert.match(BOARD, /No leads at this status\./);
});

test("a column has an edge, not just a fill", () => {
  /*
   * It was a fill and nothing else - `bg-slate-50`, which the dark tiers repaint to `#0f172a` against a
   * shell ground of `#020617`. Two tones that close read as one: the columns had no edges at all, so a
   * dark board was a row of coloured headings floating over a single surface with no sign of where one
   * column ended and the next began.
   *
   * A border fixes it in both directions, because `border-slate-200` is in the theme's vocabulary: a
   * quiet grey line on white, `#334155` on dark - the same line the cards inside already wear. The fill
   * stays, so the column still reads as a surface where there is light to see it by.
   */
  /*
   * Only the column **under the pointer** lifts - not every column that would accept the card. Marking
   * all of them lit six or seven lanes at once the moment a drag began, which says "any of these" when
   * the question a dragger is asking is "this one?". Eligibility decides whether a drop is *possible*;
   * hover decides what is *shown*.
   */
  assert.match(BOARD, /isOver \? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200"/);
  assert.match(BOARD, /const isOver = takesDrop && hoveredColumn === column\.value;/);
  // Clipped, or the heading's square corners sit proud of the rounded border beneath them.
  assert.match(BOARD, /overflow-hidden rounded-xl border bg-slate-50/);
});

test("it fits a phone", () => {
  // The columns scroll sideways inside the board's own container; the page never scrolls as a page.
  assert.match(BOARD, /overflow-x-auto/);
  /*
   * `min-w-0` on the board root: a flex child defaults to `min-width: auto`, so without it the board
   * grows past its container instead of scrolling when the info panel opens beside it. The columns
   * themselves are a fixed rem width and `shrink-0`, which is what a scrolling lane is.
   */
  assert.match(BOARD, /flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto/);
  assert.match(BOARD, /w-\[18rem\] shrink-0/);
  assert.equal(/w-\[\d+px\]/.test(BOARD), false, "no fixed pixel widths");
});
