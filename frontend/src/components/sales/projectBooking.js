// The extension is explicit because this module is read directly by the tests, which resolve as
// Node ESM rather than through the bundler.
import { derivedVertical } from "./whatsappGroupNameUtils.js";

/**
 * What booking a project needs to know, shared by the two screens that book one.
 *
 * Bookings & Converted books a project from a CRM lead or from nothing; Quotations books one from
 * the quotation the client agreed to. Both fill the same panel, send the same payload and read the
 * same refusals, so the shape of a booking is stated once here rather than twice in two pages that
 * would drift apart the first time the payload gained a field.
 */

/**
 * The short forms the studio writes a branch as, for text that is not the register's own name.
 *
 * These are for **older records only**. A lead used to store whatever a CSV typed - a bare city, or
 * one of the studio's abbreviations - and the ones written before the branch text was repaired still
 * do. A record filed since then carries the register's own spelling and never reaches this list.
 *
 * Deliberately a short, closed list of things that are not names: a new branch does not belong here,
 * it belongs in the register, and `sourceBranchForCrmBranch` finds it there without an edit.
 */
const CRM_BRANCH_TO_SOURCE_BRANCH = {
  erode: "Erode TN",
  tiruppur: "Tiruppur TN",
  tpr: "Tiruppur TN",
  coimbatore: "Coimbatore TN",
  cbe: "Coimbatore TN",
  bangalore: "Bangalore KA",
  blr: "Bangalore KA",
  hyderabad: "Hyderabad TL",
  hyd: "Hyderabad TL",
  vizag: "Visakhapatnam AP",
  visakhapatnam: "Visakhapatnam AP",
  vskp: "Visakhapatnam AP",
};

// The CRM's three system tables, which are also the generator's group types. A project stores
// the same fact twice - as a group type here and as WED / QQ / CORP in `vertical` - so both are
// filled from this one list.
export const CRM_GROUP_TYPES = ["Dum Dum", "Qua Qua", "Corp"];

/**
 * The branch a CRM record names, as the branch a project names - so Create Project opens on the
 * branch the lead is already filed under instead of on an empty required field.
 *
 * ── Why this stopped working ─────────────────────────────────────────────────────────────────
 *
 * It used to translate a bare city into the register's name - "Erode" into "Erode TN" - because
 * that is what a lead held. Repairing the branch text changed that: a lead now stores the
 * register's own spelling, and every properly filed one arrives here already reading "Erode TN".
 * Looked up in a list of cities that answer is not in, so the function returned "" and a conversion
 * landed on Create Project with Source Branch blank - a required field, on a form with no way to
 * explain itself. The fix that made Assigned Branch right is what made this wrong.
 *
 * A name is handed back as it came, and the short forms above are consulted only for the older
 * records that still hold one. **The register is what decides whether it is real**: Create Project
 * loads the branches and clears anything that is not among them (see `SaleDetailsSection`), so
 * passing text through cannot invent a branch - at worst it lands on the same empty field it landed
 * on before, and at best, which is now the usual case, it lands on the right one.
 *
 * That is also why this does not hold a list of branches of its own. It never needs to know what
 * the studio's branches are; it only needs to stop mistranslating the ones it is handed.
 */
export function sourceBranchForCrmBranch(branch) {
  const text = String(branch || "").trim();
  if (!text) return "";
  return CRM_BRANCH_TO_SOURCE_BRANCH[text.toLowerCase()] || text;
}

/**
 * The fields a rejected save actually objected to.
 *
 * The server answers a schema failure with "Validation failed" and a field-by-field breakdown,
 * and only the first half was ever shown - which named nothing, pointed at nothing, and left the
 * form looking broken. Some of these fields are not on the form at all (a vertical carried over
 * from a converted lead, for one), so the breakdown is the only thing that can explain them.
 */
export function validationDetail(error) {
  const fieldErrors = error?.data?.errors?.fieldErrors;
  if (!fieldErrors) return "";
  const parts = Object.entries(fieldErrors)
    .map(([field, messages]) => `${field}: ${(messages || []).join(", ")}`)
    .filter(Boolean);
  return parts.length ? `Unable to save project. ${parts.join(" · ")}` : "";
}

export function createProjectPayload(project) {
  const remark = (field) => project[field]?.trim() || null;
  return {
    enquiryId: project.enquiryId,
    quotationId: project.quotationId || null,
    whatsappGroupNameId: project.whatsappGroupNameId || null,
    whatsappGroupName: project.whatsappGroupName.trim(),
    clientMainNumber: `${project.countryCode.trim()} ${project.clientMainNumber}`,
    vertical: project.vertical || null,
    sourceBranch: project.sourceBranch,
    salesPreProductionRemarks: remark("salesPreProductionRemarks"),
    salesProductionRemarks: remark("salesProductionRemarks"),
    salesPostProductionRemarks: remark("salesPostProductionRemarks"),
    initialConvertedValue: Number(project.initialConvertedValue),
    groupType: project.groupType || null,
    // Sent only when the conversion supplied one, so a project created from New Project rather
    // than from a lead still lets the server decide. A main shoot marked on the form still wins
    // over this - the server recomputes the date from that shoot - so this only fills the case
    // the conversion covers, where the lead knows the date and no shoot has been added yet.
    //
    // `crmName` is deliberately not sent: the server sets it from the signed-in account, so the
    // CRM on a project is whoever created it rather than anything the browser can claim.
    ...(project.mainEventDate ? { mainEventDate: project.mainEventDate, mainEventDateKnown: true } : {}),
    // Which converted status to leave the lead reading. Sent only when the conversion named one -
    // otherwise the server falls back to "Converted", as it always has for New Project and imports.
    ...(project.crmLeadStatus ? { crmLeadStatus: project.crmLeadStatus } : {}),
    shoots: Array.isArray(project.shoots) ? project.shoots.map(({ clientKey, shootId, id, ...shoot }) => shoot) : [],
  };
}

