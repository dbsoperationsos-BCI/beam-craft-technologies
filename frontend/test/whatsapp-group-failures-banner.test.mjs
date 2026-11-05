import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const NOTICE = fs.readFileSync(new URL("../src/components/app-shell/WhatsAppGroupFailuresBanner.js", import.meta.url), "utf8");
const SHELL = fs.readFileSync(new URL("../src/components/app-shell/AppShell.js", import.meta.url), "utf8");
const PANEL = fs.readFileSync(new URL("../src/components/settings/WhatsAppActivityLogPanel.js", import.meta.url), "utf8");
const SERVICE = fs.readFileSync(new URL("../src/services/settings/whatsapp-activity.service.js", import.meta.url), "utf8");

// Comments stripped: several of these assert that something is *absent* from the code, and the prose
// above it legitimately explains the thing being forbidden.
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const NOTICE_CODE = code(NOTICE);

/*
 * A job as the server sends one, and the calls `retryJob` is handed. The clock goes in with them, so
 * a seven-message job is a test rather than a three-minute wait.
 */
const job = (count = 1, extra = {}) => ({
  key: "p1",
  projectId: "p1",
  expectedGroupName: "WED 2t2 HYD Veeranji & Pravalika | SM | Darsi,prakasham | July 2026",
  messages: Array.from({ length: count }, (_, index) => ({
    source: "PRODUCTION",
    retry: { kind: "PRODUCTION_MESSAGE", shootId: `s${index}`, step: `STEP_${index}` },
  })),
  ...extra,
});
/*
 * **The production route answers 200 whether the send went or not.** `sendStepMessage` catches every
 * send failure on purpose, so a failure never blocks the step: it records it on the message row and
 * returns, and the controller answers `res.json({ data, message })`. So the body is the only thing
 * that says which happened, and these are the two shapes it comes in.
 */
const SENT = { message: { step: "STEP_0", status: "SENT", reason: null } };
const FAILED = (reason) => ({ message: { step: "STEP_0", status: "FAILED", reason } });
const LINKED = { data: { linked: true } };
const ALREADY_LINKED = { data: { linked: true, alreadyLinked: true } };
const refused = (reason) => ({ data: { linked: false, reason } });
const sends = (answer, link = () => Promise.resolve(LINKED)) => ({
  send: (shootId, step) => Promise.resolve(answer(shootId, step)),
  link,
  wait: () => Promise.resolve(),
});
const thrown = (status, message = "no") => Object.assign(new Error(message), { status });

/*
 * The bar under the top bar on **every page**: the WhatsApp messages that could not find their
 * group, which nothing told anybody about before. A studio that has not sent a client their shoot
 * message does not find that out by opening a settings panel, so it is where the work is. It cannot
 * be dismissed, so it may only hold fixable work - and it is not everybody's to read.
 */

