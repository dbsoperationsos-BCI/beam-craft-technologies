const crypto = require("node:crypto");
const { z } = require("zod");
const { importCsvRows, nextLeadId } = require("./csvImportService");
const { IDENTIFIER_PATTERN } = require("../../../services/identifiers");
const { cancelBatch } = require("./importBatchRegistry");
const { listLeadActivity, recordLeadActivity, recordBulkActivity } = require("./activityService");
const { notifyLeadAssigned } = require("./leadNotifications");
const { recordCallLogs, listLeadCallLogs, callLogCounts, knownEmployeeNumbers, linkCallsToLead } = require("./callLogService");
const { listCallBoardPage, listCallBoardIds, callBoardTabCounts, callBoardColumnValues, callBoardVersion, callToRecord } = require("./callBoardService");
const { loadRoutingConfig, verticalForCall, callFilterReason, phoneKey: routingPhoneKey, employeeNumberOf, verticalFromValue } = require("./callRouting");
const { mergeCallIntoLead } = require("./callMerge");
const excludedNumbers = require("./excludedNumbersService");
// The application's one branch list. The CRM used to carry six branch names of its own in the
// frontend, none of which was a branch - see the note in branchOptions.js.
const { branchOptions, branchOptionRows } = require("../../../services/branchOptions");
const { excludedNumberKeys } = excludedNumbers;
const transcripts = require("../call-transcripts/repository");
const { enqueueTranscription } = require("../call-transcripts/queue");
const { listCrmLeadsPage, listCrmLeadIds, crmLeadTabCounts, crmLeadColumnValues } = require("./leadQueryService");
const { FIELD_TYPES, MAX_FIELDS_PER_VERTICAL, listCustomFields, replaceCustomFields } = require("./tableSettingsService");
const { cancelMeeting, createMeeting, listMeetings } = require("./meetingService");
const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");
const { storeAttachment, readAttachment, storageReady, ROOT: REMARK_ROOT } = require("./remarkAttachments");
const { CRM_LEAD_SELECT_LIST, phoneMatchKey, toRecord, getCrmLeadById, listLeadsSharingPhone, findVerticalDuplicate, getCrmLeadVersion, listCrmLeads, listCrmLeadProjects, createCrmLead, createCrmLeads, stampCrmLeadCreator, updateCrmLead, deleteCrmLead, deleteCrmLeads, setCrmLeadStatus, assignCrmLeads, renameCrmLeadGroup, refreshCrmLeadsFromSheets } = require("./crmLeadService");

/*
 * An enquiry id, as this application now issues them: `DBS-EID-QQ-ERD-000001`.
 *
 * Deliberately the loose identifier test rather than the enquiry scheme's own. These routes take
 * ids the browser read off rows it was given, and a lead created before the identifiers were
 * unified still carries its old code until the backfill has run - refusing those here would make
 * every one of them unselectable and undeletable. The row itself is still looked up by primary
 * key, so a well-formed id that belongs to nothing simply finds nothing.
 */
const ENQUIRY_ID_PATTERN = IDENTIFIER_PATTERN;

const recordSchema = z.object({
  // The id is optional: a lead added from the form leaves it to the counter, which is the only
  // thing that can know where this vertical and branch have got to. One typed in by hand is kept.
  lead: z.object({ id: z.string().trim().regex(ENQUIRY_ID_PATTERN).or(z.literal("")).optional(), name: z.string().trim(), phone: z.string().trim() }).passthrough(),
  details: z.object({}).passthrough().default({}),
});
const updateRecordSchema = z.object({
  lead: z.object({ id: z.string().trim().regex(ENQUIRY_ID_PATTERN).optional() }).passthrough().partial().default({}),
  details: z.object({}).passthrough().default({}),
});
const bulkRecordSchema = z.object({ records: z.array(recordSchema).min(1) });
const csvImportSchema = z.object({
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1).max(5000),
  startRow: z.number().int().min(1).default(2),
  systemTableId: z.string().trim().max(191).optional().default(""),
  vertical: z.string().trim().max(191).optional().default(""),
  batchId: z.string().trim().max(191).optional().default(""),
  fileName: z.string().trim().max(255).optional().default(""),
});
// Capped like `bulkStatusSchema` below it: the board's select-all can post every lead a vertical
// holds, and an unbounded array is a body with no ceiling on it.
const bulkDeleteSchema = z.object({ ids: z.array(z.string().trim().regex(ENQUIRY_ID_PATTERN)).min(1).max(200000) });
const renameGroupSchema = z.object({ name: z.string().trim().min(1).max(120) });
const callyzerWebhookSchema = z.union([
  z.object({ calls: z.array(z.any()).min(1) }),
  z.object({ data: z.array(z.any()).min(1) }),
  z.array(z.any()).min(1),
  z.object({}).passthrough(),
]);
// One field off the Table Settings canvas. `key` is optional because a field the user has
// just dragged in does not have one yet; the service mints it from the label.
const customFieldSchema = z.object({
  key: z.string().trim().max(120).optional().default(""),
  label: z.string().trim().min(1).max(191),
  fieldType: z.enum(FIELD_TYPES).default("text"),
  placeholder: z.string().trim().max(191).optional().default(""),
  required: z.boolean().optional().default(false),
  // A plain string is still accepted so a form saved before options carried a stored value
  // can be sent back unchanged.
  options: z.array(z.union([
    z.string().trim().max(191),
    z.object({
      text: z.string().trim().max(191),
      value: z.string().trim().max(191).optional().default(""),
      default: z.boolean().optional().default(false),
    }),
  ])).max(50).optional().default([]),
});
const tableSettingsSchema = z.object({
  vertical: z.string().trim().min(1).max(30),
  fields: z.array(customFieldSchema).max(MAX_FIELDS_PER_VERTICAL),
});

function validationErrors(error) {
  return error.issues.map((issue) => ({
    row: typeof issue.path[1] === "number" ? issue.path[1] + 2 : null,
    field: issue.path.slice(2).join("."),
    reason: issue.message,
  }));
}

// The signed-in user is still recorded against the row for traceability; the name the log
// displays comes from the lead's CRM, resolved in activityService.
function actorFrom(req) {
  return {
    actorUserId: req?.user?.id ?? null,
    source: "app",
  };
}

function sendError(res, error, fallback) {
  console.error(fallback, error.message);
  return res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function parseDurationSeconds(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;

    if (Number.isFinite(value)) return Math.max(0, Math.round(value));

    const text = String(value).trim().toLowerCase();
    if (!text) continue;

    if (/^\d+(?:\.\d+)?$/.test(text)) {
      return Math.max(0, Math.round(Number(text)));
    }

    const hms = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (hms) {
      const hours = Number(hms[3] === undefined ? 0 : hms[1]);
      const minutes = Number(hms[3] === undefined ? hms[1] : hms[2]);
      const seconds = Number(hms[3] === undefined ? hms[2] : hms[3]);
      return Math.max(0, (hours * 3600) + (minutes * 60) + seconds);
    }

    let total = 0;
    let matched = false;
    const units = /(\d+(?:\.\d+)?)\s*(h(?:ours?)?|hr?s?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)/g;
    for (const match of text.matchAll(units)) {
      matched = true;
      const amount = Number(match[1]);
      const unit = match[2][0];
      if (unit === "h") total += amount * 3600;
      else if (unit === "m") total += amount * 60;
      else total += amount;
    }
    if (matched) return Math.max(0, Math.round(total));

    const digits = text.match(/\d+/g);
    if (digits?.length) return Math.max(0, Math.round(Number(digits[0])));
  }
  return 0;
}

/**
 * Callyzer's own shape: a batch of employees, each carrying that employee's call logs.
 *
 * [{ emp_name, emp_number, call_logs: [{ client_name, client_number, ... }] }]
 *
 * The lead is the client on the other end of the call, never the employee - reading the batch as
 * a flat list of calls would have made a lead out of every member of staff, with their own mobile
 * number as the contact. A flat array of calls is still accepted, for anything else that posts
 * one.
 */
function flattenCallyzerBatch(payload) {
  const items = Array.isArray(payload) ? payload : payload.calls || payload.data || [payload];
  const entries = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.call_logs)) {
      for (const callLog of item.call_logs) {
        if (callLog && typeof callLog === "object") entries.push({ callLog, employee: item });
      }
      continue;
    }
    entries.push({ callLog: item, employee: {} });
  }
  return entries;
}

/*
 * What Callyzer calls the outcome of a call, in the CRM's own words.
 *
 * Its statuses are configurable per account, so this maps the ones it ships with and leaves
 * anything else alone rather than guessing: an unmapped disposition keeps whatever status the
 * lead already had, and the raw value is written into the remark so the information is not lost.
 */
const CALLYZER_STATUS_MAP = {
  interested: "Interested",
  positive: "Interested",
  "follow up": "Followup",
  followup: "Followup",
  "call back": "Followup",
  callback: "Followup",
  converted: "Converted",
  "deal closed": "Converted",
  won: "Converted",
  "not interested": "Rejected",
  negative: "Rejected",
  rejected: "Rejected",
  lost: "Rejected",
  "wrong number": "Invalid",
  invalid: "Invalid",
  busy: "CNA",
  "no answer": "CNA",
  "not connected": "CNA",
  cna: "CNA",
};

function callyzerLeadStatus(callLog) {
  const mapped = CALLYZER_STATUS_MAP[
    pickFirst(
      callLog.crm_status, callLog.crmStatus, callLog.call_status, callLog.callStatus,
      callLog.status, callLog.result, callLog.disposition, callLog.outcome,
    ).toLowerCase()
  ];
  if (mapped) return mapped;
  // A missed call is the one outcome the call itself states without needing a disposition.
  if (pickFirst(callLog.call_type, callLog.callType, callLog.type, callLog.direction).toLowerCase() === "missed") return "CNA";
  return "";
}

// The 10-digit number the CRM stores. Callyzer sends the country code separately, and every other
// number in this CRM is the local one, so the two are not glued together here.
function callyzerClientPhone(callLog) {
  const local = normalizePhone(pickFirst(callLog.client_number, callLog.clientNumber, callLog.phone, callLog.mobile, callLog.number));
  return local.replace(/^\+/, "");
}

/**
 * The call written out as a remark.
 *
 * A call log is a record of a conversation, and the whole point of pulling it in is that the next
 * person to ring can read what happened. The note is the substance; the direction, the length and
 * the recording are the context around it.
 */
