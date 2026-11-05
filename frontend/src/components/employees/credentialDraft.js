/**
 * The Login Credentials page as data: what it proposes, what it holds, and what it is stored as.
 *
 * Apart from the hook because it is the half with rules rather than state, and because those rules
 * decide something the screen cannot show its own working for: whether this page has unsaved work.
 * The page compares what is on it against what is on the server, and both sides of that comparison
 * are built here — so if the two ever disagreed about what "unchanged" means, either the × would
 * throw work away without asking or a page nobody touched would refuse to close quietly.
 *
 * Relative import rather than the `@/` alias: these are read directly by the tests, which resolve
 * as plain Node ESM.
 */
import { loginEmail, loginUsername } from "../../lib/employeeName.mjs";

/** The fields the record proposes an answer for; everything else is only ever typed. */
const PROPOSED_FIELDS = ["username", "email", "alternative1EmployeeId", "alternative2EmployeeId", "leaveApproverIds", "permissionApproverEmployeeId", "regularizationApproverEmployeeId"];

/**
 * What the account is proposed as, from the record it belongs to.
 *
 * Both are suggestions in editable fields, and both are recomputed rather than typed:
 *
 *   - the username is the name in the order it is written, joined by dots — `john.smith`,
 *     `dhanush.m.m`; see `loginUsername`. The employee id used to be tacked on the end, which made
 *     every username unique by construction. The studio signs in by name, so it is gone, and two
 *     people sharing a name now collide — the API refuses the second with "A user already exists
 *     with this username" and this field is editable, so it is noticed and changed rather than
 *     silently wrong.
 *   - the email is built from the same name, at the studio's own domain — `john.smi@its-domain`;
 *     see `loginEmail`, and `loginEmailDomain` for where that domain comes from.
 *     It used to be the employee's Work Email ID, typed on this page and filed back onto the
 *     record, which made a studio sign-in depend on somebody typing a studio address correctly
 *     and on there being one at all. An address the studio issues is not a fact about the person
 *     to be collected; it follows from their name, and this is where it is worked out.
 *
 * Lifted out of the hook so one rule both fills the fields and decides what "unchanged" means: a
 * baseline computed any other way would disagree with the form the moment a proposal changed, and
 * the page would open offering to save itself.
 */
function proposalsFor(record, domain) {
  return {
    username: loginUsername(record?.employeeName),
    email: loginEmail(record?.employeeName, domain),
    // Cover and leave approval are read off the record for the same reason, and were blank for the
    // same one: an employee part-way through onboarding may already carry them.
    alternative1EmployeeId: record?.alternative1EmployeeId ? String(record.alternative1EmployeeId) : "",
    alternative2EmployeeId: record?.alternative2EmployeeId ? String(record.alternative2EmployeeId) : "",
    leaveApproverIds: [record?.leaveApprover1EmployeeId, record?.leaveApprover2EmployeeId, record?.leaveApprover3EmployeeId].filter(Boolean).map(String),
    permissionApproverEmployeeId: record?.permissionApproverEmployeeId ? String(record.permissionApproverEmployeeId) : "",
    regularizationApproverEmployeeId: record?.regularizationApproverEmployeeId ? String(record.regularizationApproverEmployeeId) : "",
  };
}

/**
 * The form as it reads on screen: what was answered, and the record's proposal everywhere else.
 *
 * `domain` is what Settings → Global → Login Credential Name holds; left out, the proposal falls
 * back to the domain `loginEmailDomain` ships with. The caller passes the *same* domain to every
 * call it makes here, including the one that fixes what "unchanged" means — two calls disagreeing
 * about the domain is a page that opens offering to save itself.
 */
export function mergeProposals(record, values, touched, domain) {
  const suggestion = proposalsFor(record, domain);
  const merged = { ...values };
  for (const field of PROPOSED_FIELDS) {
    if (!touched[field] && suggestion[field] && !(Array.isArray(suggestion[field]) && !suggestion[field].length)) merged[field] = suggestion[field];
  }
  return merged;
}

/**
 * The ten answers this page holds, in the shape the draft is stored as.
 *
 * Ids are strings on the form and numbers in the record, so everything is written as the string the
 * form uses and read back the same way — a draft that round-tripped `3` into `"3"` would read as an
 * edit the moment it was loaded, and the page would open offering to save itself.
 */
export function draftFrom(values) {
  return {
    username: values.username || "",
    email: values.email || "",
    temporaryPassword: values.temporaryPassword || "",
    branchId: values.branchId ? String(values.branchId) : "",
    roleIds: [...(values.roleIds || [])],
    whatsappAllowed: values.whatsappAllowed === true,
    excludeFromAttendance: values.excludeFromAttendance === true,
    allowFlexibleShift: values.allowFlexibleShift === true,
    alternative1EmployeeId: values.alternative1EmployeeId ? String(values.alternative1EmployeeId) : "",
    alternative2EmployeeId: values.alternative2EmployeeId ? String(values.alternative2EmployeeId) : "",
    leaveApproverIds: (values.leaveApproverIds || []).map(String),
    permissionApproverEmployeeId: values.permissionApproverEmployeeId ? String(values.permissionApproverEmployeeId) : "",
    regularizationApproverEmployeeId: values.regularizationApproverEmployeeId ? String(values.regularizationApproverEmployeeId) : "",
  };
}

/** Which fields a saved draft answers, so its values win over the record's proposals. */
export const touchedByDraft = (draft) => Object.fromEntries(PROPOSED_FIELDS.filter((field) => field in (draft || {})).map((field) => [field, true]));

