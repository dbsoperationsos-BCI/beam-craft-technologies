/**
 * How the Interview record shows the things a candidate sends that are not plain text.
 *
 * The shared info panel formats what every module has — dates, yes/no, images — and takes anything
 * shaped like this as a formatter keyed by the field's type, the same arrangement
 * `projectInfoFormatters` uses for a project's shoots. These live with the module because nothing
 * else holds them.
 */

/** A file name that fits a 20rem column, keeping the extension, which is half of what it says. */
function shortName(name, url) {
  const raw = String(name || "").trim() || String(url || "").split("/").pop() || "Attachment";
  if (raw.length <= 34) return raw;
  const dot = raw.lastIndexOf(".");
  // No extension, or one so long it is not one: cut the name and let the ellipsis say so.
  if (dot < 1 || raw.length - dot > 8) return `${raw.slice(0, 31)}…`;
  return `${raw.slice(0, 30 - (raw.length - dot))}…${raw.slice(dot)}`;
}

/**
 * The files attached to an application, each as the name the candidate's own file carried.
 *
 * Named rather than numbered, because "Diploma.pdf" is the answer to what was attached and
 * "Attachment 2" is not — and each opens in a new tab with no referrer, the way every other stored
 * file in the register is opened.
 *
 * A list this panel is 20rem wide for, so the names wrap rather than truncate the column: one per
 * line, which is also how somebody reads down a list of documents looking for one of them.
 */
function attachmentList(files) {
  const rows = (Array.isArray(files) ? files : []).filter((file) => file && (file.url || file.data));
  if (!rows.length) return "—";
  return <ul className="space-y-1">
    {rows.map((file, index) => <li key={`${file.url || file.name}-${index}`}>
      <a
        href={file.url || file.data}
        target="_blank"
        rel="noopener noreferrer"
        // The row's own click must not fire as well, or opening a file also opens the info panel.
        onClick={(event) => event.stopPropagation()}
        className="break-all text-blue-600 underline-offset-2 hover:underline"
      >
        {shortName(file.name, file.url)}
      </a>
    </li>)}
  </ul>;
}

/**
 * A Meet link on the record: the thing to press, not the address to read.
 *
 * It was printed as 40-odd characters of URL, so joining a call meant selecting it and pasting it
 * somewhere. A **new tab**, with `noopener noreferrer` - following it must never navigate the
 * register away from whoever is reading it.
 */
function meetLink(value) {
  const url = String(value || "").trim();
  if (!url) return "—";
  return <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    onClick={(event) => event.stopPropagation()}
    className="break-all text-blue-600 underline-offset-2 hover:underline"
  >
    Join the meeting
  </a>;
}

/**
 * Every remark written against a candidate as their stage moved, newest first, each with the stage
 * it was written at and the day.
 *
 * Newest first although they are stored oldest-first: the reason anybody opens this is where the
 * candidate is now, and the ones before it are the history behind it.
 *
 * A **Follow Up** entry also carries the day that was promised - "called on the 8th, try again on
 * the 15th" - because the record holds only the *next* follow-up date, so a candidate chased three
 * times would otherwise show the latest day and nothing about what was agreed the other two times.
 */
function decisionList(entries) {
  const rows = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.note);
  if (!rows.length) return "—";
  return <ul className="space-y-2">
    {rows.slice().reverse().map((entry, index) => <li key={`${entry.at || entry.status}-${index}`}>
      <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">
        {entry.status}
        {entry.at && <span className="ml-1.5 font-normal text-slate-400">{formatDay(entry.at)}</span>}
        {entry.nextFollowUpDate && <span className="ml-1.5 font-normal text-slate-400">· next {formatDay(entry.nextFollowUpDate)}</span>}
      </p>
      <p className="whitespace-pre-line break-words text-slate-700">{entry.note}</p>
    </li>)}
  </ul>;
}

/** The day a decision was taken, or nothing where the stamp is not a date this can read. */
function formatDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

const interviewInfoFormatters = {
  statusNotes: decisionList,
  attachments: attachmentList,
  meetLink,
  // The same reading the table's own cell gives: a count shown as the round it makes, and nothing
  // where nobody has been called - a candidate with no rounds is not on round zero.
  round: (value) => (Number(value) > 0 ? `Round ${value}` : "—"),
};

export default interviewInfoFormatters;
