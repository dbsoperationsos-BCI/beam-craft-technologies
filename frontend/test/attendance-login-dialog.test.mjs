import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Login and Logout open the same capture Break In and Break Off do - a live selfie, the location read
 * straight after it, the server's timestamp - in a dialog over the dashboard, rather than a separate
 * login screen in its place.
 */

const PAGE = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");

test("there is no separate login screen any more", () => {
  assert.doesNotMatch(PAGE, /DailyLoginPanel/);
  assert.doesNotMatch(PAGE, /Back to Dashboard/);
  assert.doesNotMatch(PAGE, /loginOpen/);
});

test("all four marks open the one capture dialog, each with its own capture token", () => {
  for (const step of ["CHECK_IN", "CHECK_OUT", "BREAK_START", "BREAK_END"]) {
    assert.match(PAGE, new RegExp(`${step}: \\{ title:`), `${step} has no capture step`);
  }
  assert.match(PAGE, /onLogin=\{\(\) => setCapture\("CHECK_IN"\)\} onLogout=\{\(\) => setCapture\("CHECK_OUT"\)\}/);
  assert.match(PAGE, /onStart=\{\(\) => setCapture\("BREAK_START"\)\} onEnd=\{\(\) => setCapture\("BREAK_END"\)\}/);
  // The selfie's token is asked for the step being marked, and the position is read after the photo.
  assert.match(PAGE, /<CameraSelfieField\s+captureType=\{step\}/);
  assert.match(PAGE, /if \(next\?\.dataUrl\) readLocation\(\);/);
});

test("a login still says where the day is worked from, and never sends a time of its own", () => {
  assert.match(PAGE, /\.\.\.\(checkingIn \? \{ workMode \} : \{\}\)/);
  const submit = PAGE.slice(PAGE.indexOf("await onSubmit({"), PAGE.indexOf("});", PAGE.indexOf("await onSubmit({")));
  assert.doesNotMatch(submit, /loginAt|timestamp|Date\.now|new Date/, "the device's clock is being sent as evidence");
});

test("what the login screen also held still has somewhere to be done", () => {
  // A day left open asks for its correction from the dashboard's own notice.
  assert.match(PAGE, /onRequestCorrection=\{setCorrection\}/);
  // ...as an Incorrect Login request on the one Raise Request form, with the day filled in.
  assert.match(PAGE, /\{correction && <AttendanceRequestFormPanel\s+initialType="INCORRECT_LOGIN"\s+prefill=\{\{ type: "INCORRECT_LOGIN", fromDate: correction\.date, toDate: correction\.date \}\}/);
  // Working away today: on-duty and outside attendance, from the login itself.
  assert.match(PAGE, /onRaise\("ON_DUTY"\)/);
  // Outside attendance needs a login to exist already, so the login dialog does not offer it.
  assert.doesNotMatch(PAGE, /onRaise\("OUTSIDE_LOCATION"\)/);
  // The check-in card still follows a login.
  assert.match(PAGE, /setCheckedIn\(\{ loginAt: response\?\.data\?\.loginAt/);
});

test("after a logout the header offers Login again, not Day complete", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  const button = source.slice(source.indexOf("function DashboardLoginButton("), source.indexOf("const breakClock"));
  assert.doesNotMatch(button, /Day complete/);
  assert.match(button, /const loggedIn = Boolean\(session && !session\.logoutAt\);/);
  assert.match(button, /onClick=\{loggedIn \? onLogout : onLogin\}/);
  // The check-in card says it was a login again.
  assert.match(source, /checkedIn\.relogin \? "You're logged in again" : "You're checked in"/);
});

test("the Attendance Register and Events are sections of Employee Attendance, each on its own permission", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  assert.match(source, /\{ label: "Attendance Register", value: SECTION_REGISTER, permission: \["HRM", "Attendance Approval", "READ"\] \}/);
  assert.match(source, /\{ label: "Events", value: SECTION_EVENTS, permission: \["HRM", "Events", "READ"\] \}/);
  // Still filtered by permission first; the `.map()` chained after it only renames the dashboard
  // entry for an administrator and adds nothing to the switch.
  assert.match(source, /const sections = SECTIONS\s*\.filter\(\(entry\) => !entry\.permission \|\| hasPermission\(\.\.\.entry\.permission\)\)/);
  // Shown whole, under this page's heading and switch, as the Request section is.
  assert.match(source, /<AttendanceRegisterPage title="Attendance" leadingAccessory=\{sectionSwitch\} onOpenRequests=\{\(\) => setSection\(SECTION_REQUEST\)\} \/>/);
  assert.match(source, /<EventsPage title="Attendance" leadingAccessory=\{sectionSwitch\} \/>/);
  // And off the HRM menu, their routes kept.
  const navigation = fs.readFileSync(path.join(process.cwd(), "src", "constants", "navigation.mjs"), "utf8");
  assert.match(navigation, /id: "attendance-register", [^\n]*href: "\/hrm\/attendance", [^\n]*hidden: true/);
  assert.match(navigation, /id: "events", [^\n]*href: "\/hrm\/events", [^\n]*hidden: true/);
});

test("an administrator's header has no Break In or Login; everybody else keeps both", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  assert.match(source, /const showDayButtons = !permissionsLoading && !isAdministrator;/);
  assert.match(source, /actions=\{showDayButtons \? <>\s*<BreakButton [\s\S]*?<DashboardLoginButton [\s\S]*?<\/> : null\}/);
});

