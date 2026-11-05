/**
 * What each CRM report shows, and what its filter bar means.
 *
 * Six reports over one table, so their columns are declared together rather than each page-worth
 * being written out where it is rendered. Keeping them here means the tabs, the table and the CSV
 * export all read the same definition - a column added to a report cannot appear in one and not the
 * others - and it keeps the page component to the layout and the fetching.
 *
 * Pure: no React, no requests. Every helper here can be read and tested on its own.
 */

/*
 * The studio's clock, which every date and time in Reports is read on.
 *
 * Asia/Kolkata explicitly, rather than whatever zone the browser is in: the range a report is
 * built from is the studio's day, so the dates printed against it have to be the studio's day
 * too. See `dateTime` below for the whole of it.
 */
const REPORT_ZONE = "Asia/Kolkata";

/** Nothing chosen. Spread over a range to make the filter bar's starting state. */
export const EMPTY_FILTERS = {
  from: "",
  to: "",
  // A **list**: the Employee filter takes several people, so "how did the team do last week" is one
  // report rather than one per name added up by hand. Every other filter is still one answer.
  employee: [],
  vertical: "",
  callType: "",
  duration: "",
};

/** The studio's day, so a report opened just after midnight IST is today's, not yesterday's. */
export function studioToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/**
 * The range a report opens on: the last thirty days, ending today.
 *
 * A report with no range would read the whole call log, which grows without limit and is not a
 * question anybody asks. Thirty days is the month people mean when they say "recently", and the
 * dates are shown in the bar so it is a starting point rather than a hidden filter.
 */
export function defaultRange(now = new Date(), days = 30) {
  const to = studioToday(now);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to };
}

export function hasFilters(filters = {}) {
  return Object.entries(filters).some(([key, value]) => {
    if (key === "from" || key === "to") return false;
    // A list is answered when it holds something; `String([])` is "" but `String(["A"])` is "A",
    // so the plain test below would have read a one-name list correctly and an empty one as blank
    // only by accident. Asked properly instead.
    if (Array.isArray(value)) return value.length > 0;
    return String(value ?? "").trim() !== "";
  });
}

/**
 * "1 Aug 2026 to 31 Aug 2026", or what to say when a report has no range at all.
 *
 * Printed in the studio's own zone, like every other date here. Without the zone the day was read
 * back in the browser's - so west of UTC this line said "31 Jul to 30 Aug" over a report actually
 * built from 1 Aug to 31 Aug, which is the range line disagreeing with the range.
 */
export function describeRange(filters = {}) {
  const format = (iso) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "";
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: REPORT_ZONE }).format(new Date(`${iso}T00:00:00Z`));
  };
  const from = format(filters.from);
  const to = format(filters.to);
  if (from && to) return from === to ? from : `${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Up to ${to}`;
  return "All dates";
}

/**
 * What the report on screen was actually built from, in words.
 *
 * Deliberately describes the *applied* filters rather than the bar's current contents: somebody
 * halfway through changing the dates is looking at numbers that do not match what the bar says, and
 * this is the line that tells them so.
 */
export function filterSummary(filters = {}, options = {}) {
  const parts = [describeRange(filters)];
  /*
   * The people chosen, by their own labels. Two are named; more are counted, because a line meant to
   * say what a report is showing stops doing that once it is a list of eleven names.
   */
  const chosen = Array.isArray(filters.employee) ? filters.employee : [filters.employee].filter(Boolean);
  if (chosen.length) {
    const labelFor = (value) => (options.employees || []).find((option) => option.value === value)?.label || value;
    parts.push(chosen.length <= 2 ? chosen.map(labelFor).join(" & ") : `${chosen.length} employees`);
  }
  if (filters.vertical) parts.push(filters.vertical);
  if (filters.callType) parts.push(filters.callType);
  const duration = (options.durations || []).find((option) => option.value === filters.duration);
  if (filters.duration) parts.push(duration?.label || filters.duration);
  return `Showing: ${parts.join(" · ")}`;
}