function callyzerRemark(callLog, employee) {
  const parts = [];
  const type = pickFirst(callLog.call_type, callLog.callType, callLog.type, callLog.direction);
  const duration = parseDurationSeconds(
    callLog.duration, callLog.duration_seconds, callLog.durationSeconds,
    callLog.call_duration, callLog.callDuration, callLog.duration_sec,
  );
  const when = [pickFirst(callLog.call_date, callLog.callDate), pickFirst(callLog.call_time, callLog.callTime)].filter(Boolean).join(" ");
  const employeeName = pickFirst(employee.emp_name, employee.empName);
  const head = [type ? `${type} call` : "Call", duration ? `${duration}s` : "", when, employeeName ? `by ${employeeName}` : ""]
    .filter(Boolean)
    .join(" · ");
  parts.push(head);
  const note = pickFirst(
    callLog.note, callLog.notes, callLog.remark, callLog.remarks,
    callLog.comment, callLog.comments, callLog.description, callLog.summary,
  );
  if (note) parts.push(note);
  const status = pickFirst(
    callLog.crm_status, callLog.crmStatus, callLog.call_status, callLog.callStatus,
    callLog.status, callLog.result, callLog.disposition, callLog.outcome,
  );
  if (status) parts.push(`Callyzer status: ${status}`);
  const recording = pickFirst(
    callLog.call_recording_url, callLog.callRecordingUrl, callLog.recording_url,
    callLog.recordingUrl, callLog.recording, callLog.audio_url, callLog.audioUrl,
  );
  if (recording) parts.push(`Recording: ${recording}`);
  return parts.filter(Boolean).join(" — ");
}

function callLogToLead(callLog, index, employee = {}, routing = {}) {
  const phone = callyzerClientPhone(callLog);
  const name = pickFirst(
    callLog.client_name, callLog.clientName,
    callLog.customer_name, callLog.customerName, callLog.contact_name, callLog.contactName, callLog.name,
    phone ? `Call ${phone.slice(-4)}` : `Call ${index + 1}`,
  );
  const callDate = pickFirst(callLog.call_date, callLog.callDate, callLog.synced_at, callLog.created_at, callLog.date);
  const callTime = pickFirst(callLog.call_time, callLog.callTime);
  const leadStatus = callyzerLeadStatus(callLog);
  // The employee who took the call is the CRM against the lead; it is the answer to "who has
  // spoken to this client", which is what that column is for.
  const crm = pickFirst(employee.emp_name, employee.empName, callLog.crm, callLog.assigned_to, callLog.owner);
  /*
   * The vertical the call belongs to - the studio's three businesses are three CRM boards, and
   * `vertical` is which one a lead sits on.
   *
   * Every Callyzer lead used to arrive with this blank, and the Dum Dum tab shows blank-vertical
   * leads because a lead that predates the verticals is a wedding lead. So a newborn enquiry and a
   * corporate enquiry both landed in the wedding board, and nobody on Qua Qua or Corp ever saw
   * their own calls.
   *
   * Written only when the call actually says which vertical it is. The key is spread over the
   * existing lead on the update path, so an absent key leaves whatever is already there - which is
   * what an unclassifiable call should do to a lead somebody has already filed.
   */
  const vertical = verticalForCall(callLog, employee, routing);

  return {
    lead: {
      id: pickFirst(callLog.enquiry_id, callLog.enquiryId, callLog.lead_id, callLog.leadId, ""),
      name,
      phone,
      ...(vertical ? { vertical } : {}),
      // What the CRM shows as the time of the enquiry: the clock time of the call itself.
      addedTime: callTime || "",
      // The day the call happened, not the day it was delivered here - a batch synced late must
      // not read as a lead that arrived today.
      createdDate: /^\d{4}-\d{2}-\d{2}$/.test(callDate.slice(0, 10)) ? callDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      crm,
      referredFrom: "Callyzer Call Log",
      // Recorded on the lead, not only in the group details below: those are rebuilt per import
      // and never stored, so this is the only copy that survives to tell the Source column where
      // the lead came from.
      source: "Callyzer",
      /*
       * Left for the repeat marker below to fill.
       *
       * This used to be the call's direction - "Incoming", "Missed" - which is not what the
       * column means. Contact Repeated says the client has been in touch before; the direction
       * of a particular call belongs to the call log, which now holds it.
       */
      contactRepeated: "",
    },
    details: {
      importedFrom: "Callyzer",
      // Callyzer's own id for the call, so the same call delivered twice is the same row.
      sourceEnquiryId: pickFirst(callLog.id, callLog.call_id, callLog.callId, `${phone || "callyzer"}-${index + 1}`),
      groupType: "callyzer",
      groupName: "Callyzer",
      ...(leadStatus ? { leadStatus } : {}),
      remarks: callyzerRemark(callLog, employee),
      nextFollowUpDate: pickFirst(callLog.reminder_date, callLog.reminderDate, callLog.follow_up_date, callLog.followUpDate),
      nextFollowUpTime: pickFirst(callLog.reminder_time, callLog.reminderTime, callLog.follow_up_time, callLog.followUpTime),
      callLog: { ...callLog },
    },
  };
}

// Callyzer signs its deliveries with a shared secret. It is read from either header it might
// send, or from the query string, so the same URL works whichever way the account is configured.
/**
 * The leads already held for the numbers in one delivery.
 *
 * Two things were wrong with reading them from `listCrmLeads()`. It answers with records -
 * `{ lead, details }` - and this keyed the map on `lead.phone`, which a record does not have,
 * so the map came out empty and every delivery created the lead again: the same call redelivered,
 * or a client rung twice, arrived as a second row. And it loads every lead in the CRM, tens of
 * thousands of them through the sheet merge, to look up a handful of numbers.
 *
 * Matched on the last ten digits, which is what makes "+91 98765 43210" and "9876543210" the same
 * client here as everywhere else in this module.
 */
async function leadsForPhones(phones) {
  /*
   * Matched by the CRM's own rule, not a stricter one.
   *
   * This demanded exactly ten digits, so any number shorter than that was dropped before the query
   * and no existing lead could ever be found - every delivery created the client again. Callyzer's
   * own sample numbers are masked to five digits, which is why testing produced a fresh set of
   * leads each time rather than updating the ones already there.
   */
  const locals = [...new Set(phones.map(phoneMatchKey).filter(Boolean))];
  if (!locals.length) return new Map();

  /*
   * Named through the shared select list rather than spelled out here.
   *
   * This query still named the table and its columns the way they were spelled before the
   * snake_case migration, so a delivery carrying real phone numbers died on "table doesn't exist".
   * It survived every test because the numbers in Callyzer's sample payload are masked - five
   * digits, not ten - and the guard above returns before the query is ever built.
   */
  /*
   * Either number the lead can be reached on, not the one that happens to take precedence.
   *
   * This coalesced the two - contact number when it has one, phone otherwise - so a lead carrying
   * both was findable by its contact number alone. Ring that client on the other number and no
   * lead matched, a second row was created for a client already in the CRM, and the calls and the
   * "Enquired N times" count were split between two records of the same person. Corp leads keep
   * their number in `contact_number` and the wedding boards keep it in `phone`, so which column
   * holds the number that was dialled is not something a delivery can know.
   *
   * Oldest first, so a number that already has more than one lead against it always resolves to
   * the same one - the original enquiry. Without an order MySQL was free to return them in any
   * order, and successive deliveries could scatter one client's calls across their duplicates.
   */
  const placeholders = locals.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${CRM_LEAD_SELECT_LIST}
       FROM \`sales_crm_lead\`
      WHERE \`deleted_at\` IS NULL
        AND (RIGHT(REGEXP_REPLACE(COALESCE(\`contact_number\`, ''), '[^0-9]', ''), 10) IN (${placeholders})
          OR RIGHT(REGEXP_REPLACE(COALESCE(\`phone\`, ''), '[^0-9]', ''), 10) IN (${placeholders}))
      ORDER BY \`created_at\` ASC, \`enquiry_id\` ASC`,
    ...locals, ...locals,
  );

  /*
   * Keyed by the same rule the query matched on, under both of the lead's numbers.
   *
   * This still required ten digits here, so the rows the query had just found were thrown away
   * again while the map was built - the lookup returned empty and the lead was created afresh.
   * Three places decide what "the same number" means; all three now ask `phoneMatchKey`.
   */
  const byPhone = new Map();
  for (const row of rows) {
    const record = toRecord(row);
    // Contact number first: it is the number the CRM treats as the client's own, so where the two
    // disagree it is the one that decides which lead a call belongs to.
    for (const key of [phoneMatchKey(row.contactNumber), phoneMatchKey(row.phone)]) {
      if (key && !byPhone.has(key)) byPhone.set(key, record);
    }
  }
  return byPhone;
}


/*
 * The shared secret, wherever the sender chose to put it.
 *
 * Callyzer's "Configure Webhook" panel takes a Secret but does not say how it travels, and its
 * deliveries were refused with the right value in the box - so the two headers this read
 * originally were not the ones it uses. Rather than guess at one more name, every place a webhook
 * secret is conventionally carried is accepted: the request still has to present the exact value,
 * so widening where it is looked for costs nothing in strictness.
 *
 * `Authorization` is handled for both shapes - a bare secret, and the `Bearer <secret>` a sender
 * that treats it as a token would send.
 */
const WEBHOOK_SECRET_HEADERS = [
  "x-callyzer-secret",
  "x-webhook-secret",
  "x-secret",
  "secret",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "auth-token",
  "token",
];

function readWebhookSecret(req) {
  for (const header of WEBHOOK_SECRET_HEADERS) {
    const value = String(req.header(header) || "").trim();
    if (value) return value;
  }

  const authorization = String(req.header("authorization") || "").trim();
  if (authorization) return authorization.replace(/^Bearer\s+/i, "").trim();

  // The query string, and then the body - a sender that puts the secret in the payload rather
  // than in a header. Only read off an object, so a body that is an array of call logs is never
  // indexed into.
  const fromQuery = String(req.query.secret || req.query.token || "").trim();
  if (fromQuery) return fromQuery;

  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return String(body.secret || body.token || body.webhook_secret || "").trim();
  }
  return "";
}

/*
 * Callyzer signs the delivery; it does not send the secret.
 *
 * Its panel calls the field "Secret", which reads as something to be presented and compared - and
 * that is how this was written, so every delivery was refused while the right value sat in
 * Callyzer's configuration. The server's own log settled it: the request carries
 * `x-callyzer-signature`, and a signature is not a secret. It is an HMAC of the body keyed with
 * the secret, so no amount of string comparison could ever have matched it.
 *
 * The secret stays on both machines and is never transmitted, which is the point of signing: an
 * eavesdropper who copies the header cannot reuse it on a different payload.
 *
 * The algorithm and encoding are not documented anywhere public, so the candidates below are tried
 * in turn - SHA-256 before SHA-1, hex before base64, which is the order of how common they are.
 * A `sha256=` style prefix is stripped first; several senders include one.
 */
const SIGNATURE_HEADERS = ["x-callyzer-signature", "x-webhook-signature", "x-hub-signature-256", "x-hub-signature", "x-signature"];

