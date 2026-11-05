const { CONVERTED_STATUS_KEYS } = require("./crmLeadService");

/**
 * What a Callyzer call is allowed to write onto a lead that already exists.
 *
 * A call is news about a lead, not a replacement for one. The webhook used to spread the whole
 * record it had built from the call over the lead it matched, so ringing a client already in the
 * CRM overwrote their record with whatever a call log happens to know:
 *
 *   - a lead called "Priya Sharma" became "Call 2345" - the name Callyzer invents when the number
 *     is not in the employee's contacts;
 *   - the enquiry date became the date of the call, so a lead from March read as new today;
 *   - the remarks the CRM had written were replaced by the one-line call summary;
 *   - the Source became "Callyzer" whatever campaign had actually produced the lead;
 *   - `sourceEnquiryId` - the link back to the spreadsheet row the lead syncs with - was overwritten
 *     with Callyzer's call id;
 *   - and the next follow-up date was blanked, because Callyzer sends a reminder with almost no
 *     call and the empty string won the spread.
 *
 * So the fields a call may write are named here, and they are only the ones a call knows better
 * than the lead does. Everything else belongs to the lead and is left exactly as it is. Nothing
 * about the call is lost by this: it is written to `sales_crm_call_log` and shown in full on the
 * lead's own Call Logs tab, which is where a call belongs.
 *
 * Pure, and deliberately in its own file: what a delivery may and may not overwrite is the kind of
 * rule that has to be readable on its own and provable without a database.
 */

function isBlank(value) {
  return String(value ?? "").trim() === "";
}

/**
 * The name Callyzer makes up when the number is not in the employee's phone: "Call 2345", or
 * "Call 3" for a call with no number at all.
 *
 * Worth putting on a lead that has nothing else, and worth nothing beside a real name - so it is
 * recognised rather than treated as a name in its own right.
 */
function isPlaceholderName(value) {
  return /^call(\s+\d+)?$/i.test(String(value ?? "").trim());
}

/** Whether a status already says the lead converted, and so must not be moved by a call. */
function isConverted(status) {
  return CONVERTED_STATUS_KEYS.has(String(status ?? "").trim().toLowerCase());
}

/**
 * The record to write for a lead that already existed, given the record built from the call.
 *
 * `existing` and `record` are both `{ lead, details }`. The lead keeps its id, and the returned
 * record is a copy - neither argument is modified.
 */
function mergeCallIntoLead(existing = {}, record = {}) {
  const lead = { ...(existing.lead || {}) };
  const details = { ...(existing.details || {}) };
  const from = record.lead || {};
  const fromDetails = record.details || {};

  // Filled in where the lead has nothing, never written over what it has.
  if (isBlank(lead.vertical) && !isBlank(from.vertical)) lead.vertical = from.vertical;
  if (isBlank(lead.phone) && !isBlank(from.phone)) lead.phone = from.phone;
  if (isBlank(lead.crm) && !isBlank(from.crm)) lead.crm = from.crm;
  /*
   * A lead with no name at all takes whatever the call has - "Call 2345" at least says which number
   * it was. Beyond that only a real name displaces a placeholder, and nothing displaces a real name.
   */
  if (!isBlank(from.name)) {
    if (isBlank(lead.name)) lead.name = from.name;
    else if (isPlaceholderName(lead.name) && !isPlaceholderName(from.name)) lead.name = from.name;
  }

  /*
   * The outcome the employee recorded against the call, which really is newer than the status on
   * the lead - except where the lead has already converted. A client ringing about their album
   * after the wedding must not turn a Converted lead back into "Interested"; that is the same rule
   * `markCrmLeadConverted` follows when a project is created against a lead already converted.
   */
  if (!isBlank(fromDetails.leadStatus) && !isConverted(details.leadStatus || lead.status)) {
    details.leadStatus = fromDetails.leadStatus;
  }
  /*
   * Only when the call carries one. An absent reminder is not an instruction to forget the
   * follow-up somebody scheduled - and absent is what almost every call sends.
   */
  if (!isBlank(fromDetails.nextFollowUpDate)) details.nextFollowUpDate = fromDetails.nextFollowUpDate;
  if (!isBlank(fromDetails.nextFollowUpTime)) details.nextFollowUpTime = fromDetails.nextFollowUpTime;
  // The lead's remarks are the CRM's own notes. The call's own summary lives on the call.
  if (isBlank(details.remarks) && !isBlank(fromDetails.remarks)) details.remarks = fromDetails.remarks;

  return { lead, details };
}

module.exports = { mergeCallIntoLead, isPlaceholderName, isConverted };