test("there is no way to close it, and folding is not closing", () => {
  /*
   * Not a hidden control, not a disabled one - absent. That is what earns a bar on every page the
   * right to stay, and it is paired with the server listing only failures somebody can clear. The
   * list folds so it does not eat a screen it is not the subject of, but the line saying how many
   * are waiting stays whatever the fold is doing.
   */
  /*
   * `onClose` appears exactly once, on the `FloatingNotice` that reports a finished job - a
   * transient answer to something the reader just did, which is a different thing from the bar. The
   * bar itself has no close, so the assertion is narrowed rather than dropped.
   */
  assert.doesNotMatch(NOTICE_CODE, /onDismiss|setDismissed|Dismiss|aria-label="Close/i);
  const closes = NOTICE_CODE.match(/onClose=/g) || [];
  assert.equal(closes.length, 1, "one close, and it belongs to the notice");
  assert.match(NOTICE_CODE, /<FloatingNotice notice=\{notice\} onClose=\{clearNotice\}/);
  assert.match(NOTICE, /const \[open, setOpen\] = useState\(true\);/, "and it starts open");
  // Only the <ul> is inside the fold; the summary line is the control, and it always shows.
  assert.match(NOTICE, /\{open && <ul /);
});

test("it draws nothing at all when nothing is waiting, but still says what the job did", () => {
  /*
   * An empty strip on every page saying everything is fine is still a strip on every page. But a job
   * that cleared the last row is the one with something to say, and it had been emptying the list and
   * unmounting the section - taking the line that said "7 sent" with it. Three minutes of watching,
   * and then the bar simply vanished. So the notice is drawn whether or not the bar is.
   */
  /*
   * No `canRead` guard here any more - the permission was taken off this bar deliberately (see the
   * test below), so the only thing that draws nothing is having no rows. The point this test is
   * making is unchanged: the section is conditional, the notice beside it is not.
   */
  // The section is conditional; the notice beside it is not, so it survives the list emptying.
  assert.match(NOTICE, /\{groups\.length > 0 && <section/);
  assert.doesNotMatch(NOTICE_CODE, /if \(!canRead \|\| !groups\.length\) return null;/);
  // And the outcome is not a line inside the section any more, where it could not survive.
  assert.doesNotMatch(NOTICE_CODE, /outcome && <p/);
});

test("nothing gates it on this side, because the server already answered whose rows these are", () => {
  /*
   * It had a permission of its own, and that was the wrong shape for the question: a permission
   * answers *may you open this screen*, and this is a strip about the reader's own work, not a
   * screen. In front of it, the gate could only ever hide a project manager's own row from them -
   * and it did, because a new permission is granted to SUPER_ADMIN alone and nobody knew to tick it.
   *
   * So the server narrows to the rows the caller's own name is on, and asking is for everybody: an
   * employee with no project of their own gets an empty list, and an empty list draws no bar.
   */
  assert.doesNotMatch(NOTICE_CODE, /useModuleAccess\("SETTINGS"/);
  assert.doesNotMatch(NOTICE_CODE, /canRead/);
  assert.match(NOTICE, /\}, \[\]\);/, "the fetch depends on nothing, so it happens once");
  // The two that remain guard *acts* - sending a project's message, linking its group - not looking.
  assert.match(NOTICE, /useModuleAccess\("PROJECT", "Production"\)/);
  assert.match(NOTICE, /useModuleAccess\("PROJECT", "Pre Production"\)/);
});

test("it sits under the top bar, above the page, on every screen", () => {
  assert.match(SHELL, /<WhatsAppGroupFailuresBanner \/>/);
  const barAt = SHELL.indexOf("<AppTopbar");
  const noticeAt = SHELL.indexOf("<WhatsAppGroupFailuresBanner");
  const rowAt = SHELL.indexOf('<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">');
  assert.ok(barAt > -1 && noticeAt > barAt, "below the navbar");
  assert.ok(rowAt > -1 && noticeAt < rowAt, "and above the page, so it pushes rather than covers");
  // The page gives up the room, not the bar.
  assert.match(NOTICE, /className="shrink-0 border-b border-rose-200 bg-rose-50/);
});

test("the Activity Log panel no longer carries it", () => {
  // Asked for on every page instead, so a second copy on one screen would be two of them.
  assert.doesNotMatch(PANEL, /WhatsAppGroupFailuresBanner|WhatsAppGroupFailuresNotice/);
});

test("the button is drawn only for somebody who may do both halves of the job", () => {
  /*
   * It calls production's endpoint to send and pre production's to link, so it needs both - reading
   * this log entitles nobody to either. Absent, not disabled. And holding only Production is a row
   * that names who can link it, not a button certain to be refused: a bar nobody can dismiss may
   * only offer work its reader can actually do.
   */
  assert.match(NOTICE, /useModuleAccess\("PROJECT", "Production"\)/);
  assert.match(NOTICE, /useModuleAccess\("PROJECT", "Pre Production"\)/);
  assert.match(NOTICE, /Boolean\(group\.retriable\) && canRetryProduction && canLinkGroup && <Button/);
  // What a reader without the button is told is `noteFor`'s, and is asserted as behaviour below.
  assert.match(NOTICE, /noteFor\(group, \{ canRetry: canRetryProduction, canLink: canLinkGroup \}\)/);
  assert.doesNotMatch(NOTICE_CODE, /disabled=\{!canRetryProduction\}|disabled=\{!canLinkGroup\}/);
});

test("the button says what it does, and the row says what linking costs", () => {
  /*
   * "Retry" was a lie by omission twice over: it links before it sends, and whoever links becomes
   * the project's sender for every production message after this one. Both belong where it is
   * pressed, not in a changelog.
   */
  assert.match(NOTICE, /\n\s+Link group & retry\n/);
  assert.doesNotMatch(NOTICE_CODE, /"Retry" : `Retry \$\{group\.retriable\}`/);
  /*
   * `Button`'s own busy state, not a label swapped by hand: it carries the spinner and sets
   * `aria-busy`, which is what every other write in this app looks like while it runs.
   */
  assert.match(NOTICE, /busy=\{busyKey === group\.key\}/);
  assert.match(NOTICE, /busyLabel=\{progress \|\| "Working\.\.\."\}/);
  assert.doesNotMatch(NOTICE_CODE, /busyKey === group\.key \? \(progress/);
});

test("what clears a row is said on the row, because the two failures differ", () => {
  /*
   * One line for both told everybody to rename the group. A project's own messages are addressed by
   * group **id**, so renaming - or creating a group with the right name - clears nothing; only
   * linking does. A name-addressed message is the one a rename really does fix.
   */
  assert.match(NOTICE, /they were never sent\. Each one below says what will clear it\./);
  assert.doesNotMatch(NOTICE_CODE, /Rename the group on WhatsApp to the name shown, or link it/);
  // One paragraph, from one pure function - three with the same classes was three chances to hand
  // somebody a row that said nothing. What it says per row is asserted as behaviour below.
  assert.equal((NOTICE_CODE.match(/className="mt-1 text-xs text-slate-600"/g) || []).length, 1);
});

test("every row says what will clear it, for every reader", async () => {
  /*
   * The bar's own summary promises it ("Each one below says what will clear it"), and a bar nobody
   * can dismiss cannot then hand somebody a row that says nothing. The gap was a retriable row read
   * by somebody without Production write: no button, and no sentence either.
   */
  const { noteFor } = await import("../src/lib/whatsappGroupRetry.mjs");
  const retriable = { retriable: 1, messages: [{ source: "PRODUCTION" }] };
  // Both halves: the consequence of pressing, next to the button that does it.
  assert.match(noteFor(retriable, { canRetry: true, canLink: true }), /^Linking makes your WhatsApp this project's sender/);
  // Either half missing: who to ask, rather than silence or a button certain to be refused.
  for (const may of [{ canRetry: true, canLink: false }, { canRetry: false, canLink: true }, {}]) {
    assert.match(noteFor(retriable, may), /can link it on Pre Production → General/);
  }
  // Nothing claims the group is "not linked yet": the same reason is written when the group *is*
  // linked and its linker no longer has a login, so a row cannot tell which of the two it is.
  for (const may of [{ canRetry: true, canLink: true }, {}]) {
    assert.doesNotMatch(noteFor(retriable, may), /not linked yet/i);
  }
  // A name-addressed message is the one a rename really does fix, and it says so.
  const named = { retriable: 0, messages: [{ source: "ACTIVITY", note: "Its scheduler sends this again on its own." }] };
  assert.equal(noteFor(named, { canRetry: true, canLink: true }),
    "Rename the group on WhatsApp to exactly this name. Its scheduler sends this again on its own.");
  // And a row with nothing to press and no note of its own still says something.
  assert.equal(noteFor({ retriable: 0, messages: [{ source: "PRODUCTION" }] }, {}), "Send this again from the screen it came from.");
});

test("a row with nothing to press says what happens instead", () => {
  // A scheduled message sends itself again; the row has to say so rather than look ignored. The
  // sentence is `noteFor`'s - one paragraph for every row - and is tested as behaviour above.
  assert.match(NOTICE, /<p className="mt-1 text-xs text-slate-600">\{noteFor\(/);
  assert.match(fs.readFileSync(new URL("../src/lib/whatsappGroupRetry.mjs", import.meta.url), "utf8"), /first\.note \|\| "Send this again from the screen it came from\."/);
});

test("the gap is 30 seconds, and the wait reports itself", async () => {
  /*
   * 1.2 seconds was a token gap - five sends still left inside six seconds, which from one number to
   * one group is the burst this is meant to avoid. At 30 a job of seven takes three minutes, so the
   * button has to say where it has got to rather than sitting on "Retrying...".
   */
  const { SEND_GAP_MS, progressOf } = await import("../src/lib/whatsappGroupRetry.mjs");
  assert.equal(SEND_GAP_MS, 30_000);
  assert.equal(progressOf({ done: 0, total: 7, waiting: false }), "Sending 1 of 7...");
  assert.equal(progressOf({ done: 2, total: 7, waiting: true }), "2 of 7 sent — next in 30s");
  assert.equal(progressOf({ done: 7, total: 7 }), "7 of 7 done");
  assert.equal(progressOf({ linking: true, total: 7 }), "Linking the group...");
  // Nothing to do: no progress line rather than "0 of 0".
  assert.equal(progressOf({ done: 0, total: 0 }), "");
  /*
   * And somewhere a screen reader hears it. `Button` sets `aria-busy` and swaps its own label, but a
   * disabled control's label change is not announced and it cannot hold focus - so for three minutes
   * there was nothing to hear at all.
   */
  assert.match(NOTICE, /<p className="sr-only" role="status" aria-live="polite">\{progress\}<\/p>/);
});

test("outcomeOf says which of the four happened, in the reader's terms", async () => {
  // Exported and pure, so this is the behaviour rather than the source text.
  // From `lib`, not the component: a .js file carrying JSX cannot be imported by `node --test`,
  // which is why the pure wording lives there and is tested as behaviour rather than as source text.
  const { outcomeOf, RETRIES_PER_MINUTE } = await import("../src/lib/whatsappGroupRetry.mjs");
  assert.equal(RETRIES_PER_MINUTE, 5, "the number the production route actually allows");
  assert.equal(outcomeOf({ sent: 7, already: 0, limited: 0, stuck: 0 }), "7 sent");
  assert.match(outcomeOf({ sent: 5, already: 0, limited: 2, stuck: 0 }), /^5 sent · 2 not tried yet — only 5 retries a minute/);
  // The button it names is the button that exists: "Retry" has not been its label since it linked.
  assert.match(outcomeOf({ sent: 5, already: 0, limited: 2, stuck: 0 }), /Press Link group & retry again in a minute for the rest$/);
  assert.equal(outcomeOf({ sent: 0, already: 1, limited: 0, stuck: 0 }), "1 already sent by somebody else");
  assert.equal(outcomeOf({ sent: 0, already: 0, limited: 0, stuck: 3 }), "3 still waiting on the group — it was not found, so the rest were not tried");
  // Nothing retriable under the job: said rather than left blank.
  assert.equal(outcomeOf({ sent: 0, already: 0, limited: 0, stuck: 0 }), "Nothing left to retry here.");
  /*
   * The fifth answer: a job stopped for something renaming a group will never fix. Its own sentence,
   * so the server's own wording reads as written - "still waiting on the group" would have sent
   * somebody to WhatsApp when the answer is a switch in Settings or a login that no longer exists.
   */
  assert.equal(outcomeOf({ stopped: { count: 7, reason: "None of your WhatsApp groups is named \"X\"." } }),
    "7 not sent. None of your WhatsApp groups is named \"X\".");
  assert.equal(outcomeOf({ sent: 2, stopped: { count: 5, reason: "That WhatsApp is not connected - reconnect it in WhatsApp Chat." } }),
    "2 sent · 5 not sent. That WhatsApp is not connected - reconnect it in WhatsApp Chat.");
});

test("the retries go one at a time, with a gap, not all at once", async () => {
  /*
   * Each is a WhatsApp send from the studio's paired number, and a burst of them to one group is
   * what risks that number being flagged. Sequential alone was not enough - the round trip would
   * still have fired five inside a second or two - so there is a deliberate gap between them. The
   * clock is handed in, so this is the real ordering and not a three-minute test.
   */
  const { retryJob, progressOf, SEND_GAP_MS } = await import("../src/lib/whatsappGroupRetry.mjs");
  const waited = [];
  const said = [];
  await retryJob(job(3), {
    ...sends(() => SENT),
    wait: (ms) => { waited.push(ms); return Promise.resolve(); },
    onProgress: (step) => said.push(progressOf(step)),
  });
  assert.deepEqual(waited, [SEND_GAP_MS, SEND_GAP_MS], "between the sends, not before the first or after the last");
  // In order, and the waiting line is said *before* the wait, so a still screen has a reason on it.
  assert.deepEqual(said, [
    "Linking the group...",
    "Sending 1 of 3...",
    "1 of 3 sent — next in 30s",
    "Sending 2 of 3...",
    "2 of 3 sent — next in 30s",
    "Sending 3 of 3...",
  ]);
  assert.doesNotMatch(code(fs.readFileSync(new URL("../src/lib/whatsappGroupRetry.mjs", import.meta.url), "utf8")), /Promise\.all|Promise\.allSettled/);
});

test("it calls production's own retry rather than a second copy of it", () => {
  /*
   * `retryProductionMessage` already existed in the production service. Writing another one here
   * would have been a second definition of the one call that must stay the module's, because that
   * endpoint is what claims the message against two people pressing at once.
   */
  assert.match(NOTICE, /import \{ retryProductionMessage \} from "@\/services\/project-management\/production\.service"/);
  // Handed to the job rather than called in it, so the ids still come from the row and only the
  // module's own call ever sends.
  assert.match(NOTICE, /send: retryProductionMessage,/);
  assert.match(fs.readFileSync(new URL("../src/lib/whatsappGroupRetry.mjs", import.meta.url), "utf8"),
    /await send\(message\.retry\.shootId, message\.retry\.step\)/);
  assert.doesNotMatch(code(SERVICE), /retryGroupFailure/, "and the settings service keeps no copy");
  // Linking is pre production's own endpoint for the same reason.
  assert.match(NOTICE, /import \{ autoLinkPreProductionWhatsappGroup \} from "@\/services\/project-management\/pre-production\.service"/);
  // The ids come from the row; no path from the response is ever posted to.
  assert.doesNotMatch(NOTICE_CODE, /apiRequest\(|\.path\b/);
});

test("a retry re-reads its own list, so a cleared job leaves the bar", () => {
  assert.match(NOTICE, /await load\(\);/);
  // And the list is the shared server state, so what one person clears is cleared for everybody.
  assert.match(NOTICE, /const \{ groups, total \}|setGroups\(Array\.isArray/);
});

test("the fold is an accordion in the shape this app already uses for one", () => {
  /*
   * There is no shared Accordion component; the pattern (`FaceMatchingSettings`, the settings
   * panels) is a full-width button carrying the whole summary line, `aria-expanded` saying which way
   * it is, and one chevron that rotates rather than being swapped for a second icon. A lone icon
   * button was mine, not the app's.
   */
  assert.match(NOTICE, /aria-expanded=\{open\}/);
  // With a 40px touch target: at 360px a one-line summary is a ~20px strip to hit otherwise.
  assert.match(NOTICE, /className="flex min-h-10 w-full items-center justify-between gap-2 py-1 text-left/);
  assert.match(NOTICE, /ExpandMoreIcon aria-hidden="true" fontSize="small" className=\{`shrink-0 transition-transform \$\{open \? "rotate-180" : ""\}`\}/);
  assert.doesNotMatch(NOTICE_CODE, /ExpandLessIcon|IconButton/, "one icon that turns, not two that swap");
  // Retry stays its own Button, outside the accordion's control, so it is not a button in a button.
  assert.match(NOTICE, /import Button from "@\/components\/shared\/Button"/);
  const triggerEnd = NOTICE.indexOf("</button>");
  assert.ok(triggerEnd > -1 && NOTICE.indexOf("<Button") > triggerEnd, "the Retry buttons are below the trigger, not nested in it");
});

test("it reads at phone width", () => {
  // The row stacks under ~640px and the button takes the full width rather than squeezing the name.
  assert.match(NOTICE, /flex-col gap-1\.5 rounded-md border .*sm:flex-row/);
  assert.match(NOTICE, /className="shrink-0 max-sm:w-full"/);
  assert.doesNotMatch(NOTICE_CODE, /w-\[\d+px\]|min-w-\[\d+px\]/);
  // A 60-character group name wraps rather than being clipped with no way to read the rest.
  assert.match(NOTICE, /break-words text-sm font-medium/);
  // The class, not the word: `truncated` (the server's "there are more") contains it.
  assert.doesNotMatch(NOTICE_CODE, /className="[^"]*\btruncate\b/);
});

test("a list the server had to cut off says so", () => {
  // Otherwise the notice quietly implies these are all of them, which for a notice nobody can
  // dismiss is the one lie it must not tell.
  assert.match(NOTICE, /setTruncated\(Boolean\(result\?\.data\?\.truncated\)\)/);
  assert.match(NOTICE, /truncated \? "At least " : ""/);
  assert.match(NOTICE, /There are more than shown here/);
  // And a failed read does not leave a stale "there are more" behind.
  assert.match(NOTICE, /setTotal\(0\);\n\s+setTruncated\(false\);/);
});

test("the colours are ones the dark themes actually repaint", () => {
  /*
   * `globals.css` repaints plain `.bg-rose-50` and `.border-rose-200` for `data-theme="dark"`. It
   * cannot repaint an opacity modifier, so `bg-rose-50/60` stayed pastel on a dark background - and
   * `dark:` does nothing at all in this app, which themes by `data-theme`; no other component uses
   * the prefix.
   */
  // The strip and the cards on it: both plain, repaintable classes.
  assert.match(NOTICE_CODE, /border-b border-rose-200 bg-rose-50/);
  assert.match(NOTICE_CODE, /rounded-md border border-rose-200 bg-white/);
  assert.doesNotMatch(NOTICE_CODE, /bg-rose-50\/|bg-white\/|dark:/);
});

/*
 * What the bar actually does when Retry is pressed. None of this was testable while the loop lived
 * in the component - a `.js` file carrying JSX cannot be imported by `node --test` - so it was
 * asserted on as source text, and the counting bug below shipped with every one of those passing.
 */

test("a send the server accepted but never made is not counted as sent", async () => {
  /*
   * The bug this file could not see. A real WhatsApp failure comes back **200** with
   * `status: "FAILED"` on the body, so counting on `catch` alone counted the retries the server had
   * accepted: seven messages reported as "7 sent" with nothing delivered, and the stop-at-the-first
   * rule below never firing for the one failure the bar exists for.
   */
  const { retryJob, outcomeOf } = await import("../src/lib/whatsappGroupRetry.mjs");
  const tried = [];
  const counts = await retryJob(job(7), sends((shootId) => { tried.push(shootId); return FAILED("No WhatsApp group linked"); }));
  assert.equal(counts.sent, 0, "nothing went, so nothing is counted as having gone");
  assert.equal(counts.stuck, 7);
  assert.equal(tried.length, 1, "and it stops at the first rather than spending three minutes on six more");
  assert.match(outcomeOf(counts), /^7 still waiting on the group/);
});

test("it links the group before it sends anything", async () => {
  /*
   * A production row is in the bar because the project has no group linked, and a send checks
   * `whatsappGroupJid` - so a retry that does not link first can only fail again. Creating the group
   * on WhatsApp with the right name does not help by itself: the message is addressed by group id.
   */
  const { retryJob } = await import("../src/lib/whatsappGroupRetry.mjs");
  const order = [];
  const counts = await retryJob(job(2), {
    ...sends(() => { order.push("send"); return SENT; }, (projectId) => { order.push(`link:${projectId}`); return Promise.resolve(LINKED); }),
  });
  assert.deepEqual(order, ["link:p1", "send", "send"], "once for the job, not once per message");
  assert.equal(counts.sent, 2);
});

test("a group that could not be linked sends nothing at all", async () => {
  /*
   * Seven sends that are all certain to fail are three minutes spent learning what the link attempt
   * already said. Its reason is written for a person, so it is passed through as it came.
   */
  const { retryJob, outcomeOf } = await import("../src/lib/whatsappGroupRetry.mjs");
  const counts = await retryJob(job(7), {
    ...sends(() => { throw new Error("must not send"); }, () => Promise.resolve(refused('None of your WhatsApp groups is named "X".'))),
  });
  assert.equal(counts.sent, 0);
  assert.deepEqual(counts.stopped, { count: 7, reason: 'None of your WhatsApp groups is named "X".' });
  assert.equal(outcomeOf(counts), '7 not sent. None of your WhatsApp groups is named "X".');
});

test("being refused the link says who can do it, rather than reading as a failure", async () => {
  // Linking is `PROJECT / Pre Production`, which is not the permission that draws the button, so a
  // 403 here is the race rather than the rule - and it is still a person's next step, not an error.
  const { retryJob } = await import("../src/lib/whatsappGroupRetry.mjs");
  const counts = await retryJob(job(3), { ...sends(() => SENT, () => Promise.reject(thrown(403))) });
  assert.match(counts.stopped.reason, /whoever manages its pre production can link it on Pre Production → General/);
});

test("a linked group that still cannot be addressed has lost its sender, not its name", async () => {
  /*
   * `sendStepMessage` writes the same reason whether no group is linked or the linker no longer has
   * a login, so the reason alone cannot tell them apart. Auto-link answering "already linked" is
   * what does: told to rename the group, somebody would have renamed a group that was never wrong.
   */
  const { retryJob } = await import("../src/lib/whatsappGroupRetry.mjs");
  const counts = await retryJob(job(3), { ...sends(() => FAILED("No WhatsApp group linked"), () => Promise.resolve(ALREADY_LINKED)) });
  assert.equal(counts.stuck, 0);
  assert.match(counts.stopped.reason, /no longer has a login - link it again on Pre Production → General/);
  assert.equal(counts.stopped.count, 3);
});

test("the reasons that are fixed somewhere else say where", async () => {
  // "Still waiting on the group" sent people to WhatsApp when the answer was a switch in Settings.
  const { retryJob } = await import("../src/lib/whatsappGroupRetry.mjs");
  for (const [reason, says] of [
    ["Chat switched off for the studio", /switched off for the studio - switch it on in Settings → WhatsApp Chat/],
    ["Chat switched off for the sender", /switched off for whoever the group is linked to/],
    ["WhatsApp not connected", /not connected - reconnect it in WhatsApp Chat/],
    ["Send failed", /The send failed; try again in a moment/],
  ]) {
    const counts = await retryJob(job(4), { ...sends(() => FAILED(reason)) });
    assert.equal(counts.stuck, 0, `${reason} is not a group to rename`);
    assert.match(counts.stopped.reason, says);
    assert.equal(counts.stopped.count, 4, "and the rest were not tried, because they were not");
  }
});

test("409 is not a failure, and the job carries on past it", async () => {
  // Somebody else's retry got there first; the endpoint claims each message, so it went. Only that
  // one message is theirs, though - the rest of the job is still this presser's to send.
  const { retryJob, outcomeOf } = await import("../src/lib/whatsappGroupRetry.mjs");
  let nth = 0;
  const counts = await retryJob(job(3), {
    ...sends(() => { nth += 1; if (nth === 1) throw thrown(409, "already sent"); return SENT; }),
  });
  assert.equal(counts.already, 1);
  assert.equal(counts.sent, 2, "it did not stop at the 409");
  assert.equal(outcomeOf(counts), "2 sent · 1 already sent by somebody else");
});

test("429 stops the job, and the rest are untried rather than failed", async () => {
  const { retryJob, outcomeOf } = await import("../src/lib/whatsappGroupRetry.mjs");
  const counts = await retryJob(job(7), { ...sends(() => { throw thrown(429, "slow down"); }) });
  assert.equal(counts.limited, 7);
  assert.equal(counts.stuck, 0, "not a group problem, and saying so sent people hunting for one");
  assert.match(outcomeOf(counts), /7 not tried yet — only 5 retries a minute/);
});

test("only production messages are retried, and they are the denominator", async () => {
  /*
   * A scheduled message has no retry at all - its own scheduler sends it - so it is not one of the
   * messages this job is counting, which is what makes "3 of 7" the right fraction.
   */
  const { retryJob, progressOf } = await import("../src/lib/whatsappGroupRetry.mjs");
  const said = [];
  const mixed = job(1, { messages: [
    { source: "PRODUCTION", retry: { kind: "PRODUCTION_MESSAGE", shootId: "s1", step: "STEP_0" } },
    { source: "ACTIVITY", retry: null },
    { source: "ACTIVITY", retry: { kind: "SOMETHING_ELSE" } },
  ] });
  await retryJob(mixed, { ...sends(() => SENT), onProgress: (step) => said.push(progressOf(step)) });
  assert.ok(said.includes("Sending 1 of 1..."), "one retriable message out of three rows");
});

test("a job with nothing retriable under it sends nothing and says so", async () => {
  const { retryJob, outcomeOf } = await import("../src/lib/whatsappGroupRetry.mjs");
  const counts = await retryJob(job(1, { messages: [{ source: "ACTIVITY", retry: null }] }), {
    ...sends(() => { throw new Error("must not send"); }, () => { throw new Error("must not link"); }),
  });
  assert.equal(outcomeOf(counts), "Nothing left to retry here.");
});