/*
 * Every shape the same secret can take as a signing key.
 *
 * The value Callyzer shows is 64 hex characters, and that is how a 32-byte key is written down -
 * so the sender may well decode it to those 32 bytes before signing, while this end signed with
 * the 64 characters as text. Two HMACs of the same body with "the same secret" then disagree, and
 * no amount of checking the value in the panel would ever have shown why.
 *
 * Which one it is is not documented, so all of them are tried. Deriving a few extra keys costs
 * microseconds and removes a whole class of guessing.
 */
function signingKeys(secret) {
  const keys = [Buffer.from(secret, "utf8")];
  if (/^[0-9a-f]+$/i.test(secret) && secret.length % 2 === 0) keys.push(Buffer.from(secret, "hex"));
  if (/^[A-Za-z0-9+/=_-]+$/.test(secret)) {
    const decoded = Buffer.from(secret, "base64");
    if (decoded.length) keys.push(decoded);
  }
  return keys;
}

/**
 * Does the signature on this request prove it was made with our secret?
 *
 * Hex is compared without regard to case - some senders uppercase it - while base64 is compared
 * exactly, because there case carries meaning.
 */
function signatureMatches(req, secret) {
  let provided = "";
  for (const header of SIGNATURE_HEADERS) {
    provided = String(req.header(header) || "").trim();
    if (provided) break;
  }
  if (!provided) return false;

  /*
   * The bytes as they arrived. Re-serializing the parsed object gives different bytes - key order,
   * spacing, how unicode is escaped - and a signature over those never matches the sender's.
   */
  const body = req.rawBody;
  if (!body || !body.length) return false;

  const candidate = provided.replace(/^(?:sha1|sha256|sha512|hmac)[=:\s]+/i, "").trim();

  /*
   * Callyzer names the header "signature" and puts the secret in it, unhashed.
   *
   * This is the first thing checked because it is what actually arrives: the server's own log
   * showed `x-callyzer-signature` carrying the exact value configured in their panel. Everything
   * below computes HMACs, which is what the name promises and what other senders do - kept because
   * it costs nothing and a provider that starts signing properly will keep working.
   */
  if (secretMatches(candidate, secret)) return true;

  const matches = (digest) => secretMatches(candidate, digest)
    || (/^[0-9a-f]+$/i.test(digest) && secretMatches(candidate.toLowerCase(), digest.toLowerCase()));

  for (const key of signingKeys(secret)) {
    for (const algorithm of ["sha256", "sha1", "sha512"]) {
      for (const encoding of ["hex", "base64", "base64url"]) {
        let digest;
        // `base64url` is missing on older Node builds; an unsupported encoding must not throw.
        try { digest = crypto.createHmac(algorithm, key).update(body).digest(encoding); } catch { continue; }
        if (matches(digest)) return true;
      }
    }
  }

  /*
   * A plain hash of the secret and the body concatenated, which is what a sender that has not
   * reached for HMAC tends to do. Weaker, but it is in the wild and costs nothing to check.
   */
  for (const algorithm of ["sha256", "sha1"]) {
    for (const order of [[secret, body], [body, secret]]) {
      for (const encoding of ["hex", "base64"]) {
        let digest;
        try { digest = crypto.createHash(algorithm).update(order[0]).update(order[1]).digest(encoding); } catch { continue; }
        if (matches(digest)) return true;
      }
    }
  }
  return false;
}

/**
 * What the sender actually sent, and what we made of it.
 *
 * Off unless `CALLYZER_DEBUG_SIGNATURE=1`, and deliberately never printing the secret - only the
 * signature, which is public by design, and the body, which is the payload the sender chose to
 * post. Turn it on for one delivery when a signature will not verify, read the log, turn it off.
 */
function logSignatureDiagnostics(req, secret) {
  if (String(process.env.CALLYZER_DEBUG_SIGNATURE || "") !== "1") return;
  const header = SIGNATURE_HEADERS.find((name) => req.header(name));
  const provided = header ? String(req.header(header)).trim() : "";
  const body = req.rawBody;
  console.warn("[callyzer-signature] header:", header || "none", "value:", provided || "none");
  console.warn("[callyzer-signature] body bytes:", body ? body.length : 0);
  if (body) console.warn("[callyzer-signature] body base64:", body.toString("base64"));
  if (!body || !provided) return;
  // Every candidate, so the one the sender used can be spotted by eye in the log.
  for (const [index, key] of signingKeys(secret).entries()) {
    for (const algorithm of ["sha256", "sha1", "sha512"]) {
      console.warn(`[callyzer-signature] key#${index}(${key.length}B) ${algorithm} hex:`, crypto.createHmac(algorithm, key).update(body).digest("hex"));
      console.warn(`[callyzer-signature] key#${index}(${key.length}B) ${algorithm} b64:`, crypto.createHmac(algorithm, key).update(body).digest("base64"));
    }
  }
}

/*
 * Compared without leaking how much of it matched.
 *
 * `!==` on a string returns as soon as two characters differ, and the time that takes is
 * measurable across enough requests - which is how a secret gets guessed one character at a time.
 * Lengths are compared first because `timingSafeEqual` throws on a mismatch, and the length of a
 * secret is not the part worth hiding.
 */
function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Whose leads this request gets - the resolver's answer for the permission the route was guarded
 * with (`SALES / CRM Leads`, set on `req.permission` by the router's guard), on the lead's own
 * reference columns. Resolved once per request and handed to whatever reads: the board's page
 * and counts as SQL, and every record endpoint as a check on the row already fetched, so an id
 * typed into the URL reaches exactly what the board shows.
 */
const LEAD_SCOPE_COLUMNS = { branch: "branchId", employee: "ownerEmployeeId", user: "createdByUserId" };
const leadScope = (req) => dataScope.resolve({ userId: Number(req.user.id), module: req.permission.module, feature: req.permission.feature, columns: LEAD_SCOPE_COLUMNS });

/**
 * The ids behind the board's "only mine" toggle, or null when it is off.
 *
 * Read from the signed-in account and never from the request body: the toggle says *which* of the
 * rows this reader may already see they want to look at, so the one thing it must not be able to do
 * is name somebody else. Off, it answers null and nothing is narrowed.
 */
/**
 * Who "mine" is, for the board's own toggle.
 *
 * The reader's own employee record, plus whether they see the whole studio - because those two
 * answer different halves of the question. A lead is mine when its **CRM is me**; a lead with **no
 * CRM at all** is nobody's, and it has to surface somewhere or it is only ever found by turning the
 * switch off and reading the whole board. It surfaces for whoever can see everything: they are the
 * ones who hand leads out, and an unassigned lead is work waiting to be given to somebody. A CRM
 * looking at their own leads is not shown other people's unassigned work.
 */
const leadMine = async (req, wanted) => {
  if (!wanted) return null;
  const [self, seesUnassigned] = await Promise.all([
    dataScope.selfIds(Number(req.user.id)),
    dataScope.seesEverything(Number(req.user.id), { module: req.permission.module, feature: req.permission.feature }),
  ]);
  return { ...self, seesUnassigned };
};

/**
 * Whether this reader has anybody reporting to them, which is the only case the board's "My Leads"
 * switch means anything in.
 *
 * For everybody else the two states are the same board: they are named on their own leads and on
 * nobody else's, so "all I may see" and "only mine" return the same rows. A switch that changes
 * nothing is worse than no switch - it invites somebody to flip it, see no difference, and conclude
 * the board is broken. So the client is told, and draws it only for the people it is for.
 *
 * The whole subtree rather than direct reports, matching what the data scope actually widens by: a
 * manager two levels above somebody still sees their leads, so they still have something to narrow.
 *
 * Answered from the org chart and not from the caller's own claim, and only ever used to decide
 * whether to *offer* the narrowing - it grants nothing, so a wrong answer here can hide a switch but
 * can never widen a board.
 */
async function readerManagesAnyone(req) {
  /*
   * Somebody the scope does not confine - a Super Admin, or anybody reaching every branch - sees
   * every lead in the studio, so "only mine" is *more* use to them than to anyone else. They have
   * no team under them in the org chart sense and were refused the switch entirely, which
   * contradicted the note above it.
   */
  if (await dataScope.seesEverything(Number(req.user.id), { module: req.permission.module, feature: req.permission.feature })) return true;
  const { employeeId } = await dataScope.selfIds(Number(req.user.id));
  if (!employeeId) return false;
  return (await dataScope.subtreeEmployeeIds(employeeId)).length > 0;
}

/** One lead the request may see, or null - out of scope reads as not found, on purpose. */
async function scopedLead(req, id) {
  const [scope, record] = await Promise.all([leadScope(req), getCrmLeadById(id)]);
  return record && scope.allows(record.lead) ? record : null;
}

/**
 * The ids among `ids` the request may act on. A bulk action over a selection is held to the same
 * line as the board that offered it: an id smuggled into the list that the board would not have
 * shown is dropped, silently, the way it would have been absent from the page.
 */
async function allowedLeadIds(req, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) return [];
  const scope = await leadScope(req);
  if (scope.unlimited) return wanted;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`enquiry_id\` AS \`enquiryId\`, \`branch_id\` AS \`branchId\`, \`owner_employee_id\` AS \`ownerEmployeeId\`, \`created_by_user_id\` AS \`createdByUserId\`
       FROM \`sales_crm_lead\` WHERE \`enquiry_id\` IN (${wanted.map(() => "?").join(", ")})`,
    ...wanted,
  );
  return rows.filter((row) => scope.allows(row)).map((row) => row.enquiryId);
}

async function list(req, res) {
  // The whole-table read the older screens use, held to the same scope as the board.
  try {
    const scope = await leadScope(req);
    return res.json({ data: (await listCrmLeads()).filter((record) => scope.allows(record.lead)) });
  } catch (error) { return sendError(res, error, "Unable to load CRM leads."); }
}

/**
 * The branches a lead may be assigned to.
 *
 * Read from the `branch` table, narrowed to the ones this person's roles reach, which is exactly
 * what the quotation's Source Branch picker offers - one list, one rule, `branchOptions`.
 *
 * It replaces a hard-coded array in the browser that named six branches the studio does not have:
 * `Erode`, `Tiruppur`, `Coimbatore`, `Bangalore`, `Hyderabad`, `Vizag` against the real `Erode TN`,
 * `Tiruppur TN`, `Coimbatore TN`, `Bangalore KA`, `Hyderabad TL`, `Visakhapatnam AP`. A branch the
 * studio added, renamed or disabled never reached the CRM at all, and Assigned Branch could not be
 * set to one - which is what "branches are not showing in Assigned Branch" was.
 *
 * Guarded by the router's own `SALES / CRM Leads`: this is the CRM's picker, and somebody who may
 * open the board may see which branches a lead can be filed against. The names are also already
 * visible on every lead row.
 */
