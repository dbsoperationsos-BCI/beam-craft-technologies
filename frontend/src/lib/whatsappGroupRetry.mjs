/**
 * What a Retry of the messages waiting on a WhatsApp group does, and what it did, in the words the
 * reader needs.
 *
 * Pure, and here rather than in the banner, so the whole job - link, pace, send, report - is tested
 * as behaviour instead of by reading the component's source: a `.js` file carrying JSX cannot be
 * imported by `node --test`. The banner hands in the two calls and a clock; nothing here knows about
 * React or `fetch`. The first version left the loop in the component and asserted on its source
 * text, which is how it shipped counting the wrong thing (see `retryJob`) with its tests passing.
 *
 * The answers mean different things to whoever pressed Retry, and conflating any two of them
 * misleads:
 *
 *   * **sent** - the message went this time.
 *   * **already** - somebody else's Retry got there first (the endpoint claims each message, so only
 *     one press ever sends it). The message went; this is not a failure.
 *   * **limited** - the route allows five retries a minute per person, so a job of seven cannot
 *     clear in one press however the sending is paced. Reported as "still waiting on the group",
 *     this sent people hunting for a group problem they had already fixed.
 *   * **stuck** - the group still is not there, which is the one the bar is about.
 *   * **stopped** - the job stopped for something no amount of retrying will clear: the group could
 *     not be linked, chat is switched off, that WhatsApp is not connected. Each carries its own
 *     sentence, because "still waiting on the group" sends somebody off to rename a group when the
 *     real answer is a switch in Settings.
 */

/**
 * The wait between the sends of one job — **30 seconds**, and only here.
 *
 * A job of several messages goes to the same group one after another, and a burst of those from the
 * studio's paired number is what risks it being flagged. 1.2 seconds was a token gap: five sends
 * still left inside six seconds. At 30 the studio's number behaves like a person.
 *
 * It costs the person who pressed Retry real time - seven messages is three minutes - so the banner
 * reports progress as it goes rather than sitting on "Retrying...". It also means the route's limit
 * of five a minute is never reached, since two sends a minute cannot trip it.
 *
 * This is this retry's pace and nothing else's. Every other send in the app keeps its own.
 */
export const SEND_GAP_MS = 30_000;

/** How many retries the production route allows one person in a minute (`messageRetryLimiter`). */
export const RETRIES_PER_MINUTE = 5;

/**
 * The reason `sendStepMessage` writes when a project's group cannot be addressed at all - no
 * `whatsappGroupJid` on the project, or nobody left to send from. The server matches rows on this
 * exact string (`groupFailures.js`), so every production row in the bar is one of these.
 */
export const NO_GROUP_REASON = "No WhatsApp group linked";

/**
 * What to say for the other reasons the backend writes, each of which has to be fixed somewhere
 * else. Keyed by the reason itself: `sendStepMessage` promises only this short, safe set ever leaves
 * it, and the raw error stays on the message row.
 */
const STOP_FOR = {
  "Chat switched off for the studio": "WhatsApp chat is switched off for the studio - switch it on in Settings → WhatsApp Chat.",
  "Chat switched off for the sender": "WhatsApp chat is switched off for whoever the group is linked to.",
  "WhatsApp not connected": "That WhatsApp is not connected - reconnect it in WhatsApp Chat.",
};
const SEND_FAILED = "The send failed; try again in a moment.";
/*
 * The group is linked but has no sender: `sendStepMessage` writes NO_GROUP_REASON for this case too,
 * so it cannot be told apart by the reason alone. Auto-link saying the project was **already**
 * linked is what distinguishes it - a linked project that still cannot be addressed is one whose
 * linker no longer has a login, and linking it again is what gives it a sender.
 */
const NO_SENDER = "The group is linked, but whoever linked it no longer has a login - link it again on Pre Production → General.";
const LINK_REFUSED = "You may not link this project's group - whoever manages its pre production can link it on Pre Production → General.";