/**
 * A quotation in the shape `CreateProjectFormPanel` prefills from.
 *
 * The same trick the converted lead uses: the panel already knows how to fill itself from a project
 * record, so a quotation is mapped onto that shape rather than the panel learning a second one.
 *
 * `quotationRowId` is the one field a stored project never carries, and it is what makes this more
 * than a filled-in form: the panel reads that version and brings its shoots, services and
 * deliverables across as the project's plan.
 */
export function quotationToProjectPrefill(quotation) {
  const payload = quotation?.payload || {};
  const crmGroupType = CRM_GROUP_TYPES.find((type) => type === String(payload.vertical || "").trim()) || "";
  return {
    enquiryId: quotation?.enquiryId || "",
    quotationId: quotation?.quotationId || "",
    quotationRowId: quotation?.id || "",
    clientMainNumber: quotation?.clientMainNumber || "",
    sourceBranch: sourceBranchForCrmBranch(quotation?.sourceBranch),
    groupType: crmGroupType,
    vertical: crmGroupType ? derivedVertical(crmGroupType) : "",
    // Whoever followed the quotation up is the CRM on the project it becomes.
    crmName: quotation?.followedBy || "",
    initialConvertedValue: quotation?.amount === null || quotation?.amount === undefined ? "" : String(quotation.amount),
  };
}

/**
 * An existing project in the shape `CreateProjectFormPanel` prefills from, for booking its copy.
 *
 * The third caller of the same trick the converted lead and the quotation use: the panel already
 * knows how to fill itself from a project record, so a duplicate is a project record with the
 * answers that belong to *that* booking taken out, rather than a second way of filling the form.
 *
 * Four fields are blanked, and only the first two were asked for:
 *
 *   - **Enquiry ID** and **Client Main Number** - a duplicate is the same package sold to somebody
 *     else, so the two answers naming who it was sold to are the two the person is there to give.
 *   - **The WhatsApp group name**, with its `whatsappGroupNameId`, because carrying it is not a
 *     preference but a refusal: that id is a generator row the save *claims*, the source project
 *     claimed it already, and a create sending it comes back 409 "Selected WhatsApp group name is
 *     no longer available". The picker offers the names saved against the enquiry, so choosing the
 *     new enquiry is what fills this in - and `groupNameFieldsForEnquiry` would clear a carried-over
 *     name at that moment anyway.
 *
 * `quotationId` is not blanked so much as absent by construction: Duplicate is offered only on a
 * project that converted at no quotation, which is the whole reason the copy has a plan to carry
 * rather than a quotation to re-read.
 *
 * Payment Received needs nothing done to it here. The advance is a cash entry rather than part of
 * the sale, so it never reaches this shape - `CreateProjectFormPanel` holds it in its own state and
 * opens it empty - and a duplicate must not repeat money the source project was paid.
 */
export function projectToDuplicatePrefill(project) {
  return {
    enquiryId: "",
    clientMainNumber: "",
    whatsappGroupNameId: "",
    whatsappGroupName: "",
    quotationId: "",
    quotationRowId: "",
    vertical: project?.vertical || "",
    groupType: project?.groupType || "",
    sourceBranch: project?.sourceBranch || "",
    initialConvertedValue: project?.initialConvertedValue === null || project?.initialConvertedValue === undefined ? "" : String(project.initialConvertedValue),
    // The day the package is built around comes across with the shoots that were planned for it.
    // The new client's dates are theirs to correct, on shoots this form leaves editable.
    mainEventDateKnown: Boolean(project?.mainEventDateKnown),
    mainEventDate: project?.mainEventDate || "",
    salesPreProductionRemarks: project?.salesPreProductionRemarks || "",
    salesProductionRemarks: project?.salesProductionRemarks || "",
    salesPostProductionRemarks: project?.salesPostProductionRemarks || "",
  };
}

/**
 * Whether a project may be duplicated: only one that converted at no quotation.
 *
 * A project sold on a quotation is copied by duplicating that quotation and booking from it, which
 * is a flow that already exists and keeps the copy priced against a quotation of its own. Offering
 * a second way in here would produce a project claiming a quotation raised for another client's
 * enquiry - the number on the record would name a document that says a different name and a
 * different amount.
 */
export function canDuplicateProject(project) {
  return !String(project?.quotationId || "").trim();
}