async function branches(req, res) {
  try {
    /*
     * The id travels with the name, so a screen can show the branch a record is *filed under* rather
     * than the text somebody typed. Assigned Branch on a lead is this list, and a lead imported as
     * "Erode" against the branch "Erode TN" matched none of it - the popup showed a blank for a
     * lead whose `branch_id` was right all along.
     */
    // The board's own permission, so somebody holding leads across every branch is offered every
    // branch here even where another of their roles reaches only one.
    const rows = await branchOptionRows(prisma, Number(req.user.id), { module: "SALES", feature: "CRM Leads" });
    return res.json({ data: rows.map((row) => ({ value: row.name, label: row.name, id: row.id })) });
  } catch (error) {
    return sendError(res, error, "Unable to load the branches.");
  }
}

// Every vertical's fields in one call: the CRM page needs all three to render its table, its
// info panel and Add Lead without refetching each time the vertical is switched.
async function listTableSettings(req, res) {
  try {
    return res.json({ data: await listCustomFields(String(req.query.vertical || "").trim()) });
  } catch (error) {
    return sendError(res, error, "Unable to load CRM table settings.");
  }
}

const meetingSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional().default(""),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().optional().default(""),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  attendees: z.array(z.string().trim().email()).max(50).optional().default([]),
  timeZone: z.string().trim().max(60).optional().default(""),
});

// How many times this number has enquired, and which leads those were.
async function duplicates(req, res) {
  try {
    const rows = await listLeadsSharingPhone(req.query.phone);
    const excludeId = String(req.query.excludeId || "").trim();
    return res.json({
      data: {
        // Every enquiry on this number, the one being viewed included - "Enquired : 2 times"
        // means this lead and one other.
        count: rows.length,
        leads: rows.filter((row) => row.enquiryId !== excludeId).map((row) => ({
          enquiryId: row.enquiryId,
          name: row.name || "",
          vertical: row.vertical || "",
          status: row.status || "",
          enquiryDate: row.createdDate || row.addedTime || "",
          nextFollowUpDate: row.nextFollowUpDate || "",
          lastFollowUpDate: row.lastFollowUpDate || "",
        })),
      },
    });
  } catch (error) {
    return sendError(res, error, "Unable to check this phone number.");
  }
}

async function getOne(req, res) {
  try {
    const record = await scopedLead(req, req.params.id);
    if (!record) return res.status(404).json({ message: "Lead not found." });
    return res.json({ data: record });
  } catch (error) {
    return sendError(res, error, "Unable to load this CRM lead.");
  }
}

// What this lead became: the Sales Manager projects created from it. Read by the lead popup's
// Converted History tab.
async function projects(req, res) {
  try {
    if (!(await scopedLead(req, req.params.id))) return res.status(404).json({ message: "Lead not found." });
    return res.json({ data: await listCrmLeadProjects(req.params.id) });
  } catch (error) {
    return sendError(res, error, "Unable to load the converted history for this lead.");
  }
}

async function meetings(req, res) {
  try {
    if (!(await scopedLead(req, req.params.id))) return res.status(404).json({ message: "Lead not found." });
    return res.json({ data: await listMeetings(String(req.params.id || "").trim()) });
  } catch (error) {
    return sendError(res, error, "Unable to load meetings for this lead.");
  }
}

// The error code matters as much as the message here: the panel keys its Connect and
// Reconnect buttons off it, so a missing Calendar grant reads as an action rather than a
// failure.
async function scheduleMeeting(req, res) {
  const parsed = meetingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid meeting details.", errors: parsed.error.flatten() });
  try {
    if (!(await scopedLead(req, req.params.id))) return res.status(404).json({ message: "Lead not found." });
    const meeting = await createMeeting({
      ...parsed.data,
      enquiryId: String(req.params.id || "").trim(),
      userId: req.user?.id,
    });
    return res.status(201).json({ message: "Meeting scheduled.", data: meeting });
  } catch (error) {
    if (error.code) {
      return res.status(error.status || 400).json({ message: error.message, code: error.code });
    }
    return sendError(res, error, "Unable to schedule this meeting.");
  }
}

async function removeMeeting(req, res) {
  try {
    if (!(await scopedLead(req, req.params.id))) return res.status(404).json({ message: "Lead not found." });
    const meeting = await cancelMeeting({
      id: String(req.params.meetingId || "").trim(),
      enquiryId: String(req.params.id || "").trim(),
      userId: req.user?.id,
    });
    return res.json({ message: "Meeting cancelled.", data: meeting });
  } catch (error) {
    return sendError(res, error, "Unable to cancel this meeting.");
  }
}

async function saveTableSettings(req, res) {
  const parsed = tableSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid table settings.", errors: parsed.error.flatten() });
  try {
    const data = await replaceCustomFields(parsed.data.vertical, parsed.data.fields);
    return res.json({
      message: `${data.length} field${data.length === 1 ? "" : "s"} saved for ${parsed.data.vertical}.`,
      data,
    });
  } catch (error) {
    return sendError(res, error, "Unable to save CRM table settings.");
  }
}

async function importCsv(req, res) {
  const parsed = csvImportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid CSV import payload.", errors: parsed.error.flatten() });
  }
  try {
    return res.json({ data: await importCsvRows(parsed.data) });
  } catch (error) {
    return sendError(res, error, "Unable to import CSV leads.");
  }
}

// Cancelling is a rollback, not a stop: the import is treated as something that never
// happened, so every lead the run had already written is removed again.
async function cancelImportCsv(req, res) {
  const batchId = String(req.params.batchId || "").trim();
  if (!batchId || batchId.length > 191) {
    return res.status(400).json({ message: "A valid import batch id is required." });
  }
  try {
    const { deleted } = await cancelBatch(batchId);
    return res.json({
      message: deleted
        ? `Import cancelled. ${deleted.toLocaleString()} partly imported lead${deleted === 1 ? "" : "s"} removed.`
        : "Import cancelled. No leads were added.",
      data: { batchId, deleted },
    });
  } catch (error) {
    return sendError(res, error, "Unable to cancel the CSV import.");
  }
}

/*
 * Which store this request is asking about.
 *
 * Spelled out rather than imported from the client's `CALLS_BOARD`, which lives in the other half of
 * the repo; `crm-boards.test.mjs` pins the two spellings to each other so they cannot drift.
 */
function isCallsBoard(board) {
  return String(board || "").trim() === "Calls";
}

/*
 * One column's values, asked with the same board, tab, range and filters the page is being read
 * with - so the menu describes the rows on screen rather than the table as a whole.
 *
 * `column` is a name, never SQL: the services answer an empty list for anything they do not
 * recognise, and neither of them ever interpolates what arrives here.
 */
const columnValuesQuerySchema = z.object({
  column: z.string().trim().min(1).max(60),
  board: z.string().trim().default("Dum Dum"),
  /*
   * "Only mine" - the board's own toggle, off by default so the board opens on everything this
   * reader may see, as it always has.
   *
   * A view filter and never a widening: `mineClause` ANDs it with the data scope, so it can only
   * take rows away from what that already allowed. Which is why it is offered to everybody, a Super
   * Admin included - they are narrowed by nothing and have no other way to ask for just their own.
   */
  mine: z.enum(["true", "false"]).default("false"),
  view: z.string().trim().default("all"),
  /*
   * A column filter is a string **or** a list of them.
   *
   * The string is what somebody typed into the box above a column and narrows by matching text; the
   * list is what they ticked in a column that offers one, and is an exact match on any of it. This
   * schema named only the first, so a board filtered to two statuses was refused outright with
   * "Invalid query." before the query was ever built.
   */
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  today: z.string().trim().default(""),
  dateFrom: z.string().trim().default(""),
  dateTo: z.string().trim().default(""),
});

const pageQuerySchema = z.object({
  board: z.string().trim().default("Dum Dum"),
  /*
   * "Only mine" - the board's own toggle, off by default so the board opens on everything this
   * reader may see, as it always has.
   *
   * A view filter and never a widening: `mineClause` ANDs it with the data scope, so it can only
   * take rows away from what that already allowed. Which is why it is offered to everybody, a Super
   * Admin included - they are narrowed by nothing and have no other way to ask for just their own.
   */
  mine: z.enum(["true", "false"]).default("false"),
  /*
   * Every tab any board offers, across both stores.
   *
   * The first twelve are the verticals', answered by leadQueryService; the last four are the Calls
   * board's, answered by callBoardService against the call log. One enum rather than two because
   * one request serves both boards - and a `view` the schema does not list is a 400 that blanks the
   * whole board rather than the one tab, which is why a tab added to the page has to be added here
   * in the same change.
   */
  view: z.enum([
    "all", "yetToConnect", "unassigned", "pending", "new", "today", "converted", "rejected",
    "yesterdayPending", "overallPending", "newborns", "birthdays",
    "incoming", "outgoing", "connected", "notConnected",
  ]).default("all"),
  /*
   * A column filter is a string **or** a list of them.
   *
   * The string is what somebody typed into the box above a column and narrows by matching text; the
   * list is what they ticked in a column that offers one, and is an exact match on any of it. This
   * schema named only the first, so a board filtered to two statuses was refused outright with
   * "Invalid query." before the query was ever built.
   */
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  sortColumn: z.string().trim().default(""),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  today: z.string().trim().default(""),
  /*
   * The header's date range, as two inclusive day keys.
   *
   * The client resolves "This Week" into a pair of days rather than sending the word, so the two
   * halves cannot disagree about when a week begins - see frontend/src/lib/crmDateRange.mjs. Only
   * a `YYYY-MM-DD` is accepted, and either end may be sent alone; the stores compare against the
   * day the lead arrived and the day the call came in respectively.
   */
  // Empty is allowed by the pattern itself rather than by `.optional()`, so an end the client sends
  // as a blank string is "no limit at this end" and not a 400 that blanks the whole board.
  dateFrom: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  dateTo: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(""),
  /*
   * Whether this request is a scroll append rather than a fresh look at the board.
   *
   * An append needs the rows and nothing else: the total under the table and the counts on the tabs
   * are properties of the whole set, and the set has not changed - the reader is walking down a
   * list they already asked for. Recomputing both per page meant the fiftieth page paid for the
   * forty-nine before it, which at half a million leads is most of the cost of scrolling.
   */
  append: z.enum(["true", "false"]).optional().default("false"),
});

