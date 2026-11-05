import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Attendance Register, laid out as Image Selection's dashboard is: Refresh and Send in the
 * header, a caption line, four headline cards that filter the table below them, and Today's
 * Attendance - the shared DataTable, one row per person, with its filter row, sorting and a footer
 * count. The login location is the district and state.
 */

const PAGE = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRegisterPage.js"), "utf8");
const face = PAGE.slice(PAGE.indexOf("function RegisterFace("), PAGE.indexOf("function CelebrationsNotice("));
const list = PAGE.slice(PAGE.indexOf("function TodaysAttendance("), PAGE.indexOf("/**\n * The photograph the person checked in with") > -1
  ? PAGE.indexOf("/**\n * The photograph the person checked in with")
  : PAGE.indexOf("function RegisterFace("));
const pageBody = PAGE.slice(PAGE.indexOf("export default function AttendanceRegisterPage("));

test("the page is the Image Selection dashboard's structure: header actions, cards, then the list", () => {
  // The header keeps what acts on the page: Send, and no Refresh.
  assert.doesNotMatch(PAGE, /Refresh attendance register|RefreshRounded/);
  // Send is hidden for now, behind one switch; the report behind it is kept.
  assert.match(PAGE, /const SHOW_SEND = false;/);
  assert.match(pageBody, /actions=\{SHOW_SEND \? <Button type="button" variant="primary" onClick=\{\(\) => setSending\(true\)\}>Send<\/Button> : null\}/);
  assert.match(PAGE, /function AttendanceReportDialog\(/);
  // The tinted canvas, then the headline cards, the birthdays notice and the list, in that order -
  // no caption line and no WhatsApp status line above the cards.
  const at = (text) => pageBody.indexOf(text);
  assert.ok(at('className="dashboard-canvas') > -1, "the dashboard canvas is gone");
  assert.ok(at("<HeadlineCards") > -1 && at("<HeadlineCards") < at("<CelebrationsNotice") && at("<CelebrationsNotice") < at("<TodaysAttendance"),
    "the order is not cards, birthdays, list");
  assert.doesNotMatch(PAGE, /\{caption\}|function ReportGroupStatus\(|<ReportGroupStatus|Every active employee across all branches/);
  // Today, across every branch, and no filters but the cards and the search.
  assert.match(PAGE, /getAttendanceRegister\(\{ date, branchId \}\)/);
  assert.match(PAGE, /const \[date\] = useState\(\(\) => isoDate\(new Date\(\)\)\);/);
  assert.match(PAGE, /const branchId = "";/);
  assert.doesNotMatch(PAGE, /label="Status"|label="Date"|label="Branch"|<DateField|<Dropdown/);
  // The boxes, tiles and cards it replaced are gone.
  assert.doesNotMatch(PAGE, /function RegisterGroup\(|function SummaryTile\(|function RegisterCard\(/);
});

test("the headline cards are Present, Available, Leave, Permissions, Break and Irregularities, filters on the list that let go when pressed again", () => {
  // The component alone, to its closing brace - not the caption line further down, which says "as of".
  const cardsAt = PAGE.indexOf("function HeadlineCards(");
  const cards = PAGE.slice(cardsAt, PAGE.indexOf("\n}", cardsAt));
  // Two cards; Leave counts everybody away - approved or not - so there is no On leave or Absent card,
  // and no Employees card.
  assert.match(PAGE, /label: "Present", count: \(summary\) => summary\.present/);
  assert.match(PAGE, /label: "Leave", count: \(summary\) => Number\(summary\.absent \|\| 0\) \+ Number\(summary\.onLeave \|\| 0\)/);
  assert.doesNotMatch(PAGE, /label: "On leave"|label: "Absent"|label: "Employees"/);
  // Permissions: inside a permission's window right now. Break: on a break right now - one already over does not count.
  assert.match(PAGE, /label: "Permissions", count: \(summary\) => summary\.onPermission, dot: "bg-amber-500", matches: \(row\) => Boolean\(row\.onPermission\)/);
  assert.match(PAGE, /row\.original\.onPermission && <span[^>]*>On permission<\/span>/);
  assert.match(PAGE, /label: "Break", count: \(summary\) => summary\.onBreak, dot: "bg-sky-500", matches: \(row\) => Boolean\(row\.onBreak\)/);
  // Available: working right now, as the server decides it.
  assert.match(PAGE, /label: "Available", count: \(summary\) => summary\.available, dot: "bg-indigo-500", matches: \(row\) => Boolean\(row\.available\)/);
  assert.deepEqual([...PAGE.matchAll(/\{ view: "[a-z]+", label: "([^"]+)"/g)].map((match) => match[1]), ["Present", "Available", "Leave", "Permissions", "Break", "Irregularities"]);
  // Irregularities: the fixed-shift people Absent that day, counted off the rows - the Irregularities card's Today tab.
  assert.match(PAGE, /const isIrregular = \(row\) => row\.status === "Absent" && !row\.flexible;/);
  assert.match(PAGE, /label: "Irregularities", count: \(summary, rows\) => rows\.filter\(isIrregular\)\.length, dot: "bg-orange-500", matches: isIrregular/);
  assert.match(cards, /<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">/);
  // On a phone: Present across the row, then Available and Break, then Permissions and Leave, then Irregularities across the row.
  const phone = Object.fromEntries([...PAGE.matchAll(/label: "([^"]+)",[^\n]*phone: "([^"]+)"/g)].map((match) => [match[1], match[2]]));
  assert.deepEqual(phone, { Present: "max-sm:col-span-2", Available: "max-sm:order-1", Leave: "max-sm:order-4", Permissions: "max-sm:order-3", Break: "max-sm:order-2", Irregularities: "max-sm:order-5 max-sm:col-span-2" });
  assert.match(cards, /\$\{card\.phone\}/);
  assert.match(cards, /aria-pressed=\{pressed\}/);
  assert.match(cards, /onClick=\{\(\) => onViewChange\(pressed && card\.view \? null : card\.view\)\}/);
  // Two abreast on a phone and a tablet, all four in a row from a laptop up, compact on a phone.
  assert.match(cards, /px-2\.5 py-2 [^"`]*sm:px-4 sm:py-4/);
  // No trend arrows, and no "as of now" in the corner.
  assert.doesNotMatch(cards, /as of/);
  assert.doesNotMatch(cards, /TrendBadge|TrendingUp|TrendingDown/);
});

test("Today's Attendance is the shared table, narrowed by the pressed card, and counts what is left", () => {
  assert.match(list, /<DataTable\b/);
  assert.match(list, /features=\{\{ filtering: true, sorting: true, infiniteScroll: \{ pageSize: 15 \} \}\}/);
  assert.match(list, /className="max-h-110"/);
  assert.match(list, /onVisibleRowsChange=\{setStats\}/);
  // The pressed card narrows the rows the table is handed.
  assert.match(list, /\.filter\(\(row\) => inView\(row, view\)\)/);
  assert.match(PAGE, /const inView = \(row, view\) => !view \|\| Boolean\(VIEWS\.find\(\(entry\) => entry\.view === view\)\?\.matches\(row\)\);/);
  // The columns, in order.
  const ids = [...list.matchAll(/\{ id: "([a-z]+)", header: "([^"]+)"/g)].map((match) => match[2]);
  assert.deepEqual(ids, ["Employee", "Login location", "Status", "Branch", "Login", "Logout", "Worked", "Permission", "Break"]);
  // Each new card says so plainly when it narrows the table to nobody.
  assert.match(list, /permission: "Nobody is on a permission right now\.",/);
  assert.match(list, /break: "Nobody is on a break right now\.",/);
  // The footer counts what survives both narrowings, and names the card.
  assert.match(list, /`\$\{matched\} of \$\{rows\.length\} employees\$\{view \? ` · \$\{label\}` : ""\}`/);
  assert.match(list, /aria-label=\{`Show all employees instead of \$\{label\}`\}/);
  // Said plainly when a card narrows it to nobody - on leave on a day off included.
  assert.match(list, /absent: dayOff \? `Today is \$\{dayOff\} - nobody is expected\.` : "Nobody is on leave today\."/);
  // A row picks out, and opens nothing.
  assert.doesNotMatch(list, /onRowDoubleClick/);
});

test("a row says who, how the day stands, when, and where - with a short day in red", () => {
  assert.match(list, /<RegisterFace row=\{row\.original\} \/>/);
  // Present or Absent only - filtered and sorted by the same words it shows.
  assert.match(list, /\{ id: "status", header: "Status", accessorFn: \(row\) => statusLabel\(row\)/);
  assert.match(list, /className=\{`inline-block whitespace-nowrap rounded-full px-2 py-0\.5 text-\[11px\] font-semibold \$\{GROUP_PILL\[groupOf\(row\.original\)\]\}`\}>\{statusLabel\(row\.original\)\}/);
  assert.match(list, /clockOf\(row\.original\.checkInAt\)/);
  assert.match(list, /clockOf\(row\.original\.checkOutAt\)/);
  assert.match(list, /!row\.original\.attended && row\.original\.checkInAt \? "font-medium text-red-700"/);
  // The district and state, the whole address on hover.
  assert.match(list, /<span title=\{row\.original\.loginPlace\} className="block truncate">\{districtAndState\(row\.original\.loginPlace\)\}<\/span>/);
});

test("people are grouped by the day's status, the test the cards count by, present first", () => {
  const helper = PAGE.slice(PAGE.indexOf("const groupOf = "), PAGE.indexOf("const viewLabel = "));
  const { groupOf, GROUP_ORDER } = new Function(`${helper.replace(/\r/g, "")}; return { groupOf, GROUP_ORDER };`)();
  assert.equal(groupOf({ attended: true, status: "Late" }), "present");
  assert.equal(groupOf({ attended: true, status: "Not logged out" }), "present");
  // A login too short for a half day is Absent, whatever the check-in photo suggests.
  assert.equal(groupOf({ attended: false, status: "Absent", checkInAt: "2026-09-28T04:20:00Z" }), "absent");
  // A day on leave is Absent too.
  assert.equal(groupOf({ attended: false, status: "On leave" }), "absent");
  assert.equal(groupOf({ attended: false, status: "Holiday" }), "other");
  assert.ok(GROUP_ORDER.present < GROUP_ORDER.absent && GROUP_ORDER.absent < GROUP_ORDER.other);
});

test("the face is the check-in photograph, or initials for somebody who did not check in", () => {
  assert.match(face, /row\.checkInSelfieEventId\s*\? <AuthImage path=\{attendanceSelfiePath\(row\.checkInSelfieEventId\)\}/);
  assert.match(face, /: <EmployeeAvatar name=\{row\.employeeName\} seed=\{row\.employeeId\}/);
  assert.doesNotMatch(face, /photoUrl/, "the profile photo is back on the card");
});

test("the day's birthdays and anniversaries are always there, and say so on a day without", () => {
  const notice = PAGE.slice(PAGE.indexOf("function CelebrationsNotice("), PAGE.indexOf("export default function AttendanceRegisterPage("));
  assert.doesNotMatch(notice, /return null;/);
  assert.match(notice, /No birthdays or wedding anniversaries \{when\}\./);
  assert.match(notice, /birthdays\.length === 1 \? "Birthday" : "Birthdays"/);
  assert.match(notice, /anniversaries\.length === 1 \? "Wedding anniversary" : "Wedding anniversaries"/);
});

test("the login location is the district and state, and coordinates stay whole", () => {
  const helper = PAGE.slice(PAGE.indexOf("const COORDINATES = "), PAGE.indexOf("};", PAGE.indexOf("const districtAndState")) + 2);
  const districtAndState = new Function(`${helper.replace(/\r/g, "")}; return districtAndState;`)();
  // The addresses the server writes: road, town, district, state, PIN code.
  assert.equal(districtAndState("Kumalankuttai, Periyasemur, Erode, Tamil Nadu, 638001"), "Erode, Tamil Nadu");
  assert.equal(districtAndState("Sanyasigundu, Salem, Tamil Nadu, 636003"), "Salem, Tamil Nadu");
  // Nominatim's own line, where the address fell back to it, ends in the country as well.
  assert.equal(districtAndState("Periyasemur, Erode, Tamil Nadu, 638001, India"), "Erode, Tamil Nadu");
  assert.equal(districtAndState("Erode, Tamil Nadu"), "Erode, Tamil Nadu");
  assert.equal(districtAndState("Erode"), "Erode");
  assert.equal(districtAndState("11.35102, 77.69098"), "11.35102, 77.69098");
  assert.equal(districtAndState("-33.86785, 151.20732"), "-33.86785, 151.20732");
  assert.equal(districtAndState(null), "");
});

test("the Status column says Present or Leave, whatever the finer reading of the day", () => {
  const statusAt = PAGE.indexOf("const statusLabel = ");
  const helper = PAGE.slice(PAGE.indexOf("const groupOf = "), PAGE.indexOf("const viewLabel = "))
    + PAGE.slice(statusAt, PAGE.indexOf(String.fromCharCode(10), statusAt));
  const statusLabel = new Function(`${helper.replace(/\r/g, "")}; return statusLabel;`)();
  for (const status of ["On time", "Present", "Late", "Permitted", "Half day", "Early exit", "Not logged out"]) {
    assert.equal(statusLabel({ attended: true, status }), "Present", status);
  }
  // Not attended, and not leave either: a login nobody logged out of says what it is.
  assert.equal(statusLabel({ attended: false, status: "Incorrect login" }), "Incorrect login");
  assert.equal(statusLabel({ attended: false, status: "Absent" }), "Leave");
  assert.equal(statusLabel({ attended: false, status: "On leave" }), "Leave");
  // Neither on a day nobody was expected.
  assert.equal(statusLabel({ attended: false, status: "Holiday" }), "Holiday");
});

test("the register has no WhatsApp button: the report's group is linked from Settings alone", () => {
  // The header's WhatsApp button is gone, and so is the component that drew it.
  assert.doesNotMatch(PAGE, /AttendanceReportGroupLink|Link the group|<WhatsApp\b/);
  assert.equal(fs.existsSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceReportGroupLink.js")), false);
  const attendance = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  assert.doesNotMatch(attendance, /AttendanceReportGroupLink/);
  // Naming the group lives on the Settings page, for an administrator.
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceWhatsAppReportPanel.js"), "utf8");
  assert.match(panel, /label="Group name"/);
  assert.doesNotMatch(PAGE, /No WhatsApp group linked - the daily attendance report is not being sent|WhatsApp is not connected - the report cannot be sent/);
});

test("the sender connects through the same pairing Image Selection uses; the group is a typed name, not a pick from anyone's list", () => {
  const dialog = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceReportGroupDialog.js"), "utf8");
  assert.match(dialog, /import \{ WhatsAppPairingCode, useWhatsappPairingSession \} from "@\/components\/image-selection\/WhatsAppPairing";/);
  assert.match(dialog, /readSession: getAttendanceReportWhatsappSession,\s+connectSession: connectAttendanceReportWhatsapp,/);
  // There is nothing left to pick from anyone's own WhatsApp - the name is typed in Settings instead.
  assert.doesNotMatch(dialog, /listAttendanceReportGroups|linkAttendanceReportGroup|unlinkAttendanceReportGroup/);
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceWhatsAppReportPanel.js"), "utf8");
  assert.match(panel, /setAttendanceReportGroupName/);
  // Image Selection's own hook is the shared one with its endpoints.
  const pairing = fs.readFileSync(path.join(process.cwd(), "src", "components", "image-selection", "WhatsAppPairing.js"), "utf8");
  assert.match(pairing, /return useWhatsappPairingSession\(active, \{ autoStart, readSession: getImageSelectionWhatsappSession, connectSession: connectImageSelectionWhatsapp \}\);/);
});

test("there is no status box, on the Settings page or in the WhatsApp dialog", () => {
  // The status box was taken off the Settings page, and its component with it.
  assert.equal(fs.existsSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceReportStatus.js")), false);
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "settings", "AttendanceWhatsAppReportPanel.js"), "utf8");
  assert.doesNotMatch(panel, /AttendanceReportStatus/);
  // The dialog opens straight on the pairing code or the group list, with no status box above.
  const dialog = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceReportGroupDialog.js"), "utf8");
  assert.doesNotMatch(dialog, /<WhatsAppStatus|<AttendanceReportStatus|<dl/);
  // Nothing left to read a fresh copy of - it is pairing alone now, no group state to go stale.
  assert.doesNotMatch(dialog, /getAttendanceReportGroup\(/);
});
