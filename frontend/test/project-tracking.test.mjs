import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { PROGRESS_COLORS } from "../src/lib/progressStatus.mjs";
import { projectStatusColor, projectTrackingView } from "../src/lib/projectTracking.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

/*
 * The client portal's tracker draws the studio's own stages - worked out on the server by the rule
 * Edit Project → Status uses (`sales/projects/stage.js`) - in the client's words. These are the
 * portal endpoint's answers, as it sends them.
 */
const stage = (id, label, state, extra = {}) => ({ id, label, state, done: null, total: null, facts: [], ...extra });
const shoots = [
  { id: "a", name: "Reception", date: "2026-11-20", planned: true, plannedOn: "2026-10-01", finished: false },
  { id: "b", name: "Muhurtham", date: "2026-11-21", planned: false, plannedOn: null, finished: false },
];
function tracking(states, extra = {}) {
  const [started, pre, production, post, delivered] = states;
  return {
    projectStatus: "Work in Progress - Pre & Production",
    flag: null,
    eventId: "DBS-EV-1",
    projectName: "WED Priya & Arjun",
    stages: [
      stage("STARTED", "Project started", started, { facts: [{ label: "Branch", value: "Erode TN" }, { label: "Vertical", value: "Dum Dum" }, { label: "Main event date", value: "2026-11-20" }, { label: "Project manager", value: null }] }),
      stage("PRE_PRODUCTION", "Pre Production", pre, { done: 1, total: 2, shoots, facts: [{ label: "Pre-production coordinator", value: "Sneha Iyer" }, { label: "Creative manager", value: null }, { label: "Production plans submitted", value: "1 of 2" }] }),
      stage("PRODUCTION", "Production", production, { done: 0, total: 2, shoots, facts: [{ label: "Production manager", value: "Arun Kumar" }, { label: "Shoots finished", value: "0 of 2" }] }),
      stage("POST_PRODUCTION", "Post Production", post, { facts: [{ label: "Post-production coordinator", value: null }] }),
      stage("DELIVERED", "Delivered", delivered),
    ],
    welcomeGift: null,
    shootCompletedGift: null,
    ...extra,
  };
}

test("the first stage reads Project to the client; the steps take the server's states", () => {
  const view = projectTrackingView(tracking(["current", "upcoming", "upcoming", "upcoming", "upcoming"], { projectStatus: "Yet to Start" }));
  assert.deepEqual(view.steps.map((step) => step.label), ["Project", "Pre Production", "Production", "Post Production", "Delivered"]);
  assert.deepEqual(view.steps.map((step) => step.state), ["current", "upcoming", "upcoming", "upcoming", "upcoming"]);
});

test("a project at the first stage: its status and Event ID head the details, the project manager is its team - and the project's name is not shown", () => {
  const view = projectTrackingView(tracking(["current", "upcoming", "upcoming", "upcoming", "upcoming"], { projectStatus: "Yet to Start" }));
  assert.equal(view.stage.label, "Project");
  assert.equal(view.stage.position, "Stage 1 of 5");
  assert.equal(view.stage.state, "", "the status is the first detail, not a second chip in the header");
  assert.deepEqual(view.stage.facts[0], { label: "Status", chip: "Yet to Start", color: PROGRESS_COLORS.notStarted });
  assert.deepEqual(view.stage.facts.slice(1), [
    { label: "Event ID", value: "DBS-EV-1" }, { label: "Branch", value: "Erode TN" }, { label: "Vertical", value: "Dum Dum" }, { label: "Main event date", value: "20 Nov 2026" },
  ]);
  assert.deepEqual(view.stage.team, [{ role: "Project manager", name: "" }], "nobody named yet: the place their name will go");
  assert.doesNotMatch(JSON.stringify(view), /WED Priya & Arjun/, "the project's own name is not on the page");
  assert.deepEqual(view.stage.gifts, []);
  assert.equal(view.stage.showShoots, false);
});