// Paginated listing. The table asks for one page at a time so payload and render cost
// stay flat no matter how many leads are stored.
async function page(req, res) {
  let filters = {};
  if (req.query.filters) {
    try {
      filters = JSON.parse(req.query.filters);
    } catch {
      return res.status(400).json({ message: "Invalid filters parameter." });
    }
  }
  const parsed = pageQuerySchema.safeParse({ ...req.query, filters });
  if (!parsed.success) return res.status(400).json({ message: "Invalid query.", errors: parsed.error.flatten() });

  const appending = parsed.data.append === "true";
  try {
    /*
     * The Calls board is the call log, not a slice of the lead table.
     *
     * Same endpoint, same request, same record shape back - so the board's table, filters, sorting,
     * infinite scroll and selection are the ones every other board uses. Only the store underneath
     * differs, and it differs entirely: a call has a direction and a length where a lead has a
     * status and a follow-up date.
     */
    if (isCallsBoard(parsed.data.board)) {
      const [{ rows, total }, counts] = await Promise.all([
        listCallBoardPage({ ...parsed.data, withTotal: !appending }),
        appending ? Promise.resolve(null) : callBoardTabCounts(parsed.data),
      ]);
      return res.json({ data: rows.map(callToRecord), ...(appending ? {} : { total, counts }) });
    }
    // The counts and the total are skipped entirely while appending, rather than computed and
    // thrown away. The board keeps the ones it already has.
    const [scope, mine] = await Promise.all([leadScope(req), leadMine(req, parsed.data.mine === "true")]);
    const [{ rows, total }, counts, managesAnyone] = await Promise.all([
      listCrmLeadsPage({ ...parsed.data, withTotal: !appending, scope, mine }),
      // The same `mine`, so a tab's count and the rows it opens can never describe different sets.
      appending ? Promise.resolve(null) : crmLeadTabCounts({ ...parsed.data, scope, mine }),
      // Only on a real read. A scroll append is the same board the reader is already looking at, so
      // this cannot have changed and the org-chart walk would be paid again for nothing.
      appending ? Promise.resolve(false) : readerManagesAnyone(req),
    ]);
    return res.json({ data: rows.map(toRecord), ...(appending ? {} : { total, counts, managesAnyone }) });
  } catch (error) {
    return sendError(res, error, "Unable to load CRM leads.");
  }
}

/*
 * What one filter dropdown should offer: the values that column actually holds, on the tab being
 * read.
 *
 * The board's filters used to offer the registers themselves - the whole Sales roster under CRM,
 * every branch under Assigned Branch, the full list of shoot types - so most of a menu was values
 * no row in front of the reader held, and picking one emptied the board. A spreadsheet answers this
 * differently and better: the list is what is in the column.
 *
 * The same query the board is reading, minus this column's own filter, so the request carries the
 * board, the tab, the range and the other filters exactly as the page request does. Answered from
 * whichever store that board is - the lead table, or the call log - because the reader cannot see
 * which one they are looking at and should not have to.
 *
 * No permission of its own: these are values off rows this caller is already being served, narrowed
 * by the same data scope `page` applies. A column name it does not recognise is an empty list rather
 * than an error - a filter with no menu still takes typing.
 */
async function columnValues(req, res) {
  let filters = {};
  if (req.query.filters) {
    try {
      filters = JSON.parse(req.query.filters);
    } catch {
      return res.status(400).json({ message: "Invalid filters parameter." });
    }
  }
  const parsed = columnValuesQuerySchema.safeParse({ ...req.query, filters });
  if (!parsed.success) return res.status(400).json({ message: "Invalid query.", errors: parsed.error.flatten() });

  try {
    if (isCallsBoard(parsed.data.board)) {
      return res.json({ data: await callBoardColumnValues(parsed.data) });
    }
    const [scope, mine] = await Promise.all([leadScope(req), leadMine(req, parsed.data.mine === "true")]);
    // A column filter's menu offers what the rows behind it hold, so it narrows with them.
    return res.json({ data: await crmLeadColumnValues({ ...parsed.data, scope, mine }) });
  } catch (error) {
    return sendError(res, error, "Unable to load the values for that column.");
  }
}

// Resolves "select all" to the ids it actually covers. The table only holds the pages that
// have been scrolled into view, so the browser cannot work this set out for itself.
async function ids(req, res) {
  let filters = {};
  if (req.query.filters) {
    try {
      filters = JSON.parse(req.query.filters);
    } catch {
      return res.status(400).json({ message: "Invalid filters parameter." });
    }
  }
  const parsed = pageQuerySchema.safeParse({ ...req.query, filters });
  if (!parsed.success) return res.status(400).json({ message: "Invalid query.", errors: parsed.error.flatten() });

  try {
    const matched = isCallsBoard(parsed.data.board)
      ? await listCallBoardIds(parsed.data)
      : await listCrmLeadIds({ ...parsed.data, scope: await leadScope(req), mine: await leadMine(req, parsed.data.mine === "true") });
    return res.json({ data: matched, total: matched.length });
  } catch (error) {
    return sendError(res, error, "Unable to resolve the selected CRM leads.");
  }
}

// Everything that has happened to one lead, newest first.
async function activity(req, res) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ message: "A lead id is required." });
  try {
    if (!(await scopedLead(req, id))) return res.status(404).json({ message: "Lead not found." });
    return res.json({ data: await listLeadActivity(id) });
  } catch (error) {
    return sendError(res, error, "Unable to load the activity log for this lead.");
  }
}

// The calls held against one lead, for the Call Logs tab. Same shape as the activity endpoint
// beside it, so the panel loads both the same way.
async function callLogs(req, res) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ message: "A lead id is required." });
  try {
    if (!(await scopedLead(req, id))) return res.status(404).json({ message: "Lead not found." });
    /*
     * The lead's own number, so the tab shows this client's calls rather than only the ones filed
     * against this row - calls that arrived before the lead existed, and calls that landed on a
     * duplicate back when a delivery could create a second row for a number already held.
     *
     * Contact number first, the same order the webhook matches in. A lead that cannot be read is
     * not an error here: the tab falls back to matching on the id alone.
     */
    let phone = "";
    try {
      const record = await getCrmLeadById(id);
      phone = record?.lead?.contactNumber || record?.lead?.phone || "";
    } catch (error) {
      console.warn("Unable to read the lead's number for its call logs:", error?.message || error);
    }
    return res.json({ data: await listLeadCallLogs(id, { phone }) });
  } catch (error) {
    return sendError(res, error, "Unable to load the call logs for this lead.");
  }
}

/**
 * The transcripts on one lead, for the Transcripts tab.
 *
 * The list, without segments: a lead with twenty calls would carry thousands of segment rows to
 * render twenty cards. The full transcript is fetched for the one call being opened.
 */
async function leadTranscripts(req, res) {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ message: "A lead id is required." });
  try {
    if (!(await scopedLead(req, id))) return res.status(404).json({ message: "Lead not found." });
    const rows = await transcripts.listForLead(id);
    return res.json({
      data: rows.map((row) => ({
        ...row,
        suggestions: row.suggestions ? JSON.parse(row.suggestions) : null,
        appliedFields: row.appliedFields ? JSON.parse(row.appliedFields) : null,
      })),
    });
  } catch (error) {
    return sendError(res, error, "Unable to load the transcripts for this lead.");
  }
}

/** One transcript with its segments - what "View Full Transcript" opens. */
async function transcriptDetail(req, res) {
  const id = String(req.params.transcriptId || "").trim();
  if (!id) return res.status(400).json({ message: "A transcript id is required." });
  try {
    const row = await transcripts.findById(id);
    if (!row) return res.status(404).json({ message: "That transcript no longer exists." });
    return res.json({
      data: {
        ...row,
        suggestions: row.suggestions ? JSON.parse(row.suggestions) : null,
        appliedFields: row.appliedFields ? JSON.parse(row.appliedFields) : null,
      },
    });
  } catch (error) {
    return sendError(res, error, "Unable to load that transcript.");
  }
}

/**
 * Write the accepted suggestions onto the lead.
 *
 * Only ever from a person pressing Apply. The model reads a machine transcript of a noisy phone
 * call and will sometimes hear a number as a budget; offering that is useful, writing it silently
 * is not.
 *
 * Which fields are written is chosen by the caller and filtered against an allowlist, so a request
 * cannot reach a column the panel never offered. Everything goes through `updateCrmLead`, so the
 * change is logged in the activity log and pushed to the sheet exactly like a hand edit.
 */
async function version(req, res) {
  try {
    /*
     * Both stores, because the board is read through both.
     *
     * This is the signal every open board polls to find out whether to refetch its first page, and
     * it used to read the lead table alone - which was enough while every delivered call created a
     * lead. A call from an unknown number creates nothing now, so on the Calls board that signal
     * would never move and calls would arrive invisibly until somebody reloaded the page.
     *
     * One string over the two rather than an answer per board: the poll asks no question and the
     * cost of a vertical refetching its first page when a call lands is one page - and a call that
     * *did* land on a lead has changed that vertical anyway.
     */
    const [leads, calls] = await Promise.all([getCrmLeadVersion(), callBoardVersion()]);
    return res.json({ data: { ...leads, version: `${leads.version}|${calls}` } });
  } catch (error) { return sendError(res, error, "Unable to read CRM lead version."); }
}

/*
 * ── One number, one enquiry, within a vertical ────────────────────────────────────────────────
 *
 * A second lead on a number the vertical already holds is the same client written down twice: their
 * calls, remarks and follow-ups split across two records that neither knows about, and nothing on
 * either screen saying so. Refused here rather than warned about, because inside one vertical there
 * is no reading of it that is not a mistake.
 *
 * Across verticals it is allowed and is not a mistake - a wedding client who later books a
 * corporate shoot is one number and two enquiries on purpose. The forms show the other vertical's
 * enquiry as a warning and go on saving; only a clash inside the *same* vertical is stopped.
 *
 * The guard is here rather than only in the browser for the ordinary reason: the form's check is a
 * convenience and this is the rule. An import, a second tab, a request made by hand, or a form
 * whose check had not answered yet all arrive at this function.
 */
async function verticalClashResponse(res, { phone, vertical, excludeId = "" }) {
  if (!String(phone || "").trim()) return null;
  const clash = await findVerticalDuplicate({ phone, vertical, excludeId });
  if (!clash) return null;
  /*
   * 409, and the enquiry named in the body as well as in the message.
   *
   * The id is the only thing that makes this answerable: "already an enquiry" leaves somebody
   * hunting the board for a record they cannot see, and the form uses `enquiryId` to offer to open
   * it. `code` is what lets the browser tell this apart from an ordinary validation failure.
   */
  return res.status(409).json({
    message: `${clash.enquiryId} in ${verticalFromValue(vertical)} already holds this contact number. One number is one enquiry within a vertical.`,
    code: "DUPLICATE_PHONE_IN_VERTICAL",
    data: { enquiryId: clash.enquiryId, name: clash.name || "", vertical: clash.vertical || "", status: clash.status || "" },
  });
}