/**
 * Every date and time in Reports, in the one form the studio reads.
 *
 * ── Twelve hours, not twenty-four ─────────────────────────────────────────────────────────────
 *
 * `en-IN`, which is what makes a call at 17:58 read as "2 Sept 2026, 5:58 pm". These were `en-GB`,
 * which prints the twenty-four hour clock - a report of an Indian studio's own working day, in a
 * clock nobody in it uses. `en-GB` with `hour12` on is not the same thing: it pads the hour, so
 * five in the evening reads "05:58 pm", which is neither convention. The locale carries the whole
 * rule - the hour unpadded, the meridiem lower case - so there is nothing here to keep in step.
 *
 * ── The studio's clock, not the reader's ──────────────────────────────────────────────────────
 *
 * Asia/Kolkata, explicitly, rather than whatever zone the browser happens to be in. The range these
 * reports are built from is already the studio's day - `studioToday` above pins the same zone - so
 * a timestamp rendered in another zone could sit outside the range printed above it, and a call
 * just before midnight IST would be filed on the report of a day it was not made on. One zone for
 * the filtering and the reading both.
 *
 * Blank rather than "Invalid Date" when there is nothing to show: an empty cell is an honest
 * answer to a call that has not happened, and the words are not.
 */
export function dateTime(value) {
  if (!value) return "";
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: REPORT_ZONE }).format(stamp);
}

export function dateOnly(value) {
  if (!value) return "";
  /*
   * A plain "2026-08-31" is read as that day rather than as a moment: parsed as local time it
   * lands on the 30th west of UTC, which is how a report's dates start disagreeing with the dates
   * that produced them. Read as UTC midnight and printed in the studio's zone, it stays the 31st.
   */
  const stamp = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(stamp.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: REPORT_ZONE }).format(stamp);
}

/**
 * The clock time alone, for the two ends of a working day.
 *
 * The date is already a column of its own on that report, so printing it again in "Started" and
 * "Finished" would put the same day on a row three times. The studio's zone and the twelve-hour
 * clock, for the reasons `dateTime` above sets out at length.
 */
export function clockTime(value) {
  if (!value) return "";
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: REPORT_ZONE }).format(stamp);
}

const number = (value) => Number(value || 0).toLocaleString();

/**
 * Time on task, for sorting.
 *
 * The server sends both the seconds and the words - "2h 53m" - because it is the one place that
 * knows how the sittings were counted, and the table and the exported CSV must not round it two
 * different ways. This is only the number the column sorts on, so "46m" files below "2h 53m"
 * instead of alphabetically above it.
 */
export function usageSeconds(row = {}) {
  return Number(row.usageSeconds) || 0;
}

/** The same, for the idle figure beside it - so both columns sort by time rather than by text. */
export function inactiveSeconds(row = {}) {
  return Number(row.inactiveSeconds) || 0;
}

/*
 * The six reports.
 *
 * `value` is what the column holds - used for sorting, filtering and the CSV alike, so the file
 * exported is the table that was on screen. `render` is only for a cell that needs to look like
 * something other than its value.
 */
