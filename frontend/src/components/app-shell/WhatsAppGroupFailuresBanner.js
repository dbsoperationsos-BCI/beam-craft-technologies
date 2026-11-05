"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { formatDateTime } from "@/lib/formatDateTime.mjs";
import { jobWentWell, noteFor, outcomeOf, progressOf, retryJob } from "@/lib/whatsappGroupRetry.mjs";
import { autoLinkPreProductionWhatsappGroup } from "@/services/project-management/pre-production.service";
import { retryProductionMessage } from "@/services/project-management/production.service";
import { getWhatsAppGroupFailures } from "@/services/settings/whatsapp-activity.service";

/*
 * The WhatsApp messages waiting on a group, under the top bar on every page.
 *
 * A group is addressed either by its id or by its **name**, and the ones addressed by name are
 * looked up when the message is sent: rename the group on WhatsApp and the lookup finds nothing, so
 * the message silently never goes. Nothing said so anywhere - the studio learned about it when
 * somebody noticed a message had not arrived - and a studio that has not sent a client their shoot
 * message does not find that out by opening a settings panel. So it is here, where the work is, and
 * not on the screen somebody would have to think to visit.
 *
 * **It cannot be dismissed, and that is why it holds only fixable things.** There is no close
 * control, not a hidden one. A bar on every page earns that by containing only work somebody can
 * actually do, so it carries one failure and no others: a send that failed because WhatsApp was down
 * does not belong in it, because no amount of renaming clears it and the bar would never go away.
 * The list folds, which is not the same as closing - the line saying how many are waiting stays
 * whatever the fold is doing.
 *
 * **There is no permission in front of it, on purpose.** It is not the activity log's - who may read
 * every WhatsApp message the studio has ever sent is a different question from who should be told, on
 * every screen, that one never went - and it is not one of its own either. A permission answers *may
 * you open this screen*, and this is not a screen anybody opens: it is a strip about **your own**
 * work, and whose rows you get is a question [IAM.md](../../../../docs/project-state/IAM.md) says has
 * "one answer for everybody, no setting, per role or otherwise". Given a tickable permission, it
 * could only ever hide a project manager's own row from them - and it did: a new permission is
 * granted to SUPER_ADMIN alone, as every new permission must be, so the manager of a project whose
 * message never went was shown nothing at all until somebody ticked a box nobody knew existed.
 *
 * So the server narrows instead: the rows somebody's **own name** is on - the projects they are
 * project manager of - widened only by `PROJECT / Show All Projects`, which is the project
 * register's deliberate widener and is what puts the ownerless Settings failures in front of the
 * people who fix those. An employee on no such project gets an empty list and so no bar at all, and
 * there is no call here that can answer with anybody else's row.
 *
 * **One job per row, not one message.** A project with six shoots is six failed messages and one
 * thing to fix - link its group - so the server groups them and the row says how many are waiting.
 *
 * **Retry links the group, then sends.** A production row is here because the project has no group
 * linked, and a retry on its own links nothing: it re-runs a send that checks `whatsappGroupJid` and
 * fails again, so pressing it could only ever fail once per message, thirty seconds apart. So the
 * button says what it does - **Link group & retry** - and links from the presser's own WhatsApp
 * first (Pre Production's own endpoint, which only ever links a group their WhatsApp answered for).
 * That has a consequence worth stating where it is pressed rather than discovering later: whoever
 * links becomes the project's sender, and its production messages go out from them from then on. So
 * the row says so, next to the button.
 *
 * **The permissions are the two things it does, not the one screen it is on.** `retryProductionMessage`
 * claims the message, so two people pressing cannot both send it and the loser's 409 is reported here
 * as already sent. Reading the log entitles nobody to send a project's messages or to link its group,
 * so the button needs `PROJECT / Production` **and** `PROJECT / Pre Production` at Read / Write -
 * absent, not disabled and refused. Holding only the first is a row that says who can link it, rather
 * than a button that is certain to be refused: a bar nobody can dismiss may only offer work its
 * reader can actually do.
 *
 * A scheduled message carries no retry at all: its scheduler tries again on its own, so the row says
 * it will go once the name matches rather than offering a button that would race the scheduler.
 *
 * **The result is a notice, not a line in here, because a job that works destroys this component.**
 * Clearing the last row empties the list, and the bar then draws nothing at all - taking any line
 * inside it with it. So three minutes of watching a job ended in the bar vanishing and the one thing
 * the person was waiting for, "7 sent", never being shown. `FloatingNotice` outlives the section,
 * carries the tone (a job that worked is not rose), and announces itself.
 */