/**
 * The same rule over a whole batch, answered before anything is written.
 *
 * Two questions rather than one. A row can clash with a lead the CRM already holds, and two rows of
 * the *same* batch can clash with each other - a paste that repeats a number would otherwise pass
 * every individual lookup, since neither row is in the database yet, and write both. The second is
 * the one a per-row check can never catch.
 *
 * Before any id is minted, for the reason `create` gives: refusing afterwards burns enquiry numbers
 * on leads that were never written, and the gaps read as deletions to whoever audits the board.
 *
 * Every row is reported rather than the first, because a bulk entry grid is corrected in one pass -
 * naming one row at a time would mean submitting the same batch five times to find five problems.
 */
async function batchVerticalClashes(records = []) {
  const clashes = [];
  const seenInBatch = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const lead = records[index]?.lead || {};
    const phone = String(lead.phone || "").trim();
    const vertical = verticalFromValue(lead.vertical || "");
    const digits = phoneMatchKey(phone);
    // No number or no vertical is half a pair, and half a pair is not a clash - the same answer
    // `findVerticalDuplicate` gives.
    if (!digits || !vertical) continue;

    const key = `${digits}::${vertical}`;
    // The number itself travels with every clash. "Row 7 is a duplicate" sends somebody counting
    // down a grid; "9876543210, on rows 3 and 7" is the thing they actually have to go and look at,
    // and it is the same news whether the other copy is in this batch or already in the CRM.
    if (seenInBatch.has(key)) {
      clashes.push({
        row: index + 1,
        field: "phone",
        phone,
        duplicateOfRow: seenInBatch.get(key),
        reason: `${phone} is already on row ${seenInBatch.get(key)} of this batch (${vertical}).`,
      });
      continue;
    }
    seenInBatch.set(key, index + 1);

    const clash = await findVerticalDuplicate({ phone, vertical: lead.vertical });
    if (clash) {
      clashes.push({
        row: index + 1,
        field: "phone",
        phone,
        enquiryId: clash.enquiryId,
        reason: `${phone} is already held by ${clash.enquiryId} in ${vertical}.`,
      });
    }
  }
  return clashes;
}

async function create(req, res) {
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid CRM lead data.", errors: parsed.error.flatten() });
  try {
    const record = parsed.data;
    // Before an id is minted: refusing after the counter has moved would burn a number on a lead
    // that was never written, and the gaps are read as deletions by whoever audits the board.
    const clash = await verticalClashResponse(res, { phone: record.lead.phone, vertical: record.lead.vertical, excludeId: record.lead.id });
    if (clash) return clash;
    // Minted here rather than in the browser: an enquiry id counts within its own vertical and
    // branch, and only the counter knows where that pair has got to.
    record.lead.id = record.lead.id || await nextLeadId({ vertical: record.lead.vertical, branch: record.lead.assignedBranch });
    const created = await createCrmLead(record);
    // Whoever entered it is one of the names the scope reads, so a lead nobody is assigned yet is
    // still visible to the person who created it.
    await stampCrmLeadCreator(created?.lead?.id || record.lead.id, req.user?.id);
    await recordLeadActivity(created?.lead?.id, [{ action: "CREATED", fieldLabel: "Lead" }], actorFrom(req));
    /*
     * Every call this number has made, handed to the lead now that there is one.
     *
     * This is what "only when they become an enquiry" means at the other end: a call waits on the
     * Calls board under its own Call ID with no lead against it, and the Enquiry ID appears against
     * it here. Done for a lead typed in by hand as much as for one added off the Calls board - a
     * client who has been ringing for a week and is only now written down has a week of history, and
     * it is theirs either way.
     *
     * Swallowed on failure: the lead is created and saying so is what the caller is waiting for; a
     * call left unlinked is recoverable and a lead reported as failed after it was written is not.
     */
    await linkCallsToLead(created?.lead?.phone || record.lead.phone, created?.lead?.id).catch(() => {});
    /*
     * A lead entered against somebody else's name tells them it is theirs.
     *
     * Here rather than inside `createCrmLead`, which is also the sheet poller's and the Callyzer
     * webhook's way in and has no signed-in person to name as the actor. `notify` refuses to tell
     * somebody about their own action, so entering a lead for yourself is silent.
     */
    await notifyLeadAssigned(
      { enquiryId: created?.lead?.id || record.lead.id, name: created?.lead?.name || record.lead.name },
      { crm: created?.lead?.crm || record.lead.crm || "", actorId: req.user?.id ?? null },
    );
    return res.status(201).json({ data: created });
  } catch (error) { return sendError(res, error, "Unable to add CRM lead."); }
}

/**
 * Several leads at once - what Bulk Entry posts, and what the CSV import's own writer feeds.
 *
 * ── Every record is minted an Enquiry ID it does not bring ──
 *
 * `recordSchema` makes `lead.id` optional, exactly as the single create does, because an enquiry id
 * counts within its own vertical and branch and only the counter knows where that pair has got to.
 * The single create mints one; this did not, so a caller that left the id out - which is every
 * caller that is not replaying an existing lead - wrote rows with a blank `enquiry_id`. That is the
 * column the whole module is keyed by: the board's row key, the Call Logs join, the activity log,
 * the duplicate check. Blank, the leads land nowhere anybody can open them.
 *
 * One at a time rather than one reserved range for all of them, because the records can be of
 * different verticals and branches - Bulk Entry lets each entry pick its own - and a range is
 * reserved per counter. `reserveLeadIdRange` behind `nextLeadId` is what makes each of these a
 * single atomic increment.
 *
 * ── And each one is recorded and announced the way a single create is ──
 *
 * Whoever entered them is stamped as the creator, so a lead nobody is assigned yet is still visible
 * to the person who typed it; each gets its CREATED row in the activity log; and a lead entered
 * against somebody else's name tells them so. Left out, a lead added this way would be a lead with
 * no history and a silent handover - the same lead added one at a time has both.
 */
async function createBulk(req, res) {
  const parsed = bulkRecordSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = validationErrors(parsed.error);
    const first = errors[0];
    return res.status(400).json({ message: first?.row ? `CSV row ${first.row}${first.field ? ` (${first.field})` : ""}: ${first.reason}` : "Invalid CRM bulk lead data.", errors });
  }
  try {
    /*
     * One number, one enquiry within a vertical - here as well as on the single-lead form.
     *
     * This path had no such check, so Bulk Entry was a way round the rule the form enforces: the
     * same number pasted into a batch, or already held by a lead the sheet imported, was written
     * without a word. The whole batch is refused and every offending row named, which is how a
     * grid is corrected - the alternative writes half a batch and leaves the reader working out
     * which half.
     */
    const clashes = await batchVerticalClashes(parsed.data.records);
    if (clashes.length) {
      // The numbers, named in the message itself - the dialog prints this straight through, and a
      // count alone is not something anybody can act on.
      const numbers = [...new Set(clashes.map((entry) => entry.phone).filter(Boolean))];
      return res.status(409).json({
        message: `${numbers.join(", ")} ${numbers.length === 1 ? "is" : "are"} already in this vertical. One number is one enquiry within a vertical.`,
        code: "DUPLICATE_PHONE_IN_VERTICAL",
        errors: clashes,
      });
    }

    const records = [];
    for (const record of parsed.data.records) {
      const id = record.lead.id || await nextLeadId({ vertical: record.lead.vertical, branch: record.lead.assignedBranch });
      records.push({ ...record, lead: { ...record.lead, id } });
    }

    const created = await createCrmLeads(records);
    const ids = created.map((record) => record?.lead?.id).filter(Boolean);
    await stampCrmLeadCreator(ids, req.user?.id);
    await recordBulkActivity(ids.map((id) => ({ enquiryId: id, action: "CREATED", fieldLabel: "Lead" })), actorFrom(req));
    for (const record of created) {
      await notifyLeadAssigned(
        { enquiryId: record?.lead?.id, name: record?.lead?.name },
        { crm: record?.lead?.crm || "", actorId: req.user?.id ?? null },
      );
    }
    return res.status(201).json({ data: created });
  } catch (error) { return sendError(res, error, "Unable to import CRM leads."); }
}

async function update(req, res) {
  const parsed = updateRecordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid CRM lead data.", errors: parsed.error.flatten() });
  try {
    const id = String(req.params.id || "").trim();
    // Read through the scope first: a lead the board would not show cannot be edited by its id.
    const stored = await scopedLead(req, id);
    if (!stored) return res.status(404).json({ message: "Lead not found." });
    /*
     * The number, only when this write is actually changing it.
     *
     * The popup writes one field per keystroke, so the overwhelming majority of updates carry no
     * phone at all and must not pay for a lookup - and a lead saving its other fields must never be
     * refused over a number it has held all along, which `excludeId` is what prevents.
     */
    const phone = String(parsed.data.lead?.phone ?? parsed.data.details?.phone ?? "").trim();
    /*
     * The number the lead already holds, so a write that is not *changing* it is never refused.
     *
     * `excludeId` stops a lead clashing with itself, but not with a second lead that already shares
     * its number - and those exist: Bulk Entry, the CSV import and the sheet sync all wrote leads
     * for years without asking this question. Guarding an unchanged number would make every one of
     * those pairs uneditable, which is to say unfixable: the studio could not even open one and
     * correct the number to something else.
     *
     * So the rule guards the *change*. Putting a clashing number onto a lead is still refused;
     * re-saving the number a lead came with is not.
     */
    const storedPhone = String(stored?.lead?.phone ?? stored?.details?.phone ?? "").trim();
    const changingPhone = phoneMatchKey(phone) !== phoneMatchKey(storedPhone);
    if (phone && changingPhone) {
      /*
       * The vertical this lead is *in*, read from the stored record unless this write is moving it.
       *
       * It has to be the stored one: the update body is a patch, so a write that changes only the
       * number says nothing about the vertical, and taking the body's blank as "no vertical" would
       * skip the guard on exactly the write it exists to catch.
       */
      const vertical = parsed.data.lead?.vertical || parsed.data.details?.vertical || stored?.lead?.vertical || stored?.details?.vertical || "";
      const clash = await verticalClashResponse(res, { phone, vertical, excludeId: id });
      if (clash) return clash;
    }
    return res.json({ data: await updateCrmLead(id, parsed.data, actorFrom(req)) });
  } catch (error) { return sendError(res, error, "Unable to update CRM lead."); }
}

async function remove(req, res) {
  try {
    if (!(await scopedLead(req, req.params.id))) return res.status(404).json({ message: "Lead not found." });
    await deleteCrmLead(req.params.id); return res.status(204).end();
  } catch (error) { return sendError(res, error, "Unable to delete CRM lead."); }
}