test("Pre Production current: its people, plans submitted, and each shoot's plan - the Status tab's own rule", () => {
  const view = projectTrackingView(tracking(["done", "current", "upcoming", "upcoming", "upcoming"]));
  assert.equal(view.stage.position, "Stage 2 of 5");
  assert.deepEqual(view.stage.team, [{ role: "Pre-production coordinator", name: "Sneha Iyer" }, { role: "Creative manager", name: "" }]);
  assert.deepEqual(view.stage.facts, [], "plans submitted is the progress line, not a detail repeated");
  assert.deepEqual(view.stage.progress, { done: 1, total: 2, label: "1 of 2 planned" });
  assert.deepEqual(view.stage.shoots.map(({ name, note, status, detail }) => [name, note, status, detail]), [
    ["Reception", "20 Nov 2026", "Plan submitted", "on 01 Oct 2026"],
    ["Muhurtham", "21 Nov 2026", "Awaiting plan", undefined],
  ]);
  assert.equal(view.stage.shoots[0].color, PROGRESS_COLORS.completed);
  assert.equal(view.stage.shoots[1].color, PROGRESS_COLORS.notStarted);
  assert.ok(view.stage.shoots.every((shoot) => !shoot.muted), "every state a chip, so the cards read alike");
});

/** A shoot's production as the portal sends it: the steps done so far, with when. */
const KEYS = ["PLAN", "ON_THE_WAY", "REACHED", "STARTED", "COMPLETED"];
const progress = (doneCount) => ({
  steps: KEYS.map((key, index) => ({ key, done: index < doneCount, at: index < doneCount ? `2026-11-20T0${index}:30:00.000Z` : null })),
});
function productionShoots(...progresses) {
  const states = tracking(["done", "done", "current", "upcoming", "upcoming"]);
  states.stages[2].shoots = progresses.map((value, index) => ({ id: `s${index}`, name: `Shoot ${index}`, date: "2026-11-20", planned: value.steps[0].done, plannedOn: null, finished: false, progress: value }));
  return projectTrackingView(states).stage.shoots;
}

test("Production current: each shoot says where it stands - plan pending, on the way, reached, started, completed", () => {
  const lines = productionShoots(progress(0), progress(1), progress(2), progress(3), progress(4), progress(5));
  assert.deepEqual(lines.map(({ status }) => status), ["Plan pending", "Plan ready", "Team on the way", "Team reached shoot place", "Shoot started", "Shoot completed"]);
  assert.equal(lines[0].color, PROGRESS_COLORS.notStarted);
  assert.equal(lines[1].color, PROGRESS_COLORS.inProgress, "a plan in is a chip too, as every other state is");
  assert.equal(lines[2].color, PROGRESS_COLORS.inProgress);
  assert.equal(lines[5].color, PROGRESS_COLORS.completed);
});

test("a shoot's timeline: done steps with when, the next one current, the rest to come - in the client's words", () => {
  const [pending, onTheWay, completed] = productionShoots(progress(0), progress(2), progress(5));
  assert.deepEqual(pending.timeline.map(({ label, state, when }) => [label, state, when]), [
    ["Plan pending", "current", ""], ["Team left the studio", "upcoming", ""], ["Team reached shoot place", "upcoming", ""], ["Shoot started", "upcoming", ""], ["Shoot completed", "upcoming", ""],
  ]);
  assert.deepEqual(onTheWay.timeline.map(({ label, state }) => [label, state]), [
    ["Plan ready", "done"], ["Team left the studio", "done"], ["Team reached shoot place", "current"], ["Shoot started", "upcoming"], ["Shoot completed", "upcoming"],
  ]);
  assert.ok(onTheWay.timeline[1].when, "a step done says when it happened");
  assert.ok(completed.timeline.every((step) => step.state === "done"));
  assert.doesNotMatch(JSON.stringify([pending, onTheWay, completed]), /Pineapple|Reached studio|Photo copy|File in|Step \d/, "never the crew's own steps");
});

test("nothing stops a shoot part-way for the client: a halt the portal no longer sends is never read back", () => {
  const TRACKING = read("lib", "projectTracking.mjs");
  assert.doesNotMatch(TRACKING, /halt|Paused|On hold/, "the shoot runs to Happy clients; there is no halted state to show");
  // A shoot on its last step is Shoot started and reads as such, with no note on any step.
  const [started] = productionShoots(progress(4));
  assert.equal(started.status, "Shoot started");
  assert.equal(started.color, PROGRESS_COLORS.inProgress);
  assert.ok(started.timeline.every((step) => !step.note));
});

