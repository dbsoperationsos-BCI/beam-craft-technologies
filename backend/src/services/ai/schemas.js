/**
 * The shapes an AI answer must arrive in, and the checking that makes sure it did.
 *
 * A model constrained to a schema still returns the wrong thing sometimes - a string where a list
 * belongs, a sentiment it invented, a budget of "unknown". Everything below is validated after the
 * fact and coerced into the documented shape, because the CRM renders it and a missing field there
 * is a crash rather than a gap.
 *
 * The rule throughout: never invent. A field the call did not mention comes back null, and null is
 * what the panel shows.
 */

const INTENT = ["low", "medium", "high"];
const SENTIMENT = ["negative", "neutral", "positive"];

/** The lead-analysis contract, as the API documents it. */
const LEAD_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    leadIntent: { type: "string", enum: INTENT },
    sentiment: { type: "string", enum: SENTIMENT },
    issues: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } },
    nextAction: { type: "string" },
    followUpRequired: { type: "boolean" },
    followUpSuggestion: { type: "string" },
    budget: { type: ["string", "null"] },
    requirements: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "leadIntent", "sentiment", "nextAction", "followUpRequired"],
};

const CALL_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sentiment: { type: "string", enum: SENTIMENT },
    leadIntent: { type: "string", enum: INTENT },
    callOutcome: { type: "string" },
    nextAction: { type: ["string", "null"] },
    requirements: { type: "array", items: { type: "string" } },
    actionItems: { type: "array", items: { type: "string" } },
    budget: { type: ["string", "null"] },
    eventType: { type: ["string", "null"] },
    eventDate: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    followUpDate: { type: ["string", "null"] },
    suggestedStatus: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["summary", "sentiment", "callOutcome", "confidence"],
};

function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

/** A value the model was told to leave null. Empty strings and its favourite evasions count as null. */
function nullable(value) {
  const out = text(value);
  if (!out) return null;
  return ["null", "none", "n/a", "na", "unknown", "not mentioned", "not specified"].includes(out.toLowerCase())
    ? null
    : out;
}

function list(value, limit = 12) {
  if (!Array.isArray(value)) {
    // Models sometimes answer a list as one sentence. One item is better than none.
    const single = nullable(value);
    return single ? [single] : [];
  }
  return value.map((item) => text(item)).filter(Boolean).slice(0, limit);
}

function oneOf(value, allowed, fallback) {
  const out = text(value).toLowerCase();
  return allowed.includes(out) ? out : fallback;
}

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["true", "yes", "1"].includes(text(value).toLowerCase());
}

/**
 * A lead analysis, in the documented shape whatever the model returned.
 *
 * Throws only when there is nothing usable at all - an answer with no summary is not an analysis,
 * and rendering an empty card would be worse than saying the analysis failed.
 */
function validateLeadAnalysis(raw) {
  if (!raw || typeof raw !== "object") throw new Error("The AI returned no analysis.");
  const summary = text(raw.summary);
  if (!summary) throw new Error("The AI analysis had no summary.");
  return {
    summary,
    leadIntent: oneOf(raw.leadIntent, INTENT, "medium"),
    sentiment: oneOf(raw.sentiment, SENTIMENT, "neutral"),
    issues: list(raw.issues),
    suggestions: list(raw.suggestions),
    nextAction: text(raw.nextAction),
    followUpRequired: bool(raw.followUpRequired),
    followUpSuggestion: text(raw.followUpSuggestion),
    budget: nullable(raw.budget),
    requirements: list(raw.requirements),
    actionItems: list(raw.actionItems),
  };
}

function validateCallAnalysis(raw) {
  if (!raw || typeof raw !== "object") throw new Error("The AI returned no analysis.");
  const summary = text(raw.summary);
  if (!summary) throw new Error("The AI analysis had no summary.");
  return {
    summary,
    sentiment: oneOf(raw.sentiment, SENTIMENT, "neutral"),
    leadIntent: oneOf(raw.leadIntent, INTENT, "medium"),
    callOutcome: text(raw.callOutcome),
    nextAction: nullable(raw.nextAction),
    requirements: list(raw.requirements),
    actionItems: list(raw.actionItems),
    budget: nullable(raw.budget),
    eventType: nullable(raw.eventType),
    eventDate: nullable(raw.eventDate),
    location: nullable(raw.location),
    followUpDate: nullable(raw.followUpDate),
    suggestedStatus: nullable(raw.suggestedStatus),
    confidence: oneOf(raw.confidence, ["low", "medium", "high"], "low"),
  };
}

module.exports = {
  INTENT, SENTIMENT,
  LEAD_ANALYSIS_SCHEMA, CALL_ANALYSIS_SCHEMA,
  validateLeadAnalysis, validateCallAnalysis,
  nullable, list, oneOf, bool, text,
};