async function removeBulk(req, res) {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Select at least one valid CRM lead to delete.", errors: parsed.error.flatten() });
  try {
    const ids = await allowedLeadIds(req, parsed.data.ids);
    const { deletedIds, blocked } = ids.length ? await deleteCrmLeads(ids) : { deletedIds: [], blocked: new Map() };
    /*
     * Said out loud, rather than reported as a smaller number.
     *
     * A delete now really removes the row, and a lead carrying a project, a quotation or a CRD
     * document is refused so those records are not left naming an enquiry that no longer exists.
     * Answering "12 leads deleted" for a selection of fifteen would leave the reader to notice the
     * three that stayed and work out why on their own.
     */
    const refused = [...blocked.keys()];
    if (!deletedIds.length) {
      return refused.length
        ? res.status(409).json({
          message: `${refused.length === 1 ? "That lead has" : `Those ${refused.length} leads have`} work raised against ${refused.length === 1 ? "it" : "them"}, so ${refused.length === 1 ? "it was" : "they were"} not deleted: ${refused.slice(0, 5).map((id) => `${id} (${blocked.get(id)})`).join(", ")}${refused.length > 5 ? ", and more" : ""}.`,
          data: { deletedIds: [], blockedIds: refused },
        })
        : res.status(404).json({ message: "None of the selected CRM leads were found." });
    }
    const deletedNote = `${deletedIds.length} lead${deletedIds.length === 1 ? "" : "s"} deleted successfully.`;
    return res.json({
      message: refused.length
        ? `${deletedNote} ${refused.length} kept, ${refused.length === 1 ? "having" : "each having"} work raised against ${refused.length === 1 ? "it" : "them"}: ${refused.slice(0, 5).map((id) => `${id} (${blocked.get(id)})`).join(", ")}${refused.length > 5 ? ", and more" : ""}.`
        : deletedNote,
      data: { deletedIds, blockedIds: refused },
    });
  } catch (error) { return sendError(res, error, "Unable to delete the selected CRM leads."); }
}

// Any one field may be sent on its own: Update Details treats a blank field as "leave this as
// it is", so requiring more than one would make a status-only change impossible to express.
const bulkStatusSchema = z.object({
  ids: z.array(z.string().trim().regex(ENQUIRY_ID_PATTERN)).min(1).max(200000),
  status: z.string().trim().min(1).max(191).optional(),
  lastFollowUpDate: z.string().trim().min(1).max(40).optional(),
  nextFollowUpDate: z.string().trim().min(1).max(40).optional(),
  /*
   * The day the browser is treating as today, as every board request sends.
   *
   * A status set on a Qua Qua lead whose birthday is being worked belongs to that birthday, and
   * which birthday that is depends on the day. Sent rather than read from the server's clock, for
   * the same reason the tabs send it: what is written has to agree with what the user was looking
   * at. Optional, and the studio's own day stands in - an older client that does not send it still
   * works.
   */
  today: z.string().trim().max(40).optional(),
}).refine((value) => value.status || value.lastFollowUpDate || value.nextFollowUpDate, {
  message: "Send a status, a last follow-up date, a next follow-up date, or any of them together.",
});

// Applies one status and follow-up date across a selection that may cover a whole branch, in
// a handful of statements rather than a request per lead.
async function bulkStatus(req, res) {
  const parsed = bulkStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Select at least one lead and a status or follow-up date to apply.", errors: parsed.error.flatten() });
  }
  const { status, lastFollowUpDate, nextFollowUpDate, today } = parsed.data;
  try {
    const ids = await allowedLeadIds(req, parsed.data.ids);
    const updated = ids.length
      ? await setCrmLeadStatus(ids, { status, lastFollowUpDate, nextFollowUpDate, today }, actorFrom(req))
      : 0;
    const leads = `${updated.toLocaleString()} lead${updated === 1 ? "" : "s"}`;
    const message = status
      ? `${leads} moved to ${status}.`
      : `${leads} updated successfully.`;
    return res.json({
      message,
      data: {
        updated,
        status: status || null,
        lastFollowUpDate: lastFollowUpDate || null,
        nextFollowUpDate: nextFollowUpDate || null,
      },
    });
  } catch (error) {
    return sendError(res, error, "Unable to change the status of the selected CRM leads.");
  }
}

const bulkAssignSchema = z.object({
  ids: z.array(z.string().trim().regex(ENQUIRY_ID_PATTERN)).min(1).max(200000),
  crms: z.array(z.string().trim().min(1).max(191)).min(1).max(50),
});

// Shares the given leads out between the chosen CRMs, one at a time in turn.
async function bulkAssign(req, res) {
  const parsed = bulkAssignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Select at least one lead and one CRM to assign to.", errors: parsed.error.flatten() });
  }
  try {
    const ids = await allowedLeadIds(req, parsed.data.ids);
    const { assigned, perCrm } = ids.length ? await assignCrmLeads(ids, parsed.data.crms, actorFrom(req)) : { assigned: 0, perCrm: {} };
    const spread = Object.entries(perCrm).map(([name, count]) => `${name}: ${count.toLocaleString()}`).join(", ");
    return res.json({
      message: `${assigned.toLocaleString()} lead${assigned === 1 ? "" : "s"} assigned${spread ? ` (${spread})` : ""}.`,
      data: { assigned, perCrm },
    });
  } catch (error) {
    return sendError(res, error, "Unable to assign the selected CRM leads.");
  }
}

async function renameGroup(req, res) {
  const parsed = renameGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Page name must contain between 1 and 120 characters." });
  try { return res.json({ data: await renameCrmLeadGroup(req.params.groupId, parsed.data.name) }); } catch (error) { return sendError(res, error, "Unable to rename the CRM lead page."); }
}

async function refresh(req, res) {
  try {
    return res.json({ data: await refreshCrmLeadsFromSheets() });
  } catch (error) {
    return sendError(res, error, "Unable to refresh CRM leads from linked Google Sheets.");
  }
}