test("the open section lives in the address, so a refresh stays on it", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  // Read from the query on every render - not held in memory and wiped by a reload.
  assert.match(source, /const requestedSection = useSearchParams\(\)\.get\("section"\);/);
  assert.match(source, /const section = DEEP_LINK_SECTIONS\.has\(requestedSection\) \? requestedSection : SECTION_SELF;/);
  assert.doesNotMatch(source, /const \[section, setSection\] = useState/);
  // Choosing a section writes it there; the dashboard is the bare address.
  assert.match(source, /router\.replace\(next && next !== SECTION_SELF \? `\/hrm\/employee-attendance\?section=\$\{next\}` : "\/hrm\/employee-attendance", \{ scroll: false \}\)/);
  // No flash of the dashboard while the permissions load after a refresh.
  assert.match(source, /const shownSection = permissionsLoading \|\| sections\.some\(\(entry\) => entry\.value === section\) \? section : SECTION_SELF;/);
});

test("the section switch reads Self Dashboard, Attendance Register, Events, Leave or Comp-Off Request, then Speak-up and Speak-up Review", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  const list = source.slice(source.indexOf("const SECTIONS = ["), source.indexOf("];", source.indexOf("const SECTIONS = [")));
  const labels = [...list.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Self Dashboard", "Attendance Register", "Events", "Leave or Comp-Off Request", "Speak-up", "Speak-up Review"]);
  // The switch keeps this order rather than sorting it.
  assert.match(source, /<DropdownMenu ariaLabel="Employee attendance section" items=\{sections\} value=\{shownSection\} onChange=\{setSection\} sorted=\{false\} \/>/);
});

test("before today's login the header offers Login alone - no Break In, not even a disabled one", () => {
  const breakButton = PAGE.slice(PAGE.indexOf("function BreakButton("), PAGE.indexOf("\n}\n", PAGE.indexOf("function BreakButton(")));
  // No session (not logged in, or today still loading) and a logged-out day both draw nothing.
  assert.match(breakButton, /if \(!session \|\| session\.logoutAt\) return null;/);
  assert.ok(!/Log in first to take a break/.test(breakButton), "the disabled pre-login Break In is gone");
  // Logged in: Break In, or Break Off while the server says a break is running.
  assert.match(breakButton, /const onBreak = Boolean\(today\?\.breaks\?\.onBreak\);/);
});

