/**
 * Money, counted in code.
 *
 * A language model is a poor calculator and a worse one when the numbers matter. It will read
 * "1.5 lakhs" and answer 15,000 as readily as 150,000, and it will do it confidently. Anything the
 * CRM adds up is added up here, in plain arithmetic, and the model is only ever told the result.
 *
 * What the model is good at is finding the figure in a sentence. So it extracts "1.5 lakhs" as
 * text, and this turns that text into a number.
 */

// Indian numbering, which is how a budget is actually said on these calls.
const MULTIPLIERS = [
  [/\b(crores?|cr)\b/i, 10_000_000],
  [/\b(lakhs?|lacs?|lakhs|l)\b/i, 100_000],
  // No leading word boundary: "50k" has none between the digit and the k, and that is how a
  // budget is usually typed. The trailing boundary keeps it from matching the k inside "package".
  [/(?:thousands?|k)\b/i, 1_000],
];

/**
 * A spoken or written amount as a number of rupees.
 *
 * Returns null rather than a guess when there is no figure: a budget nobody stated must stay
 * unstated, and zero would read as "they have no money" rather than "we did not ask".
 */
function parseAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value > 0 ? Math.round(value) : null;
  const text = String(value || "").trim();
  if (!text) return null;

  /*
   * Commas are removed rather than replaced with a space: "₹1,50,000" is one number, and turning
   * it into "1 50 000" made the parser read the first group and answer 1.
   */
  const cleaned = text.replace(/,/g, "").replace(/₹/g, " ").replace(/\brs\.?\b/gi, " ").trim();
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const base = Number(match[1]);
  if (!Number.isFinite(base) || base <= 0) return null;

  for (const [pattern, multiplier] of MULTIPLIERS) {
    if (pattern.test(cleaned)) return Math.round(base * multiplier);
  }
  return Math.round(base);
}

/** The same amount written the way the CRM writes it. */
function formatAmount(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

/**
 * What a lead is worth, from the figures already on it.
 *
 * Every number here comes from the CRM's own columns, never from the model. The model may say a
 * client mentioned two lakhs; this reports what the lead actually records, and the two are shown
 * side by side rather than merged.
 */
function leadValue({ preferredBudget, expectedBudget, projects = [] } = {}) {
  const preferred = parseAmount(preferredBudget);
  const expected = parseAmount(expectedBudget);
  const converted = projects
    .map((project) => parseAmount(project?.initialConvertedValue))
    .filter((value) => value !== null);

  const convertedTotal = converted.reduce((sum, value) => sum + value, 0);
  return {
    preferredBudget: preferred,
    expectedBudget: expected,
    convertedCount: converted.length,
    convertedTotal: convertedTotal || null,
    // Plain division, done here rather than asked for.
    convertedAverage: converted.length ? Math.round(convertedTotal / converted.length) : null,
    formatted: {
      preferredBudget: formatAmount(preferred),
      expectedBudget: formatAmount(expected),
      convertedTotal: formatAmount(convertedTotal),
      convertedAverage: converted.length ? formatAmount(Math.round(convertedTotal / converted.length)) : "",
    },
  };
}

/** Whole days between two dates, for "no contact in 12 days" - counted, not estimated. */
function daysBetween(from, to = new Date()) {
  const start = from instanceof Date ? from : new Date(from);
  const end = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000);
}

module.exports = { parseAmount, formatAmount, leadValue, daysBetween };