test("each shoot on Production carries its timeline, in the client's palette", () => {
  const TRACKER = read("components", "shared", "ProjectTracker.js");
  assert.match(TRACKER, /<ShootTimeline steps=\{shoot\.timeline\} label=\{`\$\{shoot\.name\}: production progress`\} \/>/);
  const TIMELINE = read("components", "client", "ShootTimeline.js");
  assert.match(TIMELINE, /<ol aria-label=\{label\}/);
  assert.match(TIMELINE, /aria-current=\{current \? "step" : undefined\}/);
  assert.match(TIMELINE, /var\(--client-primary\)/);
  // The next step pulses - only for somebody who has not asked their device for less motion.
  assert.match(TIMELINE, /\{current && <span className="step-pulse absolute inset-0 rounded-full/);
  assert.match(read("app", "globals.css"), /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.step-pulse \{ animation: step-pulse/);
});

test("the gifts, as Client Gifts tracks them: the welcome gift on Pre Production, the shoot completed gift on Production only", () => {
  const gifts = { welcomeGift: { status: "Sent", sentOn: "2026-10-02", receivedOn: null }, shootCompletedGift: { status: "Yet To Receive", sentOn: null, receivedOn: null } };
  const pre = projectTrackingView(tracking(["done", "current", "upcoming", "upcoming", "upcoming"], gifts)).stage.gifts;
  assert.deepEqual(pre, [{ label: "Welcome gift", chip: "Sent", color: PROGRESS_COLORS.inProgress, detail: "Sent 02 Oct 2026" }], "the shoot completed gift is not before the shoot");
  const production = projectTrackingView(tracking(["done", "done", "current", "upcoming", "upcoming"], gifts)).stage.gifts;
  assert.deepEqual(production, [{ label: "Shoot completed gift", chip: "Yet To Sent", color: PROGRESS_COLORS.notStarted, detail: "On its way soon" }], "the old spelling reads as Client Gifts reads it");
  const received = { ...gifts, shootCompletedGift: { status: "Received by Client", receivedOn: "2026-12-03" } };
  assert.deepEqual(projectTrackingView(tracking(["done", "done", "current", "upcoming", "upcoming"], received)).stage.gifts, [{ label: "Shoot completed gift", chip: "Received by Client", color: PROGRESS_COLORS.completed, detail: "Received 03 Dec 2026" }]);
  assert.deepEqual(projectTrackingView(tracking(["done", "done", "done", "current", "upcoming"], received)).stage.gifts, [], "not repeated on the stages after Production");
  assert.deepEqual(projectTrackingView(tracking(["done", "current", "upcoming", "upcoming", "upcoming"])).stage.gifts, [], "a project giving no gift shows none");
});

test("a delivered project has every step done and its last card showing", () => {
  const view = projectTrackingView(tracking(["done", "done", "done", "done", "done"], { projectStatus: "Delivered" }));
  assert.ok(view.steps.every((step) => step.state === "done"));
  assert.equal(view.stage.label, "Delivered");
  assert.equal(view.stage.state, "Completed");
  assert.equal(view.stage.position, "Stage 5 of 5");
  assert.equal(view.statusColor, PROGRESS_COLORS.completed);
});

test("a stage reached so far can be picked and read again once it is over; one still to come cannot", () => {
  const live = tracking(["done", "done", "current", "upcoming", "upcoming"]);
  assert.equal(projectTrackingView(live).stage.key, "PRODUCTION", "the sheet opens on the stage the project is at");
  const pre = projectTrackingView(live, "PRE_PRODUCTION");
  assert.equal(pre.stage.label, "Pre Production");
  assert.equal(pre.stage.position, "Stage 2 of 5");
  assert.equal(pre.stage.state, "Completed");
  assert.deepEqual(pre.stage.team, [{ role: "Pre-production coordinator", name: "Sneha Iyer" }, { role: "Creative manager", name: "" }]);
  assert.deepEqual(pre.steps.map((step) => step.selected), [false, true, false, false, false]);
  assert.equal(projectTrackingView(live, "STARTED").stage.facts[0].label, "Status", "the Project sheet, status first, after the project has moved on");
  assert.equal(projectTrackingView(live, "POST_PRODUCTION").stage.key, "PRODUCTION", "a stage still to come falls back to the current one");
  // Delivered: every stage done, the last open by default and any earlier one a tap away.
  const over = tracking(["done", "done", "done", "done", "done"]);
  assert.equal(projectTrackingView(over).stage.key, "DELIVERED");
  const shoots = projectTrackingView(over, "PRODUCTION").stage;
  assert.equal(shoots.state, "Completed");
  assert.equal(shoots.shoots.length, 2);
});

test("the status chip takes the product's progress palette", () => {
  assert.equal(projectStatusColor("Work in Progress - Post Production"), PROGRESS_COLORS.inProgress);
  assert.equal(projectStatusColor("Yet to Start"), PROGRESS_COLORS.notStarted);
  assert.equal(projectStatusColor("Delivered"), PROGRESS_COLORS.completed);
});

test("the client portal reads its own project; Edit Project → Status is the studio's own stage view", () => {
  const PORTAL = read("components", "client", "ClientPortalPage.js");
  const PANEL = read("components", "project-management", "StartProjectFormPanel.js");
  assert.match(read("services", "client", "portal.service.js"), /apiRequest\("\/api\/client\/project"\)/);
  assert.match(PORTAL, /const response = await getClientProject\(\);/);
  assert.match(PORTAL, /<ProjectTracker tracking=\{project\.data\} pinTop=\{BAR_HEIGHT\} stageCards=/);
  // No welcome card: the studio's mark with Sign out beside it, then straight onto the project.
  assert.doesNotMatch(PORTAL, /Welcome|DashboardCard /);
  assert.match(PORTAL, /<AppLogo variant="navbar" priority \/>[\s\S]{0,400}<Button type="button" variant="plain" size="none"[^>]*onClick=\{signOut\}>\s+<span aria-hidden="true"[^>]*><LogoutRounded [^>]*\/><\/span>\s+<span className="sr-only sm:not-sr-only">Sign out<\/span>\s+<\/Button>/, "a phone shows the icon alone, the words still read out");
  assert.match(PORTAL, /if \(error\.status === 401\) \{ router\.replace\(CLIENT_LOGIN_ROUTE\); return; \}/);
  // The mark and Sign out stay at the top as the page scrolls, the content starting beneath them.
  assert.match(PORTAL, /<header className="fixed inset-x-0 top-0 z-40 /);
  assert.match(PORTAL, /pt-\[calc\(5\.5rem\+env\(safe-area-inset-top\)\)\]/);
  assert.match(PANEL, /<ProjectStageView /);
  assert.doesNotMatch(PANEL, /ProjectStatusTab|ProjectTracker/);
  assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "ProjectStatusTab.js")), false);
});

test("the stages are frames on a film strip: done developed, the current gold, the rest blank - and it opens on the current", () => {
  const TRACKER = read("components", "shared", "ProjectTracker.js");
  assert.match(read("components", "client", "FilmStrip.js"), /<ol aria-label=\{label\} className=/);
  assert.match(TRACKER, /<FilmStrip label="Project stages" winding/);
  assert.match(TRACKER, /aria-current=\{current \? "step" : undefined\}/);
  // A stage reached so far opens its own sheet; a blank one, and the scroll-up copy, are no button.
  assert.ok(TRACKER.includes("{done || current"));
  // The scroll-up copy picks too, by tap: out of the tab order, its sheet brought into view.
  assert.ok(TRACKER.includes("<StageFrame key={step.key} step={step} index={index} copy onPick={pickFromCopy} />"));
  assert.ok(TRACKER.includes("tabIndex={copy ? -1 : undefined}"));
  assert.ok(TRACKER.includes('window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });'));
  assert.ok(TRACKER.includes('aria-pressed={step.selected} aria-controls="client-stage-sheet"'));
  assert.ok(TRACKER.includes("<StageFrame key={step.key} step={step} index={index} onPick={setChosenKey} />"));
  assert.ok(TRACKER.includes("const view = projectTrackingView(tracking, chosenKey);"));
  assert.match(TRACKER, /frame-sheen bg-\[var\(--client-primary\)\] text-\[var\(--client-ink\)\]/);
  // Both strips keep the stage being read in their middle, and a swipe on one moves the other.
  assert.ok(TRACKER.includes('const frame = strip?.querySelector("[data-selected]");'));
  assert.ok(TRACKER.includes('for (const strip of [stripRef.current, pinnedStripRef.current]) centreSelectedFrame(strip, glide ? "smooth" : "auto");'));
  assert.ok(TRACKER.includes("}, [stage.key]);"));
  assert.ok(TRACKER.includes("if (leaderRef.current !== from) return;"), "only the strip being touched leads");
  assert.equal((TRACKER.match(/\{\.\.\.swipe\}/g) || []).length, 2);
  // The stage's sheet: its state chip - no progress ring - its team by name, its shoots as cards.
  assert.doesNotMatch(TRACKER, /PhotoCameraOutlined/, "a shoot card carries no camera picture");
  assert.match(TRACKER, /action=\{stage\.state \? <ProgressChip variant="icon" color=\{stage\.stateColor\}>\{stage\.state\}<\/ProgressChip> : null\}/);
  assert.doesNotMatch(TRACKER, /ProgressRing|ring-draw/);
  assert.doesNotMatch(read("app", "globals.css"), /ring-draw/);
  assert.match(TRACKER, /<h3 className=\{SECTION\}>Your team<\/h3>/);
  assert.match(TRACKER, /<h3 className=\{SECTION\}>Your shoots<\/h3>/);
  // The motion only for somebody who has not asked their device for less of it.
  assert.match(read("app", "globals.css"), /@media \(prefers-reduced-motion: no-preference\) \{\s+\.film-wind/);
  assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", "src", "components", "shared", "ProgressStepper.js")), false);
});

test("scrolled past, the strip comes back on a scroll up - under the bar, for the eye only, and away again on a scroll down", () => {
  const TRACKER = read("components", "shared", "ProjectTracker.js");
  // Only once the strip itself has gone up under the bar; then up brings it, down sends it away.
  assert.ok(TRACKER.includes("if (strip.getBoundingClientRect().bottom > barBottom) setPinned(false);"));
  assert.ok(TRACKER.includes("else setPinned(moved < 0);"));
  assert.ok(TRACKER.includes("if (Math.abs(moved) < 8) return;"), "a finger's jitter is not a scroll up");
  // A copy for the eye: a screen reader has the strip itself; still for anybody asking for less motion.
  assert.match(TRACKER, /ref=\{pinnedRef\}\s+aria-hidden="true"\s+data-pinned=\{pinned \|\| undefined\}\s+style=\{\{ top: pinTop \}\}/);
  assert.ok(TRACKER.includes("motion-reduce:transition-none"));
  assert.ok(TRACKER.includes('${copy ? "" : "frame-develop "}relative h-[4.25rem] w-[7.75rem]'), "one size of frame for both strips; the copy does not develop again");
});

test("the client's CRD document: a chip per state in the client's words, and Complete only while it is theirs to fill", () => {
  const CARD = read("components", "client", "ClientCrdCard.js");
  const PORTAL = read("components", "client", "ClientPortalPage.js");
  for (const chip of ["Not started", "Waiting for your details", "Started - not yet submitted", "Form submitted"]) {
    assert.match(CARD, new RegExp(`chip: "${chip}"`));
  }
  // The server hands the link out only while the form is the client's to fill; the button follows it.
  assert.ok(CARD.includes('{fillPath && <Button type="button" variant="plain" className="relative mt-6 !min-h-12 w-full !rounded-xl bg-[var(--client-primary)] !text-base !font-bold text-[var(--client-ink)]'));
  assert.match(CARD, />CRD Document<\/h2>/);
  assert.match(CARD, /onClick=\{\(\) => router\.push\(fillPath\)\}>Complete<\/Button>\}/);
  // …and only to the CRD form's own route.
  assert.ok(CARD.includes(String.raw`const CRD_FILL_PATH = /^\/crd\/[A-Za-z0-9_-]{16}$/;`));
  assert.match(CARD, /if \(!state\) return null;/, "a project needing no CRD document shows no card");
  // Under the Pre Production sheet only - the CRD is part of planning the shoots.
  assert.ok(PORTAL.includes("stageCards={{ PRE_PRODUCTION: <ClientCrdCard crd={project.data.crdDocument} /> }}"));
  assert.ok(read("components", "shared", "ProjectTracker.js").includes("{stageCards[stage.key]}"));
});

test("every status pill in the tracker is the one shared ProgressChip, as the client's icon pill", () => {
  const TRACKER = read("components", "shared", "ProjectTracker.js");
  assert.doesNotMatch(TRACKER, /PROGRESS_CHIP_CLASS|className=\{CHIP\}/);
  assert.equal((TRACKER.match(/<ProgressChip variant="icon" color=/g) || []).length, 4);
  assert.doesNotMatch(TRACKER, /<ProgressChip color=/, "no plain chip left on the client's page");
  // The client sign-in is its own frame, not the studio's login with its staff slides.
  assert.match(read("app", "client", "login", "page.js"), /<ClientAuthLayout><ClientLoginForm \/><\/ClientAuthLayout>/);
  const CHIP = read("components", "shared", "ProgressChip.js");
  assert.match(CHIP, /\$\{PROGRESS_CHIP_CLASS\} inline-block shrink-0 rounded-full/, "the studio's chip is unchanged");
  // The icon pill: a mark for each colour of the palette, so a status reads by shape as well as colour.
  assert.match(CHIP, /\$\{PROGRESS_CHIP_CLASS\} progress-chip-icon inline-flex/);
  for (const key of ["completed", "inProgress", "partiallyCompleted", "notStarted"]) assert.ok(CHIP.includes(`[PROGRESS_COLORS.${key}]:`), key);
  assert.match(read("app", "globals.css"), /\.progress-chip-icon \{/);
});
