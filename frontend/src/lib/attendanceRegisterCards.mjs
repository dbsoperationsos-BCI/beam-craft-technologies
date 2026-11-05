/**
 * What the Attendance Register's Irregularities and Request cards say about each entry - kept free of
 * React so `node --test` can read it.
 */

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || "")) ? dayFormat.format(new Date(`${iso}T00:00:00Z`)) : String(iso || ""));

const PENDING_LABELS = { LEAVE: "Leave request pending", COMP_OFF: "Comp-off request pending" };

/**
 * One irregularity's line under the name: why the day reads Absent, and which day when it is not the
 * one shown (a flexible shift is judged the day after).
 */
export function irregularityNote(item, shownDate) {
  const parts = [item?.loggedIn ? "Logged in, but not enough for a half day" : "No login, no approved leave"];
  if (item?.date && item.date !== shownDate) parts.push(`${item.flexible ? "Flexible shift, " : ""}${dayLabel(item.date)}`);
  return parts.join(" · ");
}

/**
 * The Irregularities card's two tabs. **Today** is everybody on a fixed shift absent on the day shown;
 * **Yesterday** is everybody on a flexible shift absent the day before - their day is only judged
 * once it is over, so the server never lists them for today (`registerIrregularities`).
 */
export function irregularityTabs(items) {
  const list = items || [];
  return [
    { id: "today", label: "Today", items: list.filter((item) => !item?.flexible) },
    { id: "yesterday", label: "Yesterday", items: list.filter((item) => item?.flexible) },
  ];
}

/**
 * A leave or comp-off asked for that day and still waiting on its approvers - said apart, as a pill,
 * since it changes what to do: chase the approver rather than the person. "" when there is none.
 */
export const pendingRequestLabel = (item) => PENDING_LABELS[item?.pendingRequest] || "";

/** A request's line under the name: its kind, and the days or hours it asks for. */
export function requestSummary(request, typeLabels = {}) {
  const kind = typeLabels[request?.type] || String(request?.type || "Request");
  const leave = request?.type === "LEAVE" && request?.leaveType ? ` (${request.leaveType})` : "";
  const from = dayLabel(request?.fromDate);
  const to = dayLabel(request?.toDate);
  const days = !request?.toDate || request.toDate === request.fromDate ? from : `${from} - ${to}`;
  const hours = request?.type === "PERMISSION" && request?.fromTime && request?.toTime ? `, ${request.fromTime} - ${request.toTime}` : "";
  return `${kind}${leave} · ${days}${hours}`;
}
