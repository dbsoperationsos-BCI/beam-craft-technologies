/**
 * **Every automatic message that can be switched off, and what switching it off answers.**
 *
 * Switching a notification off is an answer to the trouble it was having, not just a pause. The
 * studio has said the message is not to be sent, so nothing about it is still work to do - and
 * switching it back on starts that message **fresh**: it reports what goes wrong from then on, never
 * what went wrong in the world before it was switched off.
 *
 * That rule used to live six modules apart and was followed by some of them. It lives here now, so a
 * new notification obeys it by joining the list rather than by somebody remembering.
 *
 * A notification's trouble is recorded in two different kinds of place, and the rule needs both:
 *
 *   * **`lastError`** - one column per notification, "how the last try went", shown on its settings
 *     panel. It can simply be **cleared**, so switching off empties it and switching on leaves it
 *     empty until the next real attempt.
 *   * **The WhatsApp Activity Log** - one row per send, which the app-shell notice reads to list the
 *     messages waiting for a WhatsApp group. That log is the record of what happened and is never
 *     rewritten, so the failure cannot be cleared. What is recorded instead is **`offAt`**, the
 *     moment the studio switched the message off; anything that failed before it has been answered,
 *     and the notice ignores it for good. Only a message addressed to a group **by name** can appear
 *     in that notice, so only those carry an `offAt` column.
 *
 * `triggers` are the names the activity log files that message under (`whats_app_activity.trigger`).
 */
const SWITCHES = [
  {
    what: "the daily attendance WhatsApp report",
    model: "hrmSettings",
    enabled: "attendanceReportEnabled",
    lastError: "attendanceReportLastError",
    offAt: "attendanceReportOffAt",
    triggers: ["ATTENDANCE_REPORT"],
  },
  {
    what: "Photo Selection Submitted",
    model: "hrmSettings",
    enabled: "photoSelectionNotifyEnabled",
    lastError: "photoSelectionLastError",
    offAt: "photoSelectionOffAt",
    triggers: ["PHOTO_SELECTION_SUBMITTED"],
  },
  {
    what: "New Lead Welcome",
    model: "hrmSettings",
    enabled: "leadWelcomeEnabled",
    lastError: "leadWelcomeLastError",
    // Addressed to a lead, never to a group, so it cannot reach the group-failure notice.
    offAt: null,
    triggers: [],
  },
  {
    what: "Interview Welcome",
    model: "hrmSettings",
    enabled: "interviewWelcomeEnabled",
    lastError: "interviewWelcomeLastError",
    offAt: null,
    triggers: [],
  },
  {
    what: "the shoot crew notice - employees",
    model: "shootCrewNoticeSettings",
    enabled: "enabled",
    lastError: "lastError",
    offAt: null,
    triggers: [],
  },
  {
    what: "the shoot crew notice - vendors",
    model: "shootCrewNoticeSettings",
    enabled: "vendorEnabled",
    lastError: "vendorLastError",
    offAt: null,
    triggers: [],
  },
];

/**
 * What a switch writes **besides** the switch itself.
 *
 * Off: the standing error goes, and - for a message whose failures outlive it in the activity log -
 * the moment is recorded. On: nothing. A switch that wrote anything here while turning a message
 * **on** would be undoing what a live send had just reported.
 */
function switchOffData(enabledField, enabled, { now = () => new Date() } = {}) {
  if (enabled) return {};
  const entry = SWITCHES.find((row) => row.enabled === enabledField);
  if (!entry) return {};
  return { [entry.lastError]: null, ...(entry.offAt ? { [entry.offAt]: now() } : {}) };
}

/** The switches kept on one settings model, for reading them all in one query. */
const onModel = (model) => SWITCHES.filter((entry) => entry.model === model);

/**
 * Where each name-addressed message stands right now: whether it is off, and the moment before which
 * its failures have been answered. Keyed by the trigger the activity log files it under.
 */
async function switchStates(client, { model = "hrmSettings" } = {}) {
  const entries = onModel(model).filter((entry) => entry.triggers.length);
  const select = Object.fromEntries(entries.flatMap((entry) => [[entry.enabled, true], ...(entry.offAt ? [[entry.offAt, true]] : [])]));
  // No settings row at all: every switch reads as its own default, which is what the senders do.
  const row = Object.keys(select).length ? await client[model].findFirst({ select }).catch(() => null) : null;
  const states = new Map();
  for (const entry of entries) {
    const state = {
      off: Boolean(row && row[entry.enabled] === false),
      answeredBefore: entry.offAt && row?.[entry.offAt] ? new Date(row[entry.offAt]).getTime() : null,
    };
    for (const trigger of entry.triggers) states.set(trigger, state);
  }
  return states;
}

/**
 * Whether this logged failure has been answered by its message's switch: either the message is off
 * now, or it failed before the last time it was switched off and has since been switched back on.
 */
function answeredBySwitch(activity, states) {
  const state = states.get(activity?.trigger);
  if (!state) return false;
  if (state.off) return true;
  const at = new Date(activity.createdAt || activity.updatedAt || 0).getTime();
  return state.answeredBefore !== null && at <= state.answeredBefore;
}

module.exports = { SWITCHES, switchOffData, switchStates, answeredBySwitch, onModel };