export const REPORTS = [
  {
    id: "summary",
    label: "Summary",
    emptyMessage: "No calls in this range.",
    /*
     * A day a row, and the totals for the range in the table's own footer.
     *
     * It was a row of figure cards above a table - two shapes for one answer, and the cards were
     * reading a field the table was not, so they said nine calls over an empty table. One table,
     * the same as the other five reports.
     */
    columns: [
      { id: "day", label: "Date", value: (row) => dateOnly(row.day), width: 170 },
      { id: "calls", label: "Calls", value: (row) => row.calls, render: (row) => number(row.calls), width: 110 },
      { id: "clients", label: "Clients", value: (row) => row.clients, render: (row) => number(row.clients), width: 110 },
      { id: "connected", label: "Connected", value: (row) => row.connected, render: (row) => number(row.connected), width: 130 },
      { id: "notConnected", label: "Not Connected", value: (row) => row.notConnected, render: (row) => number(row.notConnected), width: 150 },
      { id: "totalDuration", label: "Talk Time", value: (row) => row.totalDuration, width: 130 },
      { id: "averageDuration", label: "Average Call", value: (row) => row.averageDuration, width: 140 },
    ],
  },
  {
    id: "employee-analysis",
    label: "Employee Analysis",
    emptyMessage: "Nobody made a call in this range.",
    columns: [
      { id: "employee", label: "Employee", value: (row) => row.employee, width: 220 },
      { id: "calls", label: "Calls", value: (row) => row.calls, render: (row) => number(row.calls), width: 110 },
      { id: "clients", label: "Clients", value: (row) => row.clients, render: (row) => number(row.clients), width: 110 },
      { id: "connected", label: "Connected", value: (row) => row.connected, render: (row) => number(row.connected), width: 130 },
      { id: "notConnected", label: "Not Connected", value: (row) => row.notConnected, render: (row) => number(row.notConnected), width: 150 },
      { id: "totalDuration", label: "Talk Time", value: (row) => row.totalDuration, width: 130 },
      { id: "averageDuration", label: "Average Call", value: (row) => row.averageDuration, width: 140 },
      { id: "lastCalledAt", label: "Last Call", value: (row) => dateTime(row.lastCalledAt), width: 180 },
    ],
  },
  {
    id: "lead-analysis",
    label: "Lead Analysis",
    emptyMessage: "No clients were called in this range.",
    columns: [
      { id: "client", label: "Client", value: (row) => row.client, width: 200 },
      { id: "clientNumber", label: "Number", value: (row) => row.clientNumber, width: 170 },
      { id: "vertical", label: "Vertical", value: (row) => row.vertical, width: 130 },
      { id: "status", label: "Status", value: (row) => row.status, width: 140 },
      { id: "crm", label: "CRM", value: (row) => row.crm, width: 150 },
      { id: "calls", label: "Calls", value: (row) => row.calls, render: (row) => number(row.calls), width: 100 },
      { id: "connected", label: "Connected", value: (row) => row.connected, render: (row) => number(row.connected), width: 130 },
      { id: "totalDuration", label: "Talk Time", value: (row) => row.totalDuration, width: 130 },
      { id: "firstCalledAt", label: "First Call", value: (row) => dateTime(row.firstCalledAt), width: 180 },
      { id: "lastCalledAt", label: "Last Call", value: (row) => dateTime(row.lastCalledAt), width: 180 },
      { id: "enquiryId", label: "Enquiry ID", value: (row) => row.enquiryId, width: 170 },
    ],
  },
  {
    id: "never-attended",
    label: "Never Attended",
    // What the report is for, said where an empty one would otherwise look like a fault.
    emptyMessage: "Every client who called was answered. Nothing to chase.",
    columns: [
      { id: "client", label: "Client", value: (row) => row.client, width: 200 },
      { id: "clientNumber", label: "Number", value: (row) => row.clientNumber, width: 170 },
      { id: "vertical", label: "Vertical", value: (row) => row.vertical, width: 130 },
      { id: "attempts", label: "Attempts", value: (row) => row.attempts, render: (row) => number(row.attempts), width: 120 },
      { id: "employee", label: "Last Rang", value: (row) => row.employee, width: 180 },
      { id: "lastCalledAt", label: "Last Attempt", value: (row) => dateTime(row.lastCalledAt), width: 190 },
      { id: "status", label: "Status", value: (row) => row.status, width: 140 },
      { id: "enquiryId", label: "Enquiry ID", value: (row) => row.enquiryId, width: 170 },
    ],
  },
  {
    id: "not-picked-up",
    label: "Not Picked Up",
    emptyMessage: "Every client the studio rang picked up.",
    columns: [
      { id: "client", label: "Client", value: (row) => row.client, width: 200 },
      { id: "clientNumber", label: "Number", value: (row) => row.clientNumber, width: 170 },
      { id: "vertical", label: "Vertical", value: (row) => row.vertical, width: 130 },
      { id: "attempts", label: "Attempts", value: (row) => row.attempts, render: (row) => number(row.attempts), width: 120 },
      { id: "employee", label: "Called By", value: (row) => row.employee, width: 180 },
      { id: "lastCalledAt", label: "Last Attempt", value: (row) => dateTime(row.lastCalledAt), width: 190 },
      { id: "status", label: "Status", value: (row) => row.status, width: 140 },
      { id: "enquiryId", label: "Enquiry ID", value: (row) => row.enquiryId, width: 170 },
    ],
  },
  {
    id: "call-history",
    label: "Call History",
    emptyMessage: "No calls in this range.",
    /*
     * The columns a call report is read in, in that order: who called, who they called, how many
     * times, when, for how long, how it went, and what was written down. The lead's own created
     * date and status sit beside the call because the question being asked of this table is usually
     * "is this lead being worked", which the call alone does not answer.
     *
     * Vertical, method, recording and the enquiry id follow at the end - this CRM's own data, which
     * a call log on its own does not have.
     */
    columns: [
      { id: "employee", label: "Employee", value: (row) => row.employee, width: 170 },
      { id: "client", label: "Lead Name", value: (row) => row.client, width: 190 },
      { id: "clientNumber", label: "Lead Number", value: (row) => row.clientNumber, width: 170 },
      // Within the range on screen, not all time - it narrows with the filters, so it always
      // agrees with the rows being looked at.
      { id: "attempts", label: "No of Attempts", value: (row) => row.attempts, render: (row) => number(row.attempts), width: 150 },
      { id: "calledAt", label: "Call Time", value: (row) => dateTime(row.calledAt), width: 180 },
      { id: "duration", label: "Duration", value: (row) => row.duration, width: 120 },
      { id: "callType", label: "Call Type", value: (row) => row.callType, width: 130 },
      { id: "leadCreatedDate", label: "Lead Created Date", value: (row) => dateOnly(row.leadCreatedDate), width: 180 },
      { id: "leadStatus", label: "Lead Status", value: (row) => row.leadStatus, width: 150 },
      { id: "note", label: "Notes", value: (row) => row.note, width: 260 },
      { id: "vertical", label: "Vertical", value: (row) => row.vertical, width: 130 },
      { id: "callMethod", label: "Method", value: (row) => row.callMethod, width: 140 },
      // Whether there is one, not where: a recording URL is the client's own voice and does not
      // belong in a file that gets exported and emailed around.
      { id: "hasRecording", label: "Recording", value: (row) => (row.hasRecording ? "Yes" : "No"), width: 120 },
      { id: "enquiryId", label: "Enquiry ID", value: (row) => row.enquiryId, width: 170 },
    ],
  },
  /*
   * The two usage reports.
   *
   * They answer a different question from the six above and off different tables: those are about
   * the Callyzer employee who made a call, these are about the ERP user who did something in this
   * system. The two are not the same list of people and are deliberately not joined - a Callyzer
   * employee is a phone, an ERP user is a login, and matching them on a name would put one person's
   * work under another's row.
   */
  {
    id: "whatsapp-usage",
    label: "WhatsApp Usage",
    emptyMessage: "No WhatsApp messages in this range.",
    columns: [
      { id: "employee", label: "Employee", value: (row) => row.employee, width: 200 },
      { id: "messages", label: "Messages", value: (row) => row.messages, render: (row) => number(row.messages), width: 130 },
      /*
       * How long they actually spent on it, beside the count - which is the reading order: "108
       * messages, 46 minutes".
       *
       * Sorted on the seconds behind it, so "46m" files below "2h 53m" rather than alphabetically
       * above it.
       */
      { id: "usage", label: "Usage", value: usageSeconds, render: (row) => row.usage || "0m", width: 120 },
      { id: "sent", label: "Sent", value: (row) => row.sent, render: (row) => number(row.sent), width: 110 },
      { id: "received", label: "Received", value: (row) => row.received, render: (row) => number(row.received), width: 130 },
      { id: "leads", label: "Leads Messaged", value: (row) => row.leads, render: (row) => number(row.leads), width: 160 },
      { id: "attachments", label: "Attachments", value: (row) => row.attachments, render: (row) => number(row.attachments), width: 140 },
      /*
       * The WhatsApp calls Callyzer reports, beside the messages.
       *
       * Named as calls rather than folded into the message counts, because the two are matched by
       * name across two identities - a login and a handset - and a reader should be able to see
       * which half a number came from.
       */
      { id: "calls", label: "Calls", value: (row) => row.calls, render: (row) => number(row.calls), width: 110 },
      { id: "callTime", label: "Call Time", value: (row) => row.callSeconds || 0, render: (row) => row.callTime || "0m", width: 130 },
      { id: "firstAt", label: "First Message", value: (row) => dateTime(row.firstAt), width: 180 },
      { id: "lastAt", label: "Last Message", value: (row) => dateTime(row.lastAt), width: 180 },
    ],
  },
  {
    id: "application-usage",
    label: "Application Usage",
    emptyMessage: "Nobody changed a lead in this range.",
    columns: [
      { id: "employee", label: "Employee", value: (row) => row.employee, width: 200 },
      // What they did, rather than how often they signed in: opening the page is not using it.
      /*
       * `actionCount`, not `actions`.
       *
       * `DataTable` reserves the id `actions` for its own menu column - it swaps that head for the
       * ⋮, centres it and leaves it out of the CSV. So this column, which counts what somebody did,
       * had its heading taken away and replaced by nothing: the numbers were right and the word
       * "Actions" was simply gone. The id is the table's, the label is ours.
       */
      { id: "actionCount", label: "Actions", value: (row) => row.actions, render: (row) => number(row.actions), width: 120 },
      // The same measure WhatsApp usage takes, so the two columns read as one thing.
      { id: "usage", label: "Usage", value: usageSeconds, render: (row) => row.usage || "0m", width: 120 },
      /*
       * Time signed in and idle, beside the time actually spent working.
       *
       * A stretch of use ends when somebody stops touching anything for the usage timeout - set in
       * Settings, Application Monitoring - and a new one begins when they come back. The gaps
       * between a day's stretches are this figure. Summed per day rather than across the range, or
       * every night and weekend between the first day and the last would be counted as idle.
       *
       * Sorted on the seconds like Usage beside it, so "46m" files below "2h 53m" rather than above
       * it on the alphabet.
       */
      { id: "inactive", label: "Inactive Time Track", value: inactiveSeconds, render: (row) => row.inactive || "0m", width: 170 },
      { id: "leads", label: "Leads Worked", value: (row) => row.leads, render: (row) => number(row.leads), width: 150 },
      { id: "created", label: "Created", value: (row) => row.created, render: (row) => number(row.created), width: 120 },
      { id: "updates", label: "Updates", value: (row) => row.updates, render: (row) => number(row.updates), width: 120 },
      { id: "statusChanges", label: "Status Changes", value: (row) => row.statusChanges, render: (row) => number(row.statusChanges), width: 160 },
      { id: "remarks", label: "Remarks", value: (row) => row.remarks, render: (row) => number(row.remarks), width: 120 },
      { id: "lastAt", label: "Last Action", value: (row) => dateTime(row.lastAt), width: 180 },
      { id: "lastLoginAt", label: "Last Sign-in", value: (row) => dateTime(row.lastLoginAt), width: 180 },
    ],
  },
  /*
   * Work Hours: the timesheet.
   *
   * Application Usage beside it answers "how long has this person been in the application over the
   * range" - one number per person, however long the range. This is the question a timesheet asks:
   * *which days, and how long on each*. So a fortnight is fourteen rows per person, a day nobody
   * worked has no row at all, and the day is the unit throughout.
   *
   * ── Work Hours is Call Hours plus Application Usage ──
   *
   * The hours column used to be the application alone, and it undercounted the job it was measuring:
   * the people this report is read about spend their day on the phone, and a salesperson on a
   * forty-minute call is not touching the browser - so the browser recorded nothing and the
   * timesheet read that forty minutes as idle. Both halves are now shown beside the total, because a
   * manager reading a short day needs to know which of the two it was short on.
   *
   * It is effort across two systems rather than wall clock, and it can exceed the length of the day:
   * a call taken with the application open counts in both halves, because both are true and nothing
   * records which minutes overlapped. Day Span is what stays wall clock, which is why it sits beside
   * them.
   *
   * The arithmetic is the server's - Application Usage plus Call Hours is Work Hours, sent already
   * added up so the row cannot disagree with itself. Every time column sorts on its seconds rather
   * than on the text, or "46m" would file above "2h 53m" on the alphabet.
   */
  {
    id: "work-hours",
    label: "Work Hours",
    emptyMessage: "Nobody used the application or made a call in this range.",
    columns: [
      { id: "employee", label: "Employee", value: (row) => row.employee, width: 200 },
      { id: "day", label: "Date", value: (row) => dateOnly(row.day), width: 160 },
      // The two ends of the day, as the clock alone - the date is the column before this one.
      // Across both halves, so a day that began with a call before anybody opened the application
      // starts when it actually started.
      { id: "firstAt", label: "Started", value: (row) => clockTime(row.firstAt), width: 130 },
      { id: "lastAt", label: "Finished", value: (row) => clockTime(row.lastAt), width: 130 },
      /*
       * The hours, and the only column here anybody is really after: the phone and the application
       * added together.
       */
      { id: "worked", label: "Work Hours", value: (row) => Number(row.workedSeconds) || 0, render: (row) => row.worked || "0m", width: 140 },
      /*
       * The two halves it is made of, in the order they are spoken about.
       *
       * Call Hours is what Callyzer reports for that person on that day, matched to the login by
       * name - there is no id joining a handset to an account, and this is the same match WhatsApp
       * Usage already makes. Application Usage is the measured browser time, the same figure the
       * Application Usage report shows, so the two screens can be read against each other.
       */
      { id: "callHours", label: "Call Hours", value: (row) => Number(row.callSeconds) || 0, render: (row) => row.callHours || "0m", width: 130 },
      { id: "appUsage", label: "Application Usage", value: (row) => Number(row.appSeconds) || 0, render: (row) => row.appUsage || "0m", width: 170 },
      // How many calls that time came from - a two-hour day made of six calls and one made of
      // sixty are different days, and the column beside it cannot say which.
      { id: "calls", label: "Calls", value: (row) => row.calls, render: (row) => number(row.calls), width: 110 },
      // Signed in and not touching anything: the gaps between the day's application stretches.
      // Measured against that half alone - nothing says which idle minutes were spent on which
      // call, and a figure guessed at is worse than one that is plainly the browser's own.
      { id: "idle", label: "Idle", value: (row) => Number(row.idleSeconds) || 0, render: (row) => row.idle || "0m", width: 120 },
      // First activity to last, which is the length of the working day rather than the work in it.
      { id: "span", label: "Day Span", value: (row) => Number(row.spanSeconds) || 0, render: (row) => row.span || "0m", width: 140 },
      // How many times they came back to it. One unbroken sitting reads 1.
      { id: "sittings", label: "Sittings", value: (row) => row.sittings, render: (row) => number(row.sittings), width: 120 },
    ],
  },
];