test("On-duty / Travel is the fourth button in Work mode, and still raises the on-duty request", () => {
  const modes = PAGE.slice(PAGE.indexOf("Work mode</p>"), PAGE.indexOf("{problem && <p role=\"alert\"", PAGE.indexOf("Work mode</p>")));
  // Two by two: three modes and the on-duty button.
  assert.match(modes, /className="mt-1\.5 grid grid-cols-2 gap-2"/);
  assert.match(modes, /onClick=\{\(\) => onRaise\("ON_DUTY"\)\}>\s*On-duty \/ Travel\s*<\/Button>/);
  // An action, not a mode: the three stored modes are unchanged and the button is never "pressed".
  assert.match(PAGE, /const workModes = \[\s*\{ id: "office", title: "Office" \},\s*\{ id: "work-from-home", title: "Work from home" \},\s*\{ id: "client-site", title: "Client site" \},\s*\];/);
  // The separate line under the modes is gone.
  assert.doesNotMatch(PAGE, /Working away today\?/);
  assert.doesNotMatch(PAGE, /Mark on-duty \/ travel/);
});

test("the dashboard counts an Incorrect login as Absent, and Raise Request offers a Correction with a read-only current status", async () => {
  // No Incorrect Login card: the server folds those days into Absent, which the dashboard shows.
  assert.doesNotMatch(PAGE, /"Incorrect Login", totals\.incorrectLogin/);
  assert.match(PAGE, /\["Absent", totals\.absent, "text-red-700"\]/);
  const config = await import("../src/constants/attendanceRequestConfig.js");
  // Comp-off is a Leave Type now, not a Request Type of its own.
  assert.deepEqual(config.RAISE_REQUEST_TYPES.map((option) => [option.value, option.label]), [["LEAVE", "Leave"], ["PERMISSION", "Permission"], ["INCORRECT_LOGIN", "Attendance Regularization"]]);
  assert.deepEqual(config.RAISE_LEAVE_TYPE_OPTIONS.map((option) => option.value), ["CL", "LOP", "COMP_OFF"]);
  const panel = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRequestFormPanel.js"), "utf8");
  // Current Status is shown, never typed; Change To is the searchable Dropdown, offered what the server offers.
  assert.match(panel, /<TextField label="Current Status"(?: helperText="[^"]*")? readOnly value=\{shown\} \/>/);
  assert.match(panel, /<Dropdown\s+label="Change To"/);
  assert.match(panel, /options=\{current\.options\.map\(/);
  // Read from the server for the chosen day - never a second status formula in the browser.
  assert.match(panel, /getCorrectionDay\(date\)/);
  assert.doesNotMatch(panel, /Only a day that reads as Incorrect login/);
  const dialog = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRequestDialog.js"), "utf8");
  // The current status is not sent: only what the day should read as.
  assert.match(dialog, /requestedStatus: isIncorrectLogin \? form\.requestedStatus : null,/);
  assert.doesNotMatch(dialog, /currentStatus/);
});

test("the selfie camera runs inside the circle as soon as the capture opens - no second window", () => {
  const field = PAGE.slice(PAGE.indexOf("function CameraSelfieField("), PAGE.indexOf("Raising a leave, permission or on-duty request."));
  // Open from the start unless a photo is already there to show.
  assert.match(field, /useState\(\(\) => !value && !disabled\)/);
  // The live feed is drawn in the circle, and the circle's camera button takes the shot from it.
  assert.match(field, /rounded-full[^"]*">\s*\{live \? <>\s*<video ref=\{videoRef\}/);
  assert.match(field, /onClick=\{live \? capture : openCamera\}/);
  // No overlay window and no separate "Open camera" button below the circle.
  assert.doesNotMatch(field, /fixed inset-0|role="dialog"|<button/);
});

test("a volume button takes the selfie too, while the feed is live - an extra beside the camera button", () => {
  const field = PAGE.slice(PAGE.indexOf("function CameraSelfieField("), PAGE.indexOf("Raising a leave, permission or on-duty request."));
  assert.match(PAGE, /const VOLUME_KEYS = new Set\(\["AudioVolumeUp", "AudioVolumeDown", "VolumeUp", "VolumeDown"\]\);/);
  // Listened for only while the camera is live and ready, and let go of otherwise.
  assert.match(field, /if \(!live \|\| waiting \|\| capturing \|\| disabled\) return undefined;/);
  assert.match(field, /window\.addEventListener\("keydown", onKey\);\s+return \(\) => window\.removeEventListener\("keydown", onKey\);/);
  // The same capture the camera button makes, once per press, and the phone's volume left alone.
  assert.match(field, /event\.preventDefault\(\);\s+if \(!event\.repeat\) void captureRef\.current\(\);/);
  assert.match(field, /onClick=\{live \? capture : openCamera\}/);
});

test("On duty / travel cannot be marked for a day already gone: its calendars start today, and the form says so", () => {
  const dialog = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "AttendanceRequestDialog.js"), "utf8");
  // Its calendars hide the days before today - a leave's do not, since leave can be applied for a day gone.
  assert.match(dialog, /const isOnDuty = action === "ON_DUTY";/);
  assert.match(dialog, /<DateField label="From date" required(?: helperText="[^"]*")? minDate=\{isOnDuty \? today : ""\}/);
  assert.match(dialog, /<DateField label="To date" required(?: helperText="[^"]*")? minDate=\{isOnDuty \? \(form\.fromDate > today \? form\.fromDate : today\) : ""\}/);
  // A past From date - a prefilled one, say - is refused before it is sent.
  assert.match(dialog, /else if \(action === "ON_DUTY" && today && form\.fromDate < today\) problems\.fromDate = "On duty \/ travel cannot start on a day that has already passed\.";/);
});

test("closing the On duty / travel raised from Login goes back to Login, and raising it does not", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  // The capture it came from is remembered when Login hands over to it.
  assert.match(page, /onRaise=\{\(action\) => \{ setQuickActionFrom\(capture\); setCapture\(null\); setQuickAction\(action\); \}\}/);
  // ✕ or Cancel: back to that capture.
  assert.match(page, /setQuickAction\(""\);\s+if \(quickActionFrom\) setCapture\(quickActionFrom\);\s+setQuickActionFrom\(null\);/);
  // Raised: nothing to go back to.
  assert.match(page, /await createAttendanceRequest\(payload\);\s+setQuickAction\(""\);[\s\S]{0,120}setQuickActionFrom\(null\);/);
});

test("logging out early is warned before and said after, by what the server reads the day as", async () => {
  const { logoutOutcome } = await import("../src/lib/logoutMessage.mjs");
  assert.equal(logoutOutcome("Absent").before, "If you log out now, your attendance will be marked as Absent.");
  assert.equal(logoutOutcome("Absent").after, "Your attendance will be marked as Absent.");
  assert.equal(logoutOutcome("Half day").after, "Your attendance will be marked as Half day.");
  assert.equal(logoutOutcome("Early exit").after, "Your attendance will be marked as Early exit.");
  // A day fine to leave - an approved permission covering the departure reads Permitted - has nothing to warn of.
  for (const status of ["Permitted", "On time", "Late", null, undefined]) assert.equal(logoutOutcome(status), null, String(status));

  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  // Before: the Logout box asks the server what logging out now would mark the day as.
  assert.match(page, /if \(step !== "CHECK_OUT"\) return undefined;[\s\S]{0,80}getLogoutPreview\(\)/);
  assert.match(page, /\{logoutWarning && !late && <p role="alert"[^>]*>\s*<span aria-hidden="true"[^>]*>!<\/span>\{logoutWarning\.before\} Cancel to stay logged in\./);
  // While it is being read, and when it could not be, that is said - never taken as "fine to leave".
  assert.match(page, /Checking how this logout will be recorded\.\.\./);
  assert.match(page, /We could not check how this logout will be recorded\. You can still log out\./);
  // After: the box the login has, with the logout's own reading of the day.
  assert.match(page, /setLoggedOut\(\{ logoutAt: response\?\.data\?\.logoutAt, day: response\?\.data\?\.day \|\| null \}\);/);
  assert.match(page, /title="You're logged out"/);
  // Success only when the server read the day as fine to leave; with no reading, nothing is claimed.
  assert.match(page, /: loggedOut\.day\?\.status && <p[^>]*>Successfully logged out\. Your day is recorded\.<\/p>/);
});