async function ingestCallyzerWebhook(req, res) {
  const secret = process.env.CALLYZER_WEBHOOK_SECRET || "";
  // Either proof is enough: the secret presented directly - which is how a hand-run test or
  // another sender does it - or a signature over the body computed with that same secret.
  if (secret && !secretMatches(readWebhookSecret(req), secret) && !signatureMatches(req, secret)) {
    /*
     * The header names that arrived, so a sender carrying its secret somewhere unexpected can be
     * identified from the server's own log instead of by guesswork.
     *
     * Names only, never values: this line exists because a delivery was refused while the right
     * secret sat in the sender's configuration, and printing the values would put the real secret
     * into a log file to solve it.
     */
    console.warn(
      "Callyzer webhook refused - no valid secret or signature.",
      `signature header: ${SIGNATURE_HEADERS.find((header) => req.header(header)) || "none"};`,
      `raw body captured: ${req.rawBody ? `${req.rawBody.length} bytes` : "no"};`,
      "headers present:",
      Object.keys(req.headers || {}).sort().join(", "),
    );
    logSignatureDiagnostics(req, secret);
    return res.status(401).json({ message: "Invalid webhook secret." });
  }

  /*
   * Some senders post the JSON as a quoted string rather than as an object - a body that is
   * itself `"[{\"emp_name\":...}]"`. Parsing it once more costs nothing and turns a rejected
   * delivery into an accepted one; anything that is not JSON is left exactly as it arrived.
   */
  let body = req.body;
  if (typeof body === "string" && body.trim()) {
    try { body = JSON.parse(body); } catch { /* Not JSON. Reported below. */ }
  }

  /*
   * Said plainly, because this message is read in Callyzer's own test panel by somebody who
   * cannot see this server's logs. "Invalid payload" for a request whose body was never read is
   * what made a content-type problem look like a rejected batch.
   */
  if (body === undefined || body === null || body === "") {
    return res.status(400).json({
      message: "No webhook body was received. Send the call logs as JSON in the request body.",
    });
  }

  const parsed = callyzerWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid Callyzer webhook payload. Expected a list of employees, each with its own call_logs.",
      errors: parsed.error.flatten(),
    });
  }

  /*
   * Which of the delivered calls are leads at all.
   *
   * Everything Callyzer sent used to become a lead, so the sheet filled with rows that were never
   * enquiries: one member of staff ringing another - which arrives as a call to a number that looks
   * exactly like a client's - and employees' own calls home. Both are set aside here, before a lead
   * is built, matched or written, so a filtered call leaves nothing behind at all.
   *
   * The staff directory is the numbers Callyzer has ever reported as an employee's own, plus the
   * employees in this very delivery - a colleague whose first call arrives in the same batch as the
   * call made to them is still a colleague - plus anything named in CALLYZER_STAFF_NUMBERS.
   */
  const delivered = flattenCallyzerBatch(parsed.data);
  const routing = loadRoutingConfig();
  const staffNumbers = new Set([...routing.staffNumbers, ...await knownEmployeeNumbers()]);
  /*
   * The excluded numbers the CRM manages, alongside the ones named in the environment.
   *
   * Settings -> Exclude Phone Numbers is where the studio keeps these, because the people who know
   * which number is somebody's husband are the CRM staff rather than whoever has shell access to
   * the server. `CALLYZER_IGNORE_NUMBERS` still works and is simply added to the same set.
   */
  const personalNumbers = new Set([...routing.personalNumbers, ...await excludedNumberKeys()]);
  for (const { callLog, employee } of delivered) {
    const key = routingPhoneKey(employeeNumberOf(employee || {}, callLog || {}));
    if (key) staffNumbers.add(key);
  }

  const incoming = [];
  const setAside = { staff: 0, personal: 0, "unknown-number": 0 };
  for (const entry of delivered) {
    const reason = callFilterReason(entry.callLog || {}, entry.employee || {}, { ...routing, staffNumbers, personalNumbers });
    if (reason) setAside[reason] = (setAside[reason] || 0) + 1;
    else incoming.push(entry);
  }
  /*
   * Counts only, and deliberately no numbers: this line exists so somebody can tell a filter that
   * is working from one that is eating leads, and a client's phone number written into a log file
   * is that client's personal data sitting in a file nobody manages.
   */
  const skipped = Object.values(setAside).reduce((total, count) => total + count, 0);
  if (skipped) {
    console.info(
      `Callyzer webhook: ${skipped} of ${delivered.length} call${delivered.length === 1 ? "" : "s"} were not leads`,
      `(staff: ${setAside.staff}, personal: ${setAside.personal}, no number: ${setAside["unknown-number"]}).`,
    );
  }

  const records = [];
  const prepared = incoming.map(({ callLog, employee }, index) => callLogToLead(callLog || {}, index, employee || {}, routing));
  const existingByPhone = await leadsForPhones(prepared.map((record) => record.lead.phone));
  // The same key the lookup used, so a client rung twice in one delivery is one lead.
  const phoneKey = phoneMatchKey;
  /*
   * Every call, against the lead it ended up on.
   *
   * Collected as the batch is walked rather than written per call, because the lead a call belongs
   * to is only known once it has been matched or created - and a client rung three times in one
   * delivery is one lead with three calls, which is exactly what the Call Logs tab shows.
   */
  const callLogsToRecord = [];

  /*
   * The enquiries a lead already had before this delivery, keyed by lead.
   *
   * "Enquired N times" counts how many times the client has been in touch, and the calls are only
   * some of those. A lead that came in from a campaign or a spreadsheet and is now ringing has
   * enquired twice - once to become a lead, once on the phone - but the counter was reading the
   * call log alone, saw one row, and said nothing at all. A lead Callyzer itself created counts
   * only its calls, because its first call is the enquiry that created it.
   */
  const priorEnquiries = new Map();

  for (const [position, record] of prepared.entries()) {
    const { callLog, employee } = incoming[position] || {};
    const existing = record.lead.phone ? existingByPhone.get(phoneKey(record.lead.phone)) : null;
    if (existing) {
      /*
       * The client is already in the CRM, so this is their lead: the call is attached to it, the
       * lead is left standing, and no second row is created for a number the CRM already holds.
       * Which of the two numbers on the lead was dialled makes no difference - `leadsForPhones`
       * matches on either.
       */
      callLogsToRecord.push({ callLog, employee, enquiryId: existing.lead.id });
      const cameFromCallyzer = String(existing.lead.source || "").trim().toLowerCase() === "callyzer";
      if (!priorEnquiries.has(existing.lead.id)) priorEnquiries.set(existing.lead.id, cameFromCallyzer ? 0 : 1);
      records.push(await updateCrmLead(existing.lead.id, mergeCallIntoLead(existing, record)));
    } else {
      /*
       * A number the CRM does not hold. The call is stored and no lead is created.
       *
       * This is the change that gives calls their own identity. Every delivered call used to become
       * a lead on the spot, minted an `EID` from the enquiry counter - so a wrong number, a
       * two-second misdial and a real enquiry all took a number out of the run the studio reads as
       * "how many enquiries have we taken", and the Calls board was a queue of leads nobody had
       * asked for. The call now waits on the Calls board under a Call ID of its own, and becomes an
       * enquiry - and takes an `EID` - only when somebody reads the caller and adds them.
       *
       * `enquiryId` is left empty, and `linkCallsToLead` fills it in at that moment.
       */
      callLogsToRecord.push({ callLog, employee, enquiryId: "" });
    }
  }

  // After the leads, and deliberately not inside the loop above: the calls are the history, the
  // leads are the record, and a call log that will not store must not cost the lead it came with.
  await recordCallLogs(callLogsToRecord);

  /*
   * Queue a transcription for every call that has a recording.
   *
   * Deliberately after the leads and the call logs, and deliberately not awaited for its result:
   * Callyzer times a delivery out, and transcribing minutes of audio takes minutes. A row is
   * created so the CRM can show "Pending" straight away, and the work happens in the worker.
   *
   * Every failure here is swallowed. A queue that is down, a Redis that is restarting - none of
   * that is worth losing a call log over, and the call can be transcribed later.
   */
  for (const entry of callLogsToRecord) {
    const recordingUrl = pickFirst(
      entry.callLog?.call_recording_url,
      entry.callLog?.callRecordingUrl,
      entry.callLog?.recording_url,
      entry.callLog?.recordingUrl,
      entry.callLog?.recording,
      entry.callLog?.audio_url,
      entry.callLog?.audioUrl,
    );
    if (!recordingUrl) continue;
    try {
      const row = await transcripts.ensureTranscript({
        callLogId: entry.callLog?.id || `${entry.enquiryId}-${recordingUrl}`,
        enquiryId: entry.enquiryId,
        recordingUrl,
      });
      if (row && row.status !== "COMPLETED") await enqueueTranscription(row.id);
    } catch (error) {
      console.warn("Unable to queue a call transcription:", error?.message || error);
    }
  }

  /*
   * "Enquired 2 times", on the lead the calls landed on.
   *
   * Counted as every call on record plus the enquiry that created the lead where that enquiry was
   * not itself a call. A client who came in from a campaign in March and rings today has been in
   * touch twice, and the counter used to read the call log alone, find one row, and say nothing -
   * which is precisely the case somebody wants the marker for. A lead Callyzer created counts only
   * its calls, since its first call *is* the enquiry that created it.
   *
   * Counted from the call log rather than incremented, so a batch Callyzer redelivers - which
   * writes the same rows again by id - cannot inflate it. From two upward: one contact is not a
   * repeat.
   *
   * Written straight to the column rather than through `updateCrmLead`, which would push the lead
   * to the spreadsheet and write an activity line for a field nobody edited. Every failure is
   * swallowed: a counter that will not write must not cost the delivery the leads and calls it has
   * already stored.
   */
  const counts = await callLogCounts(callLogsToRecord.map((entry) => ({
    enquiryId: entry.enquiryId,
    // Counted by the client's number as well as the lead's id, so the marker agrees with what the
    // Call Logs tab shows - including calls that reached the CRM before this lead existed.
    phone: callyzerClientPhone(entry.callLog || {}),
  })));
  for (const [enquiryId, calls] of counts) {
    const total = calls + (priorEnquiries.get(enquiryId) || 0);
    if (total < 2) continue;
    try {
      await prisma.$executeRawUnsafe(
        "UPDATE `sales_crm_lead` SET `contact_repeated` = ? WHERE `enquiry_id` = ? AND `deleted_at` IS NULL",
        `Enquired ${total} times`,
        enquiryId,
      );
    } catch (error) {
      console.warn("Unable to mark a repeated contact:", error?.message || error);
    }
  }

  /*
   * 200 and a short answer, because the sender has to be able to read it.
   *
   * This replied 201 with every imported lead attached - about four kilobytes for three calls.
   * Callyzer accepted neither: its panel reported a failure while the leads sat in the CRM,
   * created correctly, and the body it printed was its own echo of the request rather than
   * anything this server said. A webhook's reply is a receipt, not a payload: plain 200, a couple
   * of fields, nothing to misparse and nothing that grows with the size of the batch.
   *
   * `success` is stated as well as implied, since some clients look for a field rather than at the
   * status line.
   */
  // The calls this delivery left on the Calls board: stored, and belonging to nobody yet.
  const waiting = callLogsToRecord.filter((entry) => !entry.enquiryId).length;

  return res.status(200).json({
    success: true,
    // The skipped count is named in the receipt as well as the log, because the person configuring
    // the webhook reads Callyzer's own panel and cannot see this server's logs. "3 imported" out of
    // a delivery of five looks like a fault until it says why the other two were not leads.
    /*
     * Stated as calls, because calls are what was delivered.
     *
     * It used to read "N call logs imported", meaning N leads created - which is no longer what a
     * delivery does, and was never what the sender asked about. The two numbers worth reading are
     * how many calls were stored and how many of them landed on a client the CRM already holds; the
     * rest are waiting on the Calls board for somebody to read them.
     */
    message: `${callLogsToRecord.length} Callyzer call${callLogsToRecord.length === 1 ? "" : "s"} received.`
      + (records.length ? ` ${records.length} matched an existing lead.` : "")
      + (waiting ? ` ${waiting} waiting on the Calls board.` : "")
      + (skipped ? ` ${skipped} call${skipped === 1 ? "" : "s"} were not leads and were skipped.` : ""),
    count: callLogsToRecord.length,
    matched: records.length,
    waiting,
    skipped,
  });
}

/*
 * Attachments on a remark.
 *
 * They used to travel as base64 inside the lead itself, so a photo attached to a note was carried
 * by every query that read that lead. Now the file goes to R2 under the client it belongs to and
 * the remark keeps only the key.
 *
 * The lead id is optional: Add Lead can attach a file to a note before the lead exists, and the
 * file is filed as unfiled rather than refused. When it is given, it is checked - it decides
 * which client's folder the file lands in.
 */
async function uploadRemarkAttachment(req, res) {
  try {
    if (!storageReady()) {
      return res.status(503).json({ message: "File storage is not configured, so attachments cannot be saved." });
    }
    if (!req.file?.buffer?.length) return res.status(400).json({ message: "Choose a file to attach." });

    const enquiryId = String(req.body?.enquiryId || "").trim();
    let clientName = "";
    if (enquiryId) {
      // Named so the bucket folder is the client's, and checked so an id that names no lead
      // cannot invent a folder.
      const [row] = await prisma.$queryRawUnsafe(
        "SELECT `name` FROM `sales_crm_lead` WHERE `enquiry_id` = ? AND `deleted_at` IS NULL LIMIT 1",
        enquiryId,
      );
      if (!row) return res.status(404).json({ message: "CRM lead not found." });
      clientName = String(row.name || "").trim();
    }

    const stored = await storeAttachment({ enquiryId, clientName, file: req.file });
    if (!stored) return res.status(500).json({ message: "Unable to store this attachment." });
    return res.status(201).json({ data: stored });
  } catch (error) {
    return sendError(res, error, "Unable to store this attachment.");
  }
}

/**
 * Streams one attachment back.
 *
 * The key names a client's folder, so it is not something a caller may choose freely: it has to
 * be one this CRM wrote, under the remarks root. Signed-in staff share the CRM's leads, so the
 * check is that the key belongs to the remarks tree rather than which account uploaded it -
 * matching how remarks themselves are readable across the team.
 */
async function remarkAttachment(req, res) {
  try {
    const key = String(req.query?.key || "");
    if (!key.startsWith(`${REMARK_ROOT}/`) || key.includes("..")) {
      return res.status(400).json({ message: "That is not a valid attachment." });
    }
    const object = await readAttachment(key);
    if (!object) return res.status(404).json({ message: "This attachment is no longer stored." });

    res.setHeader("Content-Type", object.contentType);
    // One client's material: nothing in between should keep a copy.
    res.setHeader("Cache-Control", "private, no-store");
    if (object.contentLength) res.setHeader("Content-Length", String(object.contentLength));
    return object.stream.pipe(res).on("error", () => {
      if (!res.headersSent) res.status(404).json({ message: "This attachment is no longer stored." });
    });
  } catch (error) {
    return sendError(res, error, "Unable to load this attachment.");
  }
}

module.exports = { list, branches, getOne, duplicates, projects, listTableSettings, saveTableSettings, meetings, scheduleMeeting, removeMeeting, page, ids, columnValues, activity, callLogs, leadTranscripts, transcriptDetail, version, bulkStatus, bulkAssign, importCsv, cancelImportCsv, create, createBulk, update, remove, removeBulk, renameGroup, refresh, ingestCallyzerWebhook, uploadRemarkAttachment, remarkAttachment };