/**
 * What makes one report row different from every other.
 *
 * The table needs a key per row, and a report has no id column to offer: its rows are the *result*
 * of a grouping rather than records, so what identifies one is whatever it was grouped by. That
 * differs per report - a day on Summary, a person on Employee Analysis, a person *and* a day on
 * Work Hours - so the key is everything that could be part of a grouping, joined.
 *
 * It used to be a chain of `||`, which took the first field that had a value and stopped. Work
 * Hours is grouped by two, so every employee's row for the same date came out under that date alone
 * and React was handed twelve rows all keyed `2026-09-02` - which it warns about because it is then
 * free to duplicate or drop them.
 *
 * The index is the last resort rather than the first: a key that is only a position changes under
 * sorting and filtering, and a row would lose its identity every time the table was reordered.
 */
export function reportRowId(row = {}, index = 0) {
  const parts = [row.id, row.enquiryId, row.employee, row.clientNumber, row.employeeNumber, row.day]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join("|") : String(index);
}

/** The reports that read the ERP user's own work rather than the Callyzer employee's calls. */
export const USAGE_REPORTS = new Set(["whatsapp-usage", "application-usage", "work-hours"]);

/**
 * The filters a report could not honour, said plainly.
 *
 * The usage reports have no vertical, call type or duration to filter on, so those are ignored
 * rather than returning nothing. A filter that is set and quietly not applied is worse than one
 * that is not offered, so the page says which.
 */