/** What the banner says while a job is working, so a three-minute wait is not a silent one. */
export function progressOf({ done = 0, total = 0, waiting = false, linking = false } = {}) {
  if (linking) return "Linking the group...";
  if (!total) return "";
  if (done >= total) return `${total} of ${total} done`;
  return waiting
    ? `${done} of ${total} sent — next in ${Math.round(SEND_GAP_MS / 1000)}s`
    : `Sending ${done + 1} of ${total}...`;
}

export function outcomeOf({ sent = 0, already = 0, limited = 0, stuck = 0, stopped = null } = {}) {
  const said = [
    sent ? `${sent} sent` : "",
    already ? `${already} already sent by somebody else` : "",
    limited ? `${limited} not tried yet — only ${RETRIES_PER_MINUTE} retries a minute are allowed. Press Link group & retry again in a minute for the rest` : "",
    stuck ? `${stuck} still waiting on the group — it was not found, so the rest were not tried` : "",
    // Its own sentence rather than a trailing clause, so the server's own wording reads as written.
    stopped?.count ? `${stopped.count} not sent. ${stopped.reason}` : "",
  ].filter(Boolean);
  return said.length ? said.join(" · ") : "Nothing left to retry here.";
}

/** Whether a finished job needs anybody's attention, which is what colours the notice reporting it. */
export const jobWentWell = (counts) => Boolean(counts) && !counts.stuck && !counts.stopped && !counts.limited;

/**
 * What one row says will clear it, which is not the same sentence for every row or every reader.
 *
 * One line for the whole bar told everybody to rename the group on WhatsApp. That is the fix for a
 * message addressed **by name** - the attendance report, the wishes - and it clears nothing for a
 * project's own messages, which are addressed by the group's id: only linking the group does. So the
 * row says it, where the row knows which kind it is and what this reader may do about it.
 *
 * Nothing claims the group is "not linked yet": `sendStepMessage` writes the same reason whether no
 * group is linked or the group is linked and its linker no longer has a login, so a row cannot tell
 * which of the two it is. What is true of both is what linking does, so that is what is said.
 */
export function noteFor(group, { canRetry = false, canLink = false } = {}) {
  const first = group?.messages?.[0] || {};
  if (!group?.retriable) {
    const rename = first.source === "ACTIVITY" ? "Rename the group on WhatsApp to exactly this name. " : "";
    return `${rename}${first.note || "Send this again from the screen it came from."}`;
  }
  // Every reader of a retriable row is told what will clear it, including the ones with no button:
  // a bar nobody can dismiss cannot carry a row that says nothing to the person reading it.
  if (!canRetry || !canLink) return "Its WhatsApp group is not linked. Whoever manages this project's pre production can link it on Pre Production → General, and its waiting messages go from there.";
  return "Linking makes your WhatsApp this project's sender: its production messages go out from you from then on.";
}

const breathe = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Links the project's group from the presser's own WhatsApp, which is the **first half** of the job.
 *
 * Every production row in the bar failed because the project has no group linked, and a retry on its
 * own links nothing - it re-runs a send that checks `whatsappGroupJid` and fails again. So pressing
 * Retry could only ever fail, seven times, thirty seconds apart, and then report them as sent (see
 * `retryJob`). Creating the group on WhatsApp with the right name does not help by itself either: a
 * project's message is addressed by group **id**, stored when somebody links it.
 *
 * Pre Production's own endpoint, not a second copy of it: it links only a group the caller's own
 * WhatsApp answered for, refuses one that another live project already holds, and says why when it
 * cannot. That `reason` is written for a person to read and is passed through untouched.
 */
async function linkGroup(group, link) {
  try {
    const data = (await link(group.projectId))?.data || {};
    if (data.linked) return { ok: true, alreadyLinked: Boolean(data.alreadyLinked) };
    return { ok: false, reason: data.reason || `None of your WhatsApp groups is named "${group.expectedGroupName}".` };
  } catch (error) {
    // Linking is `PROJECT / Pre Production` Read / Write, which is not the permission that draws
    // Retry. The banner asks for both before drawing the button, so this is the race, not the rule.
    if (error?.status === 403) return { ok: false, reason: LINK_REFUSED };
    return { ok: false, reason: error?.message || "The group could not be linked." };
  }
}

