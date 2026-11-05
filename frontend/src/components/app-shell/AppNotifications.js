"use client";

import { useRouter } from "next/navigation";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import useMeetingNotices from "@/components/sales/useMeetingNotices";
import useStoredNotifications from "@/components/app-shell/useStoredNotifications";
import useSourceNotices from "@/components/app-shell/useSourceNotices";

/**
 * The bell on the top bar: one panel for everything the application has to tell somebody.
 *
 * It used to be the meetings, and only the meetings — a control labelled "Notifications" that knew
 * about one module, and that a role without the Sales permission was shown as a dead icon. Tasks
 * would have made that two bells side by side, so there is one, and each half is drawn only for a
 * reader whose permission reaches it:
 *
 *   - Waiting on you: follow-ups due, clients who replied on WhatsApp, calls nobody has read,
 *     approvals in a queue. Gathered from every module and gated *per source* on the server, so
 *     this half needs no permission of its own here - an approver with no CRM access has approvals
 *     waiting on them, and a single gate would have shown them a bell that could never say so.
 *   - What the application has been told to tell this person: a task assigned, a task answered, a
 *     lead put in their name. Stored rows, gated on the server one *kind* at a time against the
 *     module each belongs to, so this half needs no permission of its own here either - it used to
 *     be gated on `HRM / Task Management`, which was right while Tasks was the only module writing
 *     rows and became wrong the moment the CRM did: a salesperson with no Tasks permission would
 *     have been the one person never told a lead was theirs.
 *   - Meetings, behind `SALES / CRM Leads`, which is what the meetings endpoint answers for.
 *
 * A reader who holds nothing gets an empty bell, which is the honest answer and the one case the
 * panel names. No half polls an endpoint its reader cannot call.
 *
 * They are unread in different ways on purpose. A task notification is a row with a `read_at`,
 * because being told to do something is a fact about the studio; a meeting or a waiting-on-you
 * notice is a list of ids in this browser, because it is one reader's glance at work that is
 * already on screen elsewhere. The badge adds all three, since there is one bell to look at.
 */
export default function AppNotifications({ onOpenMeetings }) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canReadMeetings = hasPermission("SALES", "CRM Leads", "READ");

  const stored = useStoredNotifications({
    // Every notice carries where it goes — a task to the Tasks page with that task's id, a lead to
    // the board with that lead open — and the page opens it on arrival. Routing is the bar's job
    // rather than the hook's; the fallback is the Tasks page because a row with no link at all can
    // only be one of the four task types, which are the ones written before `link` was always set.
    onOpen: (notification) => router.push(notification.link || "/hrm/tasks"),
  });
  const meetings = useMeetingNotices({ enabled: canReadMeetings, onOpenMeetings });
  /*
   * No `enabled` gate of its own: the endpoint answers for whatever modules this reader holds, and
   * which those are is the server's answer rather than one this component can work out. Somebody
   * who holds none of them simply gets nothing back.
   */
  const sources = useSourceNotices();

  const unread = sources.unreadCount + stored.unreadCount + meetings.unreadCount;

  /*
   * Always the menu, never a bare icon.
   *
   * With nothing to list, the bell used to be drawn as a plain button with nothing behind it - and
   * since a notice now leaves the bell once it is read, "nothing to list" became the ordinary state:
   * after reading everything, and in the moment before the first poll answers. Pressing it then did
   * nothing at all, which read as the bell being broken. Now it always opens, onto the line below
   * when there is nothing waiting.
   */
  /*
   * Waiting on you, then tasks, then the day's meetings, under rules.
   *
   * The order is how much of it is a thing to *do*. A follow-up that was due this morning and a
   * client who replied an hour ago are work that is late; a task is work addressed to this person
   * with no clock on it; a meeting notice is a reminder of something already in the diary. Each
   * half draws its own "nothing here" line, so the panel never opens empty.
   */
  const halves = [sources.items, stored.items, meetings.items].filter((half) => half.length);
  const items = halves.flatMap((half, index) => (index ? [{ separator: true }, ...half] : half));
  if (!items.length) items.push({ description: "You're all caught up - nothing waiting on you." });

  const title = sources.unreadCount
    ? `Waiting on you (${sources.unreadCount})`
    : meetings.todayCount && !stored.unreadCount
      ? `Today's Meetings (${meetings.todayCount})`
      : "Notifications";

  return (
    <OptionsMenu
      ariaLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
      /*
       * Opening the bell clears the glance-badges of the meetings and the waiting-on-you notices.
       * It does not mark the stored notices read any more: a read notice leaves the bell, so that
       * would empty it on sight. Each row goes only when it is opened - there is no "Mark as read".
       */
      onOpen={() => { meetings.markSeen(); sources.markSeen(); }}
      title={title}
      items={items}
      // Wide enough for a task title and who set it, or a time, a title and a client name, without
      // every row wrapping.
      // `w-80` still leaves a margin either side of a 360px phone; from `sm` up there is room to
      // show more of each title before it is cut.
      menuClassName="w-80 sm:w-96"
      /*
       * And capped in height, which no other menu in the application has needed.
       *
       * This is the one menu whose length is the studio's rather than the code's: every unplaced
       * call and every overdue follow-up is a row, so it ran to hundreds. Uncapped, a `fixed` menu
       * simply grows past the bottom of the window - the rows beyond it cannot be reached at all,
       * because the page behind does not scroll the menu and the menu had no scroller of its own.
       *
       * On the rows rather than on the whole panel, so the NOTIFICATIONS heading stays above them
       * instead of being scrolled past - and so there is no seam between the two for a scrolled row
       * to show through. `overscroll-contain` stops the wheel carrying on into the board once the
       * list ends.
       */
      menuBodyClassName="max-h-[60vh] overflow-y-auto overscroll-contain"
      // Above the app shell's own layers, since the bar it hangs from is sticky - the same value
      // the user menu beside it uses for the same reason.
      menuZIndexClassName="z-[120]"
      // No trigger classes of its own: `OptionsMenu`'s "plain" tone is the quiet icon this bar is
      // made of, and it already swaps to a pressed look while the panel is open.
      triggerContent={
        <span className="relative flex items-center justify-center">
          <BellIcon />
          {/* Only while something has not been looked at. A badge that survived being read would
              stop being read itself. */}
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold leading-none text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      }
    />
  );
}

/** Drawn as a path rather than an emoji, for the same reason the theme icons on this bar are. */
function BellIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a3 3 0 0 1-5.714 0M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
  </svg>;
}
