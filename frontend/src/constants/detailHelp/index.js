import sales from "./sales.js";
import project from "./project.js";
import hrm from "./hrm.js";
import people from "./people.js";
import accounts from "./accounts.js";
import misc from "./misc.js";

/**
 * What each field on a details screen means, for somebody new to it - shown as the ⓘ beside the
 * label wherever `RecordDetails` draws a record (every table's info panel and View dialog).
 *
 * Keyed by the field's key (`enquiryId`), or by `"<Section title>.<key>"` where the same key means
 * something different in one section. One file per area so they are written and read separately.
 */
const HELP = { ...misc, ...people, ...accounts, ...hrm, ...project, ...sales };

/**
 * The help for one field of a section, or "" when it has none.
 *
 * A Shoot Completion Feedback's field carries the shoot's own id (`SHOOT_COMPLETION.<shoot>.review`,
 * `lib/feedbackRecord.mjs`), which no help can name ahead of time, so it is looked up without it.
 */
export function detailHelpFor(sectionTitle, key) {
  const general = String(key).replace(/^SHOOT_COMPLETION\.[^.]+\./, "SHOOT_COMPLETION.");
  return HELP[`${sectionTitle}.${key}`] || HELP[key] || HELP[general] || "";
}

export default HELP;
