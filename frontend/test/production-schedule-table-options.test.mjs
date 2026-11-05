import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Production → Schedule has the Table Options every table has: Manage Columns - which of the shoot's
 * own columns show, kept per viewer - and Compact view, the application's one density setting, which
 * draws the sheet a size smaller on top of its Zoom. The shared menu and dialog, not copies.
 */
const read = (file) => readFileSync(new URL(`../src/components/project-management/production/${file}`, import.meta.url), "utf8");
const PAGE = read("ProductionSchedulePage.js");
const VIEW = read("ProductionScheduleView.js");

test("the shoot's own four columns can be hidden; the Shoot and its plan always show", () => {
  assert.match(VIEW, /export const SCHEDULE_COLUMNS = SHOOT_COLUMNS\.map\(\(\{ id, label, extra = false \}\) => \(\{ id, label, extra \}\)\);/);
  for (const id of ["eventId", "event", "shootId", "date"]) assert.match(VIEW, new RegExp(`\\{ id: "${id}", label:`));
  assert.match(VIEW, /const columns = SHOOT_COLUMNS\.filter\(\(column\) => !hiddenColumns\.includes\(column\.id\)\)\.map\(\(column\) => \(\{ \.\.\.column, units: widths\[column\.id\] \|\| column\.units \}\)\);/);
  assert.doesNotMatch(VIEW, /\{SHOOT_COLUMNS\.map\(/, "the header and the rows both draw the columns kept, never all four");
});

test("the page offers the shared Table Options and Manage Columns, and keeps the choice per viewer", () => {
  assert.match(PAGE, /const tableMenu = <DataTableMoreMenu ariaLabel="Schedule options" onFreezeColumnsChange=\{\(count\) => updateLayout\(\{ freezeCount: count \}\)\} freezeCount=\{freezeCount\} onManageColumns=\{\(\) => setManagingColumns\(true\)\} onResetColumnOrder=\{customLayout \? resetLayout : undefined\} onToggleCompact=\{toggleCompact\} compact=\{compact\} \/>;/);
  // At the end of the sheet's header row from md up, as the tables draw it; in the top bar on a phone.
  assert.match(PAGE, /menu=\{tableMenu\}/);
  assert.match(PAGE, /<div className="md:hidden">\{tableMenu\}<\/div>/);
  assert.match(VIEW, /\{menu && <span className="sticky right-0 flex items-center bg-slate-100 px-1">\{menu\}<\/span>\}/);
  assert.match(PAGE, /usePreference\("table:production-schedule", \{\}\)/);
  assert.match(PAGE, /\{managingColumns && <ManageColumnsDialog/);
  // The optional columns are kept as the ones shown, the shoot's own four as the ones hidden.
  // Both answers kept, so an optional column ticked on stays on; one never chosen reads its default.
  assert.match(PAGE, /saved\.columnVisibility\?\.\[column\.id\] \?\? DEFAULT_SHOWN\[column\.id\]/);
  assert.match(PAGE, /hiddenColumns=\{hiddenIds\}/);
});

test("Compact view draws the sheet smaller than its Zoom", () => {
  assert.match(PAGE, /const drawnZoom = compact \? Math\.round\(Number\(zoom\) \* COMPACT_SCALE\) : zoom;/);
  assert.match(PAGE, /zoom=\{drawnZoom\}/);
});

test("each column is resized on its header's grip, in the sheet's own units, and kept per viewer", () => {
  assert.match(VIEW, /function ResizeGrip\(\{ label, units, scale, onResize \}\)/);
  assert.match(VIEW, /className="group\/resize absolute inset-y-0 right-0 z-20 flex w-3 cursor-col-resize/);
  // Pixels dragged become spacing units at the sheet's zoom, within a floor and a ceiling.
  assert.match(VIEW, /Math\.min\(MAX_UNITS, Math\.max\(MIN_UNITS, Math\.round\(units \+ \(x - startX\) \/ pxPerUnit\)\)\)/);
  assert.match(VIEW, /const widthStyle = \(units\) => \(\{ "--col-w": `calc\(var\(--spacing\) \* \$\{units\}\)` \}\);/);
  assert.match(VIEW, /onResize\("shoot", units, done\)/, "the Shoot column is resized too");
  assert.match(PAGE, /const savedWidths = useMemo\(\(\) => saved\.columnSizing \|\| \{\}, \[saved\]\);/);
  assert.match(PAGE, /if \(done\) \{ updateLayout\(\{ columnSizing: next \}\); setLiveWidths\(null\); \} else setLiveWidths\(next\);/);
  assert.match(PAGE, /const resetLayout = useCallback\(\(\) => setLayout\(\{\}\), \[setLayout\]\);/);
});

test("each shoot has its own ⋮ with Navigate to Projects, Pre Production and Production, by permission", async () => {
  assert.match(PAGE, /boardJumpItems\(\{\s*from: "schedule",/);
  assert.match(PAGE, /const SCHEDULE_JUMP_BOARDS = \["projects", "pre-production", "production"\];/);
  assert.match(PAGE, /can: hasPermission,/);
  assert.match(PAGE, /rowMenu=\{rowMenu\}/);
  // The board jumps follow "Use the same team as above", which is offered only on a plan the viewer may change.
  assert.match(PAGE, /const above = assign\?\.canAssign\(shoot\) \? teamAbove\(rowsShown, shoot\) : null;/);
  assert.match(PAGE, /\.\.\.shootMenu\(shoot\)\]/);
  assert.match(VIEW, /<OptionsMenu ariaLabel=\{`Actions for \$\{shoot\.shootId \|\| shoot\.shoot \|\| "shoot"\}`\} items=\{menuItems\} \/>/);
  // The helper itself: a board only where the project is on it and the viewer may open it.
  const { boardJumpItems } = await import("../src/lib/boardJumps.mjs");
  const boards = ["projects", "pre-production", "production"];
  const all = boardJumpItems({ from: "schedule", boards, eventId: "DBS-EVT-1", can: () => true, onJump: () => {} });
  assert.deepEqual(all[0].submenu.map((item) => item.label), ["Projects", "Pre Production", "Production"]);
  const onlyProduction = boardJumpItems({ from: "schedule", boards, eventId: "DBS-EVT-1", can: (module, feature) => feature === "Production", onJump: () => {} });
  assert.deepEqual(onlyProduction[0].submenu.map((item) => item.label), ["Production"]);
  assert.deepEqual(boardJumpItems({ from: "schedule", boards, eventId: "DBS-EVT-1", can: () => false, onJump: () => {} }), [], "nothing to offer, no ⋮ entry");
});

test("a vendor's status is changed on the line under them, with no pop-up, by whoever may change the plan", () => {
  // The status word under the vendor opens a small menu of Waiting and Confirmed, only where the seat is editable.
  assert.match(VIEW, /const vendorStatus = service\.vendorId && assign\.onChangeVendorStatus/);
  assert.match(VIEW, /items=\{VENDOR_STATUS_OPTIONS\.map\(\(option\) => \(\{/);
  assert.match(VIEW, /if \(option\.value !== status\) assign\.onChangeVendorStatus\(shoot, service, option\.value\)/);
  assert.doesNotMatch(VIEW, /Change status/, "no ⋮ entry on the service line");
  assert.doesNotMatch(PAGE, /VendorStatusDialog/, "no pop-up");
  // Saved at once: the seat with the vendor already on it and the answer chosen.
  assert.match(PAGE, /onChangeVendorStatus: saveVendorStatus/);
  assert.match(PAGE, /saveProductionSeat\(shoot\.shootRecordId, \{ serviceDefinitionId: service\.definitionId, \.\.\.seatPayload\(seatValue\(service\)\), vendorStatus: status \}\)/);
});

test("the schedule loads only the days chosen, opens on Upcoming, and draws a page at a time", () => {
  assert.match(PAGE, /defaultPreset: UPCOMING\.value/);
  assert.match(PAGE, /const response = await getProductionShoots\(window\);/);
  assert.match(PAGE, /if \(ticket !== latestLoad\.current\) return;/, "an older request never draws over a newer one");
  assert.match(VIEW, /const PAGE = 60;/);
  assert.match(VIEW, /const drawn = shoots\.slice\(0, limit\);/);
  assert.match(VIEW, /new IntersectionObserver/);
  // A seat is text until clicked; only then is its picker drawn, open.
  assert.match(VIEW, /\{picking\s+\? <Dropdown\s+hideLabel\s+defaultOpen/);
  assert.match(VIEW, /onClick=\{\(\) => setPicking\(true\)\}/);
});

test("the schedule's picker leaves out whoever is out on another shoot at that time, asked as it opens", () => {
  // Asked of the shoot's own read when a picker opens, kept until the schedule reloads.
  assert.match(PAGE, /busyAsked\.current\.set\(shootId, getProductionShoot\(shootId\)/);
  assert.match(PAGE, /busyAsked\.current\.clear\(\);/);
  assert.match(VIEW, /if \(!picking \|\| !busyFor\) return undefined;/);
  // The one already on the seat always stays.
  assert.match(VIEW, /option\.value === current \|\| \(!elsewhere\.has\(option\.value\) && !busy\?\.has\(option\.value\)\)/);
});

test("the schedule has a quick filter under each column, and the Production plan's one box picks people", () => {
  assert.match(VIEW, /\{filters && <FilterRow columns=\{columns\} shootUnits=\{shootUnits\} pin=\{pin\} filters=\{filters\} \/>\}/);
  assert.match(VIEW, /box\("person", "Production plan people", "People \(service or Assist\)"\)/);
  // A hidden column's box filters nothing, and Clear empties every box.
  assert.match(PAGE, /hiddenIds\.map\(\(id\) => \[id, EMPTY_SCHEDULE_FILTERS\[id\]\]\)/);
  assert.match(PAGE, /setQuickFilters\(EMPTY_SCHEDULE_FILTERS\);/);
  // Emptied by the boxes, the sheet stays, so the boxes stay to be changed.
  assert.match(PAGE, /: projectShoots\.length === 0/);
});

test("an EXT vendor's service is tinted by their answer - amber Waiting, green Confirmed - and nobody else's", () => {
  assert.match(VIEW, /const vendorTone = \(service\) => \(!service\.vendorId \? "" : service\.vendorStatus === "CONFIRMED" \? "shoot-chip shoot-hue-emerald" : "shoot-chip shoot-hue-amber"\);/);
  // Both the read-only block and the one the viewer may change carry it.
  assert.equal((VIEW.match(/tone=\{tone\}/g) || []).length, 2);
  // The status word takes the tint's own ink, not the menu's grey.
  assert.match(VIEW, /font-medium !text-inherit"/);
  // The whole service takes it: the name's line in the stronger shade, the person's box and the lines
  // round the block in the tint - not only the part under the name.
  assert.match(VIEW, /const TONED_HEADER = \{ borderColor: "var\(--shoot-chip-ring\)", backgroundColor: "var\(--shoot-chip-ring\)" \};/);
  assert.match(VIEW, /<span style=\{tone \? TONED_HEADER : undefined\}/);
  assert.equal((VIEW.match(/toned=\{Boolean\(tone\)\}/g) || []).length, 2);
});

test("the Assist is always on the sheet, picked from a multi-select and saved as the plan's team - never dragged", () => {
  // Shown whether or not anybody is on it, after the services.
  assert.match(VIEW, /<AssistBlock shoot=\{shoot\} assign=\{editable\} \/>/);
  assert.doesNotMatch(VIEW, /assist\.length > 0 && <Block name="Assist">/);
  // Mounted only once clicked, open, and saved once as it closes.
  assert.match(VIEW, /<MultiSelectField\n          hideLabel\n          defaultOpen/);
  assert.match(VIEW, /onClose=\{finish\}/);
  assert.match(VIEW, /if \(\[\.\.\.chosen\]\.sort\(\)\.join\("\|"\) !== before\) assign\.onSaveAssist\(shoot, chosen\);/);
  const assistBlock = VIEW.slice(VIEW.indexOf("function AssistBlock"), VIEW.indexOf("function ShootRow"));
  assert.doesNotMatch(assistBlock, /draggable|onDragStart/, "only a service's own person is dragged");
  // The plan's own save, so its rules hold: the Production Manager's, active people, nobody busy elsewhere.
  assert.match(PAGE, /await saveProductionPlan\(shoot\.shootRecordId, \{ team: \[\.\.\.new Set\(values\)\]\.map\(seatPayload\)/);
  assert.match(PAGE, /onSaveAssist: saveAssist,/);
});