const FILTER_LABELS = { vertical: "vertical", callType: "call type", callMethod: "call method", duration: "duration" };

export function ignoredNote(ignored = []) {
  if (!ignored.length) return "";
  const names = ignored.map((key) => FILTER_LABELS[key] || key);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `The ${list} filter${names.length === 1 ? " does" : "s do"} not apply to this report.`;
}

/**
 * The Summary's totals for the whole range, as one line.
 *
 * Shown in the table's footer beside the row count rather than as cards above it: a report is a
 * table on this page, and a second shape saying the same thing is what let the two disagree.
 */
export function totalsSummary(totals = {}) {
  const parts = [
    `${number(totals.calls)} call${totals.calls === 1 ? "" : "s"}`,
    `${number(totals.connected)} connected`,
    `${number(totals.clients)} client${totals.clients === 1 ? "" : "s"}`,
    `${number(totals.leads)} lead${totals.leads === 1 ? "" : "s"}`,
  ];
  if (totals.totalDuration) parts.push(`${totals.totalDuration} talk time`);
  if (totals.averageDuration) parts.push(`${totals.averageDuration} average`);
  return parts.join(" · ");
}

/*
 * The column that carries the table's own menu.
 *
 * `DataTable` puts Manage Columns, CSV export and the compact toggle in the head of a column whose
 * id is exactly `actions` - and if no column has that id, it renders them nowhere. Every report here
 * asked for `columnVisibility` and `csvExport` and got neither: the features were on and the control
 * that reaches them did not exist, so a report could not be exported and its columns could not be
 * hidden. Every other table in the application declares this column; these did not.
 *
 * It has no label because its head is the ⋮ itself, and it sorts and filters on nothing because a
 * menu is not a value.
 */
const ACTIONS_COLUMN = {
  id: "actions",
  label: "",
  value: () => "",
  fixed: true,
  sortable: false,
  filterable: false,
  width: 56,
  minWidth: 56,
};

// Appended once, here, rather than repeated in eight definitions where one could be forgotten.
for (const report of REPORTS) report.columns.push(ACTIONS_COLUMN);

/** One report by id, falling back to the first rather than to nothing a page cannot render. */
export function reportById(id) {
  return REPORTS.find((entry) => entry.id === id) || REPORTS[0];
}