/*
 * Longer than the usual five seconds: this is the answer to a job that may have taken three minutes,
 * and it can be a sentence naming somewhere else to go and fix something.
 */
const NOTICE_MS = 15000;

export default function WhatsAppGroupFailuresBanner() {
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  // The server reads only so many at once; said out loud rather than letting the list imply it is all.
  const [truncated, setTruncated] = useState(false);
  const [open, setOpen] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  // A 30-second gap between sends makes a job of seven a three-minute wait, so it reports itself.
  const [progress, setProgress] = useState("");
  // Said where it survives this component, which a finished job can unmount - see above.
  const { notice, showNotice, clearNotice } = useNotice();
  /*
   * One press, one job. `busyKey` is state, so two clicks in the same tick both read it empty and
   * both start a job - which from one WhatsApp number to one group is the burst the 30-second gap
   * exists to avoid. The ref inside this is written before anything awaits.
   */
  const pressing = useSubmitOnce();
  // Production's permission, not this bar's: it is production's endpoint the button calls.
  const { canWrite: canRetryProduction } = useModuleAccess("PROJECT", "Production");
  // And Pre Production's, because the first half of the job is linking the group with its endpoint.
  const { canWrite: canLinkGroup } = useModuleAccess("PROJECT", "Pre Production");

  const load = useCallback(async () => {
    try {
      const result = await getWhatsAppGroupFailures();
      setGroups(Array.isArray(result?.data?.groups) ? result.data.groups : []);
      setTotal(Number(result?.data?.total) || 0);
      setTruncated(Boolean(result?.data?.truncated));
    } catch {
      // Silent: this is a bar about other failures, on top of whatever page somebody opened. A bar
      // announcing its own failure would be noise they cannot act on, on every screen in the app.
      setGroups([]);
      setTotal(0);
      setTruncated(false);
    }
    // Asked for by everybody, because the answer is already narrowed to the asker: two indexed reads
    // that come back empty for an employee with no project of their own, and no bar when they do.
  }, []);

  // Deferred a tick, as every other list in the shell is: the first render is not the one that
  // fetches, so React is not asked to re-render from inside an effect body.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const retryGroup = useCallback(async (group) => {
    await pressing.run(async () => {
      setBusyKey(group.key);
      clearNotice();
      setProgress("");
      try {
        const counts = await retryJob(group, {
          send: retryProductionMessage,
          link: autoLinkPreProductionWhatsappGroup,
          onProgress: (step) => setProgress(progressOf(step)),
        });
        showNotice(outcomeOf(counts), jobWentWell(counts) ? "success" : "error");
      } finally {
        // Whatever happened, the bar is usable again: a `busyKey` left set disables every row on
        // every page, and nothing in this bar can clear it.
        setProgress("");
        setBusyKey("");
      }
      // Re-read the shared list: what one person cleared is cleared for everybody.
      await load();
    });
  }, [load, pressing, showNotice, clearNotice]);

  /*
   * Nothing waiting is no bar at all, rather than an empty strip on every page saying everything is
   * fine - but the notice is outside that condition, because the job that emptied the list is the
   * one with something to say.
   */
  return <>
    <FloatingNotice notice={notice} onClose={clearNotice} duration={NOTICE_MS} />
    {groups.length > 0 && <section
    aria-label="WhatsApp messages waiting on a group"
    className="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-2 sm:px-4"
  >
    {/*
      * An accordion, in the shape this app already uses for one (`FaceMatchingSettings`, the
      * settings panels): the whole summary line is the control, `aria-expanded` says which way it
      * is, and the chevron rotates rather than being swapped for a different icon.
      *
      * It folds the list. It does not close the bar - this line stays on every page whatever the
      * fold is doing, because the work has not gone away, and there is no control that removes it.
      */}
    <button
      type="button"
      onClick={() => setOpen((shown) => !shown)}
      aria-expanded={open}
      className="flex min-h-10 w-full items-center justify-between gap-2 py-1 text-left text-sm text-rose-800 hover:text-rose-900"
    >
      <span className="min-w-0">
        <span className="font-medium">
          {total === 1
            ? "1 WhatsApp message could not find its group"
            : `${truncated ? "At least " : ""}${total} WhatsApp messages could not find their group`}
        </span>
        {/*
          * What clears a row is said on the row, not here: these are two different failures, and one
          * line for both told people to rename a group when the project's own messages are addressed
          * by id and only linking the group clears them. Followed, it could not have worked.
          */}
        {" — "}they were never sent. Each one below says what will clear it.
        {truncated ? " There are more than shown here." : ""}
      </span>
      <ExpandMoreIcon aria-hidden="true" fontSize="small" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>

    {/*
      * Where a screen reader hears the job. `Button` sets `aria-busy` and swaps its own label, but a
      * disabled control's label change is not announced and it cannot hold focus - so for three
      * minutes there was nothing to hear. Only the step changes land here: "next in 30s" is a fixed
      * number, not a countdown, so it does not re-announce itself every second.
      */}
    <p className="sr-only" role="status" aria-live="polite">{progress}</p>

    {open && <ul className="mt-2 flex flex-col gap-1.5 border-t border-rose-200 pt-2">
      {groups.map((group) => <li
        key={group.key}
        className="flex flex-col gap-1.5 rounded-md border border-rose-200 bg-white px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-slate-900">{group.where}</p>
          <p className="mt-0.5 break-words text-xs text-slate-600">
            Expects a group named <span className="font-medium">&ldquo;{group.expectedGroupName || "— no name set —"}&rdquo;</span>
            {" · "}
            {group.messages.length === 1 ? "1 message waiting" : `${group.messages.length} messages waiting`}
            {group.failedAt ? ` · last tried ${formatDateTime(group.failedAt)}` : ""}
          </p>
          {/*
            * One line, and every row has one. It says what will clear *this* row for *this* reader -
            * the rename that really does fix a name-addressed message, the consequence of pressing
            * where there is a button, and who to ask where there is not. Three paragraphs with the
            * same classes was three chances for a reader to be handed a row that said nothing.
            */}
          <p className="mt-1 text-xs text-slate-600">{noteFor(group, { canRetry: canRetryProduction, canLink: canLinkGroup })}</p>
        </div>
        {Boolean(group.retriable) && canRetryProduction && canLinkGroup && <Button
          type="button"
          className="shrink-0 max-sm:w-full"
          onClick={() => void retryGroup(group)}
          disabled={Boolean(busyKey)}
          /*
           * `Button`'s own busy state rather than a label swapped by hand: it carries the spinner and
           * sets `aria-busy`, which is what every other write in this app looks like while it runs.
           * A job of seven takes three minutes, so `busyLabel` is where it has got to.
           */
          busy={busyKey === group.key}
          busyLabel={progress || "Working..."}
        >
          {/*
            * What it does, not where it is: it links the group and then sends. How many are waiting
            * is on the row beside it, so the label does not count them a second time.
            */}
          Link group & retry
        </Button>}
      </li>)}
    </ul>}

  </section>}
  </>;
}
