/**
 * Callyzer's own rules, checked before a request leaves this server.
 *
 * Every one of these is in their documentation with the exact error it produces. Checking here
 * rather than letting their API answer means a mistake is caught in one round trip instead of two,
 * and - more usefully - the message that reaches the CRM says which field was wrong in our words.
 */

const CALL_TYPES = ["Incoming", "Outgoing", "Missed", "Rejected"];
const CALL_METHODS = ["PhoneCall", "WhatsAppCall"];
const CALL_MODES = ["Voice", "Video"];

// Their limit, not ours: "The duration should be less than 180 days."
const MAX_RANGE_SECONDS = 180 * 24 * 60 * 60;

class CallyzerRequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * One of the two date ranges, validated as a pair.
 *
 * `call_*` is when the call happened; `synced_*` is when Callyzer received it. Exactly one pair is
 * required, and a half-given pair is an error rather than a silently ignored filter - a request
 * with only `call_from` would otherwise return every call ever made.
 */
function validateRange(input) {
  const hasCall = input.call_from !== undefined || input.call_to !== undefined;
  const hasSynced = input.synced_from !== undefined || input.synced_to !== undefined;

  if (!hasCall && !hasSynced) {
    throw new CallyzerRequestError(
      "Either 'call_from' and 'call_to' or 'synced_from' and 'synced_to' are mandatory. The duration should be less than 180 days.",
    );
  }

  const pair = hasCall ? ["call_from", "call_to"] : ["synced_from", "synced_to"];
  const [fromKey, toKey] = pair;
  const from = input[fromKey];
  const to = input[toKey];

  if (from === undefined || to === undefined) {
    throw new CallyzerRequestError(
      `'${fromKey}' and '${toKey}' are mandatory. The duration should be less than 180 days.`,
    );
  }
  for (const [key, value] of [[fromKey, from], [toKey, to]]) {
    // Their wording, and their rule: a timestamp must parse and must be positive.
    if (!isPositiveInteger(value)) {
      throw new CallyzerRequestError(`Invalid ${key}. Please pass the timestamp in UNIX format.`);
    }
  }
  if (from >= to) {
    throw new CallyzerRequestError("Invalid date range. 'From' timestamp should be less than 'To' timestamp.");
  }
  if (to - from > MAX_RANGE_SECONDS) {
    throw new CallyzerRequestError("The duration should be less than 180 days.");
  }
  return { [fromKey]: from, [toKey]: to };
}

function validateCallTypes(callTypes) {
  if (callTypes === undefined || callTypes === null) return undefined;
  if (!Array.isArray(callTypes)) {
    throw new CallyzerRequestError("Invalid call_types. Valid call types are Incoming or Outgoing or Missed or Rejected.");
  }
  // "If any parameter has blank or null value then it will be ignored."
  const cleaned = callTypes.map((type) => String(type || "").trim()).filter(Boolean);
  if (!cleaned.length) return undefined;
  for (const type of cleaned) {
    if (!CALL_TYPES.includes(type)) {
      throw new CallyzerRequestError("Invalid call_types. Valid call types are Incoming or Outgoing or Missed or Rejected.");
    }
  }
  return cleaned;
}

/**
 * The duration filters, which are a "between" when both are given.
 *
 * Their rule reads backwards at first glance: `duration_les_than` must be *greater* than
 * `duration_grt_than`, because the pair describes a window - more than X and less than Y.
 */
function validateDurations(input) {
  const out = {};
  for (const key of ["duration_les_than", "duration_grt_than"]) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    if (!Number.isInteger(value) || value < 0) {
      throw new CallyzerRequestError("Value out of range for unsigned long data type.");
    }
    out[key] = value;
  }
  if (out.duration_les_than !== undefined && out.duration_grt_than !== undefined
      && out.duration_les_than <= out.duration_grt_than) {
    throw new CallyzerRequestError(
      "Invalid duration value. The value of 'duration_les_than' should be greater than value of 'duration_grt_than'",
    );
  }
  return out;
}

function validateEnum(value, allowed, field, message) {
  const text = String(value || "").trim();
  if (!text) throw new CallyzerRequestError(message);
  if (!allowed.includes(text)) throw new CallyzerRequestError(message);
  return text;
}

/** `page_size` is capped at 100 on every endpoint except unique-clients, which allows 10,000. */
function validatePaging(input, { maxPageSize = 100 } = {}) {
  const out = {};
  if (input.page_no !== undefined && input.page_no !== null && input.page_no !== "") {
    if (!isPositiveInteger(input.page_no)) {
      throw new CallyzerRequestError("Invalid value. Value should be greater than zero and within range of unsigned integer data type.");
    }
    out.page_no = input.page_no;
  }
  if (input.page_size !== undefined && input.page_size !== null && input.page_size !== "") {
    if (!isPositiveInteger(input.page_size) || input.page_size > maxPageSize) {
      throw new CallyzerRequestError(`Invalid value. The value should be between 1 to ${maxPageSize}`);
    }
    out.page_size = input.page_size;
  }
  return out;
}

function cleanStringArray(values) {
  if (!Array.isArray(values)) return undefined;
  const cleaned = values.map((value) => String(value || "").trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

/**
 * A validated body for any of the report endpoints.
 *
 * `call_method` and `call_mode` are mandatory on every one of them - the configuration change
 * their docs call out - so they are required here rather than defaulted, which would silently
 * report on phone calls when somebody meant WhatsApp calls.
 */
function buildReportBody(input = {}, { paging = false, maxPageSize = 100, durations = true } = {}) {
  const body = {
    ...validateRange(input),
    call_method: validateEnum(input.call_method, CALL_METHODS, "call_method",
      "Invalid call_method. Valid call methods are PhoneCall or WhatsAppCall."),
    call_mode: validateEnum(input.call_mode, CALL_MODES, "call_mode",
      "Invalid call_mode. Valid call modes are Voice or Video."),
  };

  const callTypes = validateCallTypes(input.call_types);
  if (callTypes) body.call_types = callTypes;

  if (durations) Object.assign(body, validateDurations(input));
  if (paging) Object.assign(body, validatePaging(input, { maxPageSize }));

  const empNumbers = cleanStringArray(input.emp_numbers);
  if (empNumbers) body.emp_numbers = empNumbers;
  const empTags = cleanStringArray(input.emp_tags);
  if (empTags) body.emp_tags = empTags;

  if (typeof input.is_exclude_numbers === "boolean") body.is_exclude_numbers = input.is_exclude_numbers;

  return body;
}

module.exports = {
  CALL_TYPES, CALL_METHODS, CALL_MODES, MAX_RANGE_SECONDS,
  CallyzerRequestError, buildReportBody,
  validateRange, validateCallTypes, validateDurations, validatePaging,
};
