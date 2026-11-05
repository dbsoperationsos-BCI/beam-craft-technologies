import { apiRequest } from "@/services/api/client";

/**
 * The candidate register behind the Interview screen, and the application forms sent from it.
 *
 * All of it answers for `HRM / Interview`, the permission that opens the screen: READ reads the
 * register and the option lists, READ_WRITE adds, edits, imports and deletes, and raises, corrects,
 * cancels or sends an application form. The linked Google Sheets that also write the register are
 * `interviewSheetLinks.service.js`; the candidate's own side of the form is
 * `services/interview/application.service.js`, which needs no session.
 */

/** How many candidates a page holds. The CRM lead board's own, and the server's ceiling is 500. */
export const CANDIDATE_PAGE_SIZE = 100;

/** The pickers the Add Application form draws from: interviewers, departments, positions, branches, and the fixed lists. */
export function getInterviewOptions() {
  return apiRequest("/api/hrm/interview/options");
}

/**
 * One page of the register, newest first; `status` narrows to one stage.
 *
 * Answers `{ data, total, counts }` - the page, how many the tab holds in all, and every tab's
 * count, so the footer and the tab row describe the register rather than what has been scrolled in.
 * `appending` is a scroll fetching the next page and leaves `total` and `counts` off: the set
 * cannot change under the reader, so the screen keeps the numbers it already has.
 *
 * The whole register used to arrive in one response, which is why the screen sat on "Loading
 * candidates..." for as long as it did once there were thousands of them.
 */
/** Column filters as one JSON parameter, left off entirely when there are none. */
const withFilters = (params, filters) => {
  const entries = Object.entries(filters || {}).filter(([, value]) => (Array.isArray(value) ? value.length : String(value ?? "").trim()));
  if (entries.length) params.set("filters", JSON.stringify(Object.fromEntries(entries)));
  return params;
};

export function getCandidates(status, { offset = 0, limit = CANDIDATE_PAGE_SIZE, appending = false, filters = {} } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  withFilters(params, filters);
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  if (appending) params.set("appending", "true");
  return apiRequest(`/api/hrm/interview/candidates?${params.toString()}`);
}

/**
 * Every candidate id the stage matches, for a "select all" over a register read a page at a time.
 *
 * The browser has only rendered the rows scrolled into view, so it cannot hand a bulk action the
 * ids of a selection it never drew. This is the one question it has to ask: which ids does the tab
 * in front of me match? Answers `{ data, truncated, max }` - `truncated` says the register is larger
 * than one selection may cover, which the screen refuses rather than acting on a silent slice.
 */
export function getCandidateIds(status, filters = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  // The same rows the table is showing: "select all" over a filtered board means the filtered set.
  withFilters(params, filters);
  const query = params.toString();
  return apiRequest(`/api/hrm/interview/candidates/ids${query ? `?${query}` : ""}`);
}

/**
 * The values one column holds across the whole stage, for the filter menu above it.
 *
 * The register is read a page at a time, so a menu built from the rows the browser has would offer
 * the values of the hundred scrolled into view - a filter that grows as you scroll and hides the
 * rows you are looking for. Asked when the menu opens, like the CRM board's own column filters.
 */
export function getCandidateColumnValues(column, status, filters = {}) {
  const params = new URLSearchParams({ column });
  if (status) params.set("status", status);
  /*
   * Every **other** column's filter travels with it, so the menu offers what is reachable rather
   * than what exists - picking one of its values can then never answer "no records found". The
   * column's own filter is dropped by the server, or ticking one value would narrow that menu to
   * the one value ticked and there would be no way back to the others.
   */
  withFilters(params, filters);
  return apiRequest(`/api/hrm/interview/candidates/column-values?${params.toString()}`);
}

