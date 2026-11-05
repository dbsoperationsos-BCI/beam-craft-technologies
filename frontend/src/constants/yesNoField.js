/**
 * A yes/no question on a schema form, drawn as a **Yes / No radio pair** rather than a switch.
 *
 * A switch shows one answer and hides the other, and a question nobody has answered yet looks exactly
 * like one answered No. On a checklist - "was it labelled?", "was the footage backed up?", "did the team
 * reach?" - that is the one distinction that matters, because the record is read later by somebody
 * deciding whether the work was done. The pair shows both words, and shows neither picked until
 * somebody picks one.
 *
 * **The values stay booleans.** The columns behind these questions are booleans and the API validates
 * them as booleans, so a pair whose values were the strings "Yes" and "No" would be a change of
 * appearance that quietly rewrote the record.
 *
 * It began in the pre production field list, that being the form which needed it first, and moved here
 * when Client Storage asked the same question of its seven checks: one shape for one kind of question,
 * rather than each form deciding again what a yes/no looks like.
 */
export const YES_NO_OPTIONS = [{ value: true, label: "Yes" }, { value: false, label: "No" }];

/**
 * `extra` is merged last, so a caller can mark one required, give it a `colSpan`, or disable a reading
 * that is drawn as a pair but answered elsewhere.
 */
export const yesNoField = (name, label, extra = {}) => ({
  name,
  label,
  type: "radio",
  options: YES_NO_OPTIONS,
  // Sized to the text boxes beside it: its label type and its height, so a row of questions and a row
  // of boxes line up. See `RadioGroupField`.
  props: { variant: "field" },
  ...extra,
});

/** Whether a field description is one of these questions. */
const isYesNo = (field) => field?.type === "radio" && field.options === YES_NO_OPTIONS;

/**
 * The values to save, with every **unanswered** yes/no left out.
 *
 * This is the half of the change from a switch to a pair that is not about appearance. A switch has no
 * unanswered state: `emptyValues` coerced it with `Boolean(...)`, so a question nobody had looked at went
 * to the server as `false` - a valid boolean, and a claim that the check had been made and had failed. A
 * pair can be genuinely unanswered, which is the point; but the columns behind these questions are
 * `z.boolean().optional()`, so the way to say "not answered" is to **omit the key**. Sending the empty
 * string the form holds would have the server refuse the whole save.
 *
 * `false` is left alone: it is an answer, and a different one.
 */
export function dropUnansweredYesNo(sections, values) {
  const unanswered = new Set((sections || [])
    .flatMap((section) => section?.fields || [])
    .filter((field) => isYesNo(field) && values?.[field.name] !== true && values?.[field.name] !== false)
    .map((field) => field.name));
  if (!unanswered.size) return values;
  return Object.fromEntries(Object.entries(values || {}).filter(([key]) => !unanswered.has(key)));
}

/**
 * The yes/no questions on these sections that hold no answer, set to No - for a form whose questions
 * start on No rather than unanswered (Pre Production). Only the empty ones: an answer already given
 * is left as it is.
 */
export function yesNoDefaultsToNo(sections, values) {
  return Object.fromEntries((sections || [])
    .flatMap((section) => section?.fields || [])
    .filter((field) => isYesNo(field) && values?.[field.name] !== true && values?.[field.name] !== false)
    .map((field) => [field.name, false]));
}