/**
 * Links the group, then retries every message under one job, **one at a time** with a gap between
 * them.
 *
 * Not in parallel: each is a WhatsApp send from the studio's paired number, and a burst of them to
 * one group is what puts that number at risk of being flagged. The gap is for the same reason - the
 * round trip alone would still have fired five sends inside a second or two.
 *
 * **A failed send answers 200.** `sendStepMessage` catches every send failure on purpose, so that a
 * failure never blocks the step: it records `status: "FAILED"` with a `reason` on the message row
 * and returns normally, and the controller answers `res.json({ data, message })`. The only non-2xx
 * answers that route gives are 400, 403, 409 and the limiter's 429 - **a real WhatsApp failure never
 * arrives as an error status.** Counting on `catch` alone therefore counted the retries the server
 * had *accepted*, not the messages that went: the bar reported "7 sent" with nothing delivered, and
 * the stop-at-the-first-stuck-one below was dead code for the one failure the bar exists for. So the
 * body is what is read, and `catch` is left for the four statuses that really are statuses.
 *
 * The job stops at the first message that does not go. Every message under one job goes to the
 * **same** group - that is what makes it one job - so whatever stopped the first stops all of them.
 * Carrying on tried all seven, thirty seconds apart, to learn three minutes later what the first
 * already said. The rest are reported as not tried, because they were not.
 */
export async function retryJob(group, { send, link = null, wait = breathe, onProgress = () => {} } = {}) {
  const counts = { sent: 0, already: 0, limited: 0, stuck: 0, stopped: null };
  const retriable = (group?.messages || []).filter((row) => row.retry?.kind === "PRODUCTION_MESSAGE");
  const total = retriable.length;
  if (!total) return counts;

  let wasAlreadyLinked = false;
  if (link && group?.projectId) {
    onProgress({ linking: true, total });
    const linked = await linkGroup(group, link);
    // Nothing is sent when the group could not be linked: those sends would all fail the same way,
    // and the reason the linking gave is the one that tells the person what to do about it.
    if (!linked.ok) return { ...counts, stopped: { count: total, reason: linked.reason } };
    wasAlreadyLinked = linked.alreadyLinked;
  }

  let done = 0;
  for (const message of retriable) {
    if (done) {
      // Said before the wait, not after, so the person watching knows why nothing is happening.
      onProgress({ done, total, waiting: true });
      await wait(SEND_GAP_MS);
    }
    onProgress({ done, total, waiting: false });
    let failure = null;
    try {
      // Production's own call, reused rather than written again here: that endpoint claims the
      // message, so two people pressing Retry cannot both send it.
      const answered = (await send(message.retry.shootId, message.retry.step))?.message;
      // No `message` on the body is nothing to judge it by, so it is taken at its 200.
      if (answered && answered.status !== "SENT") failure = answered.reason || "";
      else counts.sent += 1;
    } catch (error) {
      // 409 - somebody else's retry got there first. Not an error: the message went, which is the
      // answer this wanted, so the job carries on to the rest.
      if (error?.status === 409) { counts.already += 1; done += 1; continue; }
      const left = total - counts.sent - counts.already;
      // 429 - five a minute, so the rest are untried rather than failed, and the loop stops instead
      // of hammering a limiter that will refuse them anyway.
      if (error?.status === 429) counts.limited = left;
      else counts.stopped = { count: left, reason: error?.message || SEND_FAILED };
      break;
    }
    if (failure) {
      const left = total - counts.sent - counts.already;
      if (failure === NO_GROUP_REASON) {
        if (wasAlreadyLinked) counts.stopped = { count: left, reason: NO_SENDER };
        else counts.stuck = left;
      } else counts.stopped = { count: left, reason: STOP_FOR[failure] || SEND_FAILED };
      break;
    }
    done += 1;
  }
  return counts;
}