export function getCandidate(id) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}`);
}

export function createCandidate(payload) {
  return apiRequest("/api/hrm/interview/candidates", { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Bulk Entry's batch. The reply carries what landed and, in `errors`, the rows that did not - a
 * batch where one candidate fails is not a batch that failed.
 */
export function createCandidatesBulk(records) {
  return apiRequest("/api/hrm/interview/candidates/bulk", { method: "POST", body: JSON.stringify({ records }) });
}

export function updateCandidate(id, payload) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
}

/** A soft delete: the row keeps its history, and a linked sheet will not bring it back. */
/**
 * The candidate's stage, on its own.
 *
 * A route of its own rather than `updateCandidate` with one field: that one validates the whole
 * record and writes every key it is given, so a body carrying only a status is refused, and one
 * carrying a name would blank the rest. Used by the row menu, which holds a table row, not a form.
 */
export function setCandidateStatus(id, status, note, nextFollowUpDate) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    /*
     * The reason where the move carried one - Selected, On Hold, Rejected and Follow Up all ask for
     * it. Left out entirely when there is none rather than sent empty: the server appends an entry
     * for every note it receives, and Undo moves a stage back without adding a second note about
     * undoing the first.
     *
     * `nextFollowUpDate` travels the same way and for the same reason, but it is asked by **Follow
     * Up alone** - that is the one stage that is about a day. `undefined` leaves the column as it
     * is; `null` is a caller saying there is no next follow-up, which is a different answer and has
     * to stay tellable from the first.
     */
    body: JSON.stringify({
      status,
      ...(note ? { note } : {}),
      ...(nextFollowUpDate === undefined ? {} : { nextFollowUpDate }),
    }),
  });
}

/**
 * A remark on the candidate, without moving their stage.
 *
 * Appended to the same log the decisions write to, so one list holds both why a stage moved and what
 * was said. Until now a note could only reach a record by taking a decision, which meant pretending
 * to change something in order to write down a phone call.
 */
export function addCandidateRemark(id, note) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/remarks`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

/**
 * A WhatsApp message to the candidate.
 *
 * The **number is not sent** - the server reads it off the record. There is no "send to this number"
 * route in this application and there must not be, because the studio's paired number can be banned
 * for being used that way. One-way: their replies do not come back into the application.
 */
export function sendCandidateWhatsApp(id, body) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/whatsapp`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

/**
 * Resend: reopen the application this candidate already submitted and email them their own link.
 *
 * Not `sendApplicationInvite` again. That raises a *new* form on a new link, which asks somebody who
 * has already answered for all of it a second time; this returns their own submission to them with
 * every answer still in it, to correct and resubmit. The Employee Repository's Send Back is the same
 * act on the onboarding form.
 *
 * A 502 means the form **was** reopened and only the email was refused - the studio's mail quota is
 * spent, the inbox is full. The caller answers that by handing over the message to send by hand
 * rather than by treating it as a failure.
 */
export function resendApplicationForm(id) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/resend-form`, { method: "POST" });
}

/**
 * Putting a round in the diary, as one act.
 *
 * The round, the stage and the Google Meet are the server's to do together: it appends the round (or
 * rewrites the one being edited), moves the candidate to **Interview Scheduled**, and - for a round
 * whose mode is Google Meet - creates the calendar event or moves the one this round already has,
 * putting Google's own link on the round. A calendar Google refuses refuses the whole schedule, so
 * the register never holds an interview nobody can join.
 *
 * Not `updateCandidate` with six fields: that one is not partial, it writes every key it is handed,
 * and none of the three things above would happen. The reply carries the saved candidate and, in
 * `meet`, what Google gave back.
 */
export function scheduleInterview(id, payload) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/schedule`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Who a Meet can be sent to: the working employees, with the address an invite belongs on.
 *
 * Its own call rather than part of `getInterviewOptions`, and guarded a notch tighter - the roster
 * with everybody's work email in it is for somebody booking an interview, not for everybody who may
 * read the register. Guests are not limited to this list: an address is typed straight in.
 */
export function getMeetGuests() {
  return apiRequest("/api/hrm/interview/meet-guests");
}

export function deleteCandidate(id) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── What a selection does ────────────────────────────────────────────────────────────────────── */

/*
 * The two calls behind the tick boxes on the register. Both answer to `HRM / Interview Select All`
 * Read / Write rather than to the screen's own permission - acting on a whole stage at once is a
 * different job from working it a candidate at a time - so a role without it is refused here and
 * never shown the boxes in the first place.
 *
 * Each reply names what actually happened: `movedIds` / `deletedIds` and, in `missedIds`, the
 * candidates that were already gone. A selection where one row has vanished since it was read is
 * not a selection that failed.
 */

/** Every ticked candidate moved to one stage, with one reason appended to each of their decisions. */
export function setCandidateStatusBulk(ids, status, note) {
  return apiRequest("/api/hrm/interview/candidates/bulk-status", {
    method: "POST",
    // The note is left out entirely when there is none, for the reason `setCandidateStatus` leaves
    // it out: the server records an entry for every note it receives, and a blank one would write a
    // row of empty reasons across the whole selection.
    body: JSON.stringify(note ? { ids, status, note } : { ids, status }),
  });
}

/** Every ticked candidate deleted together. A soft delete each, as the row menu's own delete is. */
export function deleteCandidatesBulk(ids) {
  return apiRequest("/api/hrm/interview/candidates/bulk", { method: "DELETE", body: JSON.stringify({ ids }) });
}

/* ── The application forms sent to candidates ──────────────────────────────────────────────── */

/**
 * The application forms raised, newest first, with the stage of the candidate each belongs to.
 *
 * `candidateIds` narrows it to the candidates actually on screen, which is what the register wants:
 * it reads a hundred candidates at a time and uses the forms only to decide what each row's menu
 * offers, so asking for every form the studio has ever raised was a second read of the whole
 * register - on opening the screen, and again after every write. View All Invites passes nothing
 * and gets the lot, because that is what it is for.
 */
export function getApplicationInvites(candidateIds = null) {
  const ids = Array.isArray(candidateIds) ? candidateIds.filter(Boolean) : [];
  if (!ids.length) return apiRequest("/api/hrm/interview/invites");
  return apiRequest(`/api/hrm/interview/invites?candidateIds=${encodeURIComponent(ids.join(","))}`);
}

/**
 * Raises a form for a candidate and hands back its link.
 *
 * `candidateId` names the register row it is for; without one the server finds the candidate by
 * email or phone, or creates them - so a form can be sent to somebody not yet on the register and
 * they appear on it from that moment.
 */
export function createApplicationInvite(payload) {
  return apiRequest("/api/hrm/interview/invites", { method: "POST", body: JSON.stringify(payload) });
}

/** Corrects the details a form was sent on. The link is kept, so the one already sent keeps working. */
export function updateApplicationInvite(id, payload) {
  return apiRequest(`/api/hrm/interview/invites/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function cancelApplicationInvite(id) {
  return apiRequest(`/api/hrm/interview/invites/${encodeURIComponent(id)}/cancel`, { method: "PATCH" });
}

/** Emails the form. `token` is the identifier off the link, which proves the caller holds it. */
export function sendApplicationInviteEmail(id, payload) {
  return apiRequest(`/api/hrm/interview/invites/${encodeURIComponent(id)}/send-email`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * The same screening form, handed over on WhatsApp from the sender's own paired account.
 *
 * The wording travels because the dialog's box is editable and what is on screen is what should
 * go. The candidate's **number** does not: the server reads it off the invite, so this cannot be
 * pointed at anybody else.
 */
export function sendApplicationInviteWhatsApp(id, message) {
  return apiRequest(`/api/hrm/interview/invites/${encodeURIComponent(id)}/send-whatsapp`, { method: "POST", body: JSON.stringify({ message }) });
}

/**
 * The candidates the register already holds on this number or this address.
 *
 * The question the form asks **as a number is typed**, so that "already on the register" appears
 * under the field rather than arriving as a refusal once somebody has filled in the whole record.
 * The CRM's Add Lead asks its own board exactly this, in exactly this place.
 *
 * `excludeId` is the candidate doing the asking, so a record being edited does not find itself.
 *
 * Answers `{ count, candidates }`, where each candidate carries enough to be recognised - the code,
 * the name, the stage and the position - because a warning naming nothing is a warning nobody can
 * act on.
 */
export function getDuplicateCandidates({ phone = "", email = "", excludeId = "" } = {}) {
  const query = new URLSearchParams();
  if (String(phone || "").trim()) query.set("phone", String(phone).trim());
  if (String(email || "").trim()) query.set("email", String(email).trim());
  // Nothing to match on is not a question worth asking the server.
  if (!query.toString()) return Promise.resolve({ data: { count: 0, candidates: [] } });
  if (excludeId) query.set("excludeId", String(excludeId));
  return apiRequest(`/api/hrm/interview/candidates/duplicates?${query.toString()}`);
}

/**
 * The calls on one candidate's number, for the popup's Call Logs tab.
 *
 * The number is the **server's** to read off the record the id names - this asks about a candidate, not
 * about a number, which is the only shape that cannot be turned into a way to read the call history of
 * anybody the studio has ever rung.
 *
 * Each row is the fact of the call and nothing about the CRM's own client: when, which way, how long,
 * and which of the studio's people was on it.
 */
export function getCandidateCallLogs(id) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/call-logs`);
}

/**
 * The transcripts of this candidate's calls.
 *
 * A transcript hangs off a call, and a candidate is known by their number rather than an enquiry
 * id - so the server finds the calls first and their transcripts from those. Guarded by
 * `HRM / Interview`, as the register's own routes are.
 */
export function getCandidateTranscripts(id) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/transcripts`);
}

/** One of them in full, with its spoken segments - what "View Full Transcript" opens. */
export function getCandidateTranscriptDetail(id, transcriptId) {
  return apiRequest(`/api/hrm/interview/candidates/${encodeURIComponent(id)}/transcripts/${encodeURIComponent(transcriptId)}`);
}
