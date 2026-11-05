const { optionNames } = require("../../../services/optionLists");
const { BRANCH_NAME_COPIES, VERTICAL_NAME_COPIES } = require("../../../services/nameCopies");
const { BRAND_CODES } = require("../../sales/quotation-brands/defaults");
const { z } = require("zod");

const code = z.string().trim().min(2).max(50).regex(/^[A-Z0-9_-]+$/, "Code must use uppercase letters, numbers, underscores, or hyphens");
const text = z.string().trim().min(2).max(120);
const optionalText = z.string().trim().max(2000).optional().nullable();

/**
 * The key behind the name, minted from the name when the caller does not supply one.
 *
 * Every row here is keyed by a code as well as a name, but the code is a machine key - nobody
 * maintaining the list of designations has an opinion about `PRODUCTION_MANAGER`, and no screen
 * shows it. Three of the four screens that write these rows already derived it on the client and
 * one - the Field Settings editor - did not, so every attempt to add a designation, department,
 * skill or vertical from that screen was refused as a validation error naming a field the screen
 * does not have. Minted here instead, so a caller that sends a name is enough and the next screen
 * cannot forget.
 *
 * A code that is explicitly given still wins, and is still validated: Accounts derives its own from
 * the bank and the branch rather than from the account's display name.
 */
const codeFromName = (name) => String(name || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);

/** A name that is stored inside a comma-joined column (`match: "csv"`), so may not hold a comma itself. */
const noComma = (schema) => schema.refine((value) => !String(value || "").includes(","), "A name here cannot contain a comma.");

const baseSchema = {
  // Optional, minted from `name` by the controller when it is absent. `name` is required on every
  // create schema below, so there is always something to mint it from.
  code: code.optional(),
  name: text,
  description: optionalText,
  isActive: z.boolean().optional(),
};

/**
 * What a studio account can be, stored as the words themselves.
 *
 * This array was the whole answer, and a second copy of it in `accountsConfig.js` drew the picker -
 * so a type added to one was offered by the form and refused here. It is a list the studio maintains
 * now (Settings → Fields → Accounts Manager → Bank Account Types), and this is what a failed or
 * empty read falls back to.
 */
const BANK_ACCOUNT_TYPES = ["Savings", "Current", "Overdraft", "Cash Credit"];

/*
 * Where a list's values actually live, so a delete can refuse to strand them and a rename can carry
 * them with it.
 *
 * These lists are stored on the record as plain *text* - an employee's department is the word
 * "Accounts", not a link to the row - which is what made both faults quiet. Deleting an entry left
 * records naming something no list offered; renaming one left them on the old word. Neither failed,
 * neither was reported.
 *
 * `match: "exact"` is a column holding one answer. `match: "csv"` is a column holding several,
 * comma separated - an employee's skills, the languages they know - which cannot be matched with a
 * plain `contains` without counting "Photo" as a use of "Photography". `label` is how the refusal
 * names the thing using it: "used by 4 employees".
 *
 * A definition with no `usedBy` is not guarded, which is the honest default: nothing here knows
 * where a bank account or an employment type is referenced, and inventing an empty answer would
 * read as "safe to delete" rather than "not checked".
 */
/*
 * `idField` is the reference the employee row keeps beside the text (`services/employeeReferences.js`),
 * so a rename rewrites the text by the reference rather than by matching the old spelling - the same
 * way a branch rename does. The three comma-separated lists have no single reference column; their
 * text is still rewritten entry by entry, and their junction rows need nothing, being ids already.
 */
const EMPLOYEE_REFERENCE_FOR = {
  designation: "designationId", workType: "workTypeId", gender: "genderId", bloodGroup: "bloodGroupId",
  maritalStatus: "maritalStatusId", emergencyContactRelationship: "emergencyContactRelationshipId",
  workBaseLocation: "workBaseLocationId", currentWorkLocation: "currentWorkLocationId", vertical: "verticalId",
};
const usedOnEmployee = (field, match = "exact") => ({
  model: "employee", field, match, label: "employee",
  ...(EMPLOYEE_REFERENCE_FOR[field] ? { idField: EMPLOYEE_REFERENCE_FOR[field], orText: true } : {}),
});
// `where` narrows the rows a use is counted on - here to the leads still on the board. See
// `usage.js`, which spreads it into every count and rename.
const usedOnLead = (field) => ({ model: "salesCrmLead", field, match: "exact", label: "lead", where: { deletedAt: null } });

const definitions = {
  departments: {
    label: "Department", model: "department", orderBy: { name: "asc" },
    usedBy: [usedOnEmployee("department")],
    createSchema: z.object({ ...baseSchema, parentDepartmentId: z.number().int().positive().optional().nullable() }),
    updateSchema: z.object({ ...baseSchema, parentDepartmentId: z.number().int().positive().optional().nullable() }).partial(),
    include: { parentDepartment: { select: { id: true, code: true, name: true } } },
  },
  designations: {
    label: "Designation", model: "designation", orderBy: { name: "asc" },
    // An invite carries the designation the candidate is being taken on for, so it holds one too.
    usedBy: [usedOnEmployee("designation"), { model: "employeeOnboardingInvite", field: "intendedDesignation", match: "exact", label: "onboarding invite" }],
  },
  "employment-types": { label: "Employment type", model: "employmentType", orderBy: { name: "asc" } },
  // Client Details -> Create Onboarding Invite: the client contact's role. An invite holds the one it
  // was sent with, so a rename here follows it there.
  "client-designations": {
    label: "Client designation", model: "clientDesignation", orderBy: { name: "asc" },
    usedBy: [{ model: "clientOnboardingInvite", field: "contactDesignation", match: "exact", label: "client invite" }],
  },
  // The studio's branches. `/api/hrm/locations` answered for this list until the table was renamed
  // and is kept as a read-only alias in routes.js for a caller not yet updated.
  branches: {
    label: "Branch", model: "branch", orderBy: { name: "asc" },
    // The nine business tables that write the branch's name out as text beside `branch_id`, and the
    // employee's two location columns. Declared once, in `services/nameCopies.js`, because the same
    // list is what Settings -> Branches rewrites when a branch is renamed there.
    usedBy: BRANCH_NAME_COPIES,
    createSchema: z.object({ ...baseSchema, address: optionalText }),
    updateSchema: z.object({ ...baseSchema, address: optionalText }).partial(),
  },
  // Several to a record, comma separated, so a use of one is not a use of another that contains it.
  skills: { label: "Skill", model: "skill", orderBy: { name: "asc" }, usedBy: [usedOnEmployee("skills", "csv")] },
  /*
   * **`bank-accounts` was here and is gone.** The studio's accounts are kept in one place now -
   * Settings -> Organization -> Branches, on the branch each one belongs to - because a second list
   * beside it was the same accounts typed twice, by different hands, with nothing to say which was
   * right. The screen that edited this list went with it, and the three money screens that offered
   * it - "received into", on a cash entry, a payment request and a project's advance - read the
   * branch register through `services/branchBankAccounts.js` instead.
   *
   * The `bank_account` table itself is **left alone**, rows and all. Those rows name no branch, so
   * nothing can work out where each one belongs, and dropping them to tidy the schema up would throw
   * away the only record of what the studio had entered. Nothing reads them.
   */
  // Every column holding the vertical's *name* - the employee's, the lead's, the saved group name's
  // and the sales configuration rows - not only the employee's. See `services/nameCopies.js`.
  verticals: { label: "Vertical", model: "vertical", orderBy: { name: "asc" }, usedBy: VERTICAL_NAME_COPIES },
  languages: { label: "Language", model: "language", orderBy: { name: "asc" }, usedBy: [usedOnEmployee("languagesKnown", "csv")] },
  "work-types": { label: "Work type", model: "workType", orderBy: { name: "asc" }, usedBy: [usedOnEmployee("workType")] },
  /*
   * The employee statuses, and which of them mean somebody is working here.
   *
   * `countsAsWorking` is what decides who may be handed an asset, who the CRM lists as a
   * salesperson and who may link a WhatsApp session. It used to be the array
   * ["Active", "in Training", "PIP"] written out in eight separate files, which made this list
   * editable in name only - renaming a status left those four none the wiser. See
   * `services/employeeStatuses.js`, which is what the four now ask.
   */
  "employee-statuses": {
    label: "Employee status", model: "employeeStatus", orderBy: { sortOrder: "asc" },
    usedBy: [usedOnEmployee("employmentStatus")],
    createSchema: z.object({ ...baseSchema, color: z.string().trim().max(20).optional().nullable(), sortOrder: z.number().int().min(0).max(9999).optional(), countsAsWorking: z.boolean().optional() }),
    updateSchema: z.object({ ...baseSchema, color: z.string().trim().max(20).optional().nullable(), sortOrder: z.number().int().min(0).max(9999).optional(), countsAsWorking: z.boolean().optional() }).partial(),
  },
  /*
   * What an employee answers for Marital Status, and which of those answers ask for a spouse.
   *
   * `requiresSpouseDetails` is the same idea as `countsAsWorking` above: the employee form, the
   * onboarding form and the public submission endpoint all asked for a spouse name and a wedding
   * anniversary when the answer was the literal string "Married", so renaming the option - or
   * adding one that also has a spouse - quietly stopped them being asked for.
   */
  "marital-statuses": {
    label: "Marital status", model: "maritalStatus", orderBy: { name: "asc" },
    usedBy: [usedOnEmployee("maritalStatus")],
    createSchema: z.object({ ...baseSchema, requiresSpouseDetails: z.boolean().optional() }),
    updateSchema: z.object({ ...baseSchema, requiresSpouseDetails: z.boolean().optional() }).partial(),
  },
  "emergency-contact-relationships": { label: "Emergency contact relationship", model: "emergencyContactRelationship", orderBy: { name: "asc" }, usedBy: [usedOnEmployee("emergencyContactRelationship")] },
  // One list behind both Work Base Location and Current Work Location, which is how the employee
  // form has always offered them: the branches, plus the answers no branch can give.
  // One list, two columns: where somebody is based and where they are working now.
  "work-locations": { label: "Work location", model: "workLocation", orderBy: { name: "asc" }, usedBy: [usedOnEmployee("workBaseLocation"), usedOnEmployee("currentWorkLocation")] },
  genders: { label: "Gender", model: "gender", orderBy: { name: "asc" }, usedBy: [usedOnEmployee("gender")] },
  /*
   * Relationship and Referred From, suggested on SALES -> CRM -> Add Lead, the lead popup and the
   * Quotation Generator's Client Details, and edited under Field Settings -> Quotation.
   *
   * A lead holds both as columns, so a delete is checked against the leads on the board - and
   * only those: a lead in the trash (`deletedAt`) no longer holds the board's answer, and without
   * the `where` a source used by nothing but deleted leads could never be removed from the list.
   * A quotation keeps its own copy inside its payload, which is not counted: a version already
   * raised prints what it was raised with either way, which is the rule for everything on it.
   */
  "lead-relationships": { label: "Relationship", model: "leadRelationship", orderBy: { name: "asc" }, usedBy: [usedOnLead("relationship")] },
  "referral-sources": { label: "Referral source", model: "referralSource", orderBy: { name: "asc" }, usedBy: [usedOnLead("referredFrom")] },
  /*
   * The Categories a quotation may be raised under, one list per brand.
   *
   * `storedInPayload` rather than `usedBy`: a quotation keeps its client details inside its own JSON
   * payload, so there is no column to count and the in-use check cannot be written. Saying where the
   * value lives, in words, is the exemption the guard is designed for — and it is read out to
   * whoever deletes an entry, so they know what they are deleting it out from under.
   *
   * Unlike the two lists above, this one governs a **closed** dropdown: what is here is what a
   * quotation may say.
   *
   * `scopedBy: "vertical"`: a row is filed under a brand code, a create must say which, and a list
   * read may ask for one brand's rows with `?vertical=`. The resource keeps its original key,
   * `religions`, which the quotation payload also stores the answer under; the screens say Category.
   */
  religions: {
    label: "Category", model: "leadReligion", orderBy: { name: "asc" }, storedInPayload: "the quotation's client details",
    scopedBy: "vertical",
    createSchema: z.object({ ...baseSchema, vertical: z.enum(BRAND_CODES) }),
    updateSchema: z.object({ ...baseSchema, vertical: z.enum(BRAND_CODES) }).partial(),
  },
  /*
   * The Category column on the payment schedule, when a project is booked on Bookings & Converted.
   *
   * `settlesBalance` is the meaning behind "Final Settlement": the row that closes a schedule is
   * pinned to the bottom, cannot be removed, and is what the remaining percentage settles against.
   * That was the literal string compared against in three places.
   *
   * A project's saved schedule (`project_payment_schedule`) keeps the category's id and a copy of
   * its name, so a rename rewrites the copies and a category in use cannot be deleted.
   */
  "payment-schedule-categories": {
    label: "Payment schedule category", model: "paymentScheduleCategory", orderBy: { sortOrder: "asc" },
    /*
     * The one row a schedule cannot do without. `settles_balance` is what pins a row to the bottom
     * and closes the schedule; with no row carrying it the schedule never closes and keeps
     * appending a fresh row forever. The studio may move the flag by renaming the row that has it -
     * it need not be called "Final Settlement" - but it may not remove the last one.
     */
    requiredFlag: { field: "settlesBalance", reason: "closes a payment schedule" },
    usedBy: [{ model: "projectPaymentSchedule", field: "category", match: "exact", label: "scheduled payment", idField: "categoryId", where: { deletedAt: null } }],
    createSchema: z.object({ ...baseSchema, settlesBalance: z.boolean().optional(), repeatable: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, settlesBalance: z.boolean().optional(), repeatable: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  /*
   * How money moved, on an Accounts cash entry and an HRM payment request.
   *
   * The three flags are what each way of moving money asks for - a reference, an account, or a line
   * saying what it actually was. They were three arrays written out twice, once in the browser and
   * once in the controller that validates the entry, so a studio adding a mode of its own got one
   * the form offered and the server refused.
   */
  "payment-modes": {
    label: "Payment mode", model: "paymentMode", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "cashEntry", field: "paymentMode", match: "exact", label: "cash entry" }],
    createSchema: z.object({ ...baseSchema, asksForTransactionId: z.boolean().optional(), asksForAccount: z.boolean().optional(), asksForDetails: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, asksForTransactionId: z.boolean().optional(), asksForAccount: z.boolean().optional(), asksForDetails: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  /*
   * The tier a wedding is booked at. It is put into the WhatsApp group name the generator mints and
   * is not stored anywhere of its own afterwards, so - like the schedule categories - there is no
   * field to count uses in.
   */
  tiers: {
    label: "Tier", model: "tier", orderBy: { sortOrder: "asc" },
    storedInPayload: "the WhatsApp group name it is minted into",
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  // The last two lists the employee form kept as arrays in the browser. Plain words on the
  // record - nothing reads a meaning out of a blood group or a language the way
  // `counts_as_working` is read out of a status - so neither needs a schema of its own.
  // Languages are several to a record and comma separated, so a use of "Tamil" must not be
  // found inside a record that only knows "Tamilnadu-something": `csv`, like skills.
  "blood-groups": { label: "Blood group", model: "bloodGroup", orderBy: { name: "asc" }, usedBy: [usedOnEmployee("bloodGroup")] },

  /* ───────────────── Resource Management ─────────────────
   *
   * The words the studio judges and moves its equipment by. All three were arrays in
   * `formPanelConfig.js`, and two of them - the conditions and the shipment types - were written a
   * second time in `client-storage.controller.js`, where the server validates the same words for a
   * client's hard disk. Assets and Client Storage keep a list each rather than sharing one: they
   * read the same today, but a disk travelling to a client is not judged the way a camera on the
   * shelf is, and the studio asked for the two to be able to part company.
   *
   * A condition reaches an asset record proper when an inspection is recorded, which is a column
   * this can count. A severity and a shipment type are kept in the status log's `form_data`, which
   * is JSON and has nothing to count - hence `storedInPayload`.
   */
  "asset-conditions": {
    label: "Asset condition", model: "assetCondition", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "asset", field: "inspectionCondition", match: "exact", label: "asset inspection" }],
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  "asset-repair-severities": {
    label: "Repair severity", model: "assetRepairSeverity", orderBy: { sortOrder: "asc" },
    storedInPayload: "the asset's status log",
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  "asset-shipment-types": {
    label: "Asset shipment type", model: "assetShipmentType", orderBy: { sortOrder: "asc" },
    storedInPayload: "the asset's status log",
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  "storage-conditions": {
    label: "Storage condition", model: "storageCondition", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "clientStorage", field: "transitCondition", match: "exact", label: "client storage record" }],
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  "storage-shipment-types": {
    label: "Storage shipment type", model: "storageShipmentType", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "clientStorage", field: "shipmentType", match: "exact", label: "client storage record" }],
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  // What a vendor is engaged for. It was an array on the server alone (`vendor-options.js`), served
  // to the form, so the studio could not add the trade it had started hiring for.
  "vendor-types": {
    label: "Vendor type", model: "vendorType", orderBy: { sortOrder: "asc" },
    // Several per vendor, joined by ", " - read entry by entry, so renaming "Editor" rewrites it
    // inside "Photographer, Editor" and deleting it counts that vendor as a use.
    usedBy: [{ model: "vendor", field: "vendorType", match: "csv", label: "vendor" }],
    // No comma in a type's name: the vendor column is split on commas, so "Lights, Sound" would be
    // read back as two types and could never be matched, counted or renamed as one.
    createSchema: z.object({ ...baseSchema, name: noComma(text), sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, name: noComma(text), sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },

  /* ───────────────── Accounts ─────────────────
   *
   * `bank-account-types` is the one that was already half here: the array below this file's own
   * `BANK_ACCOUNT_TYPES` fed the `z.enum` that validates a bank account, and a second copy in
   * `accountsConfig.js` drew the picker. A list now, read by both.
   *
   * `payment-settlements` carries `means_excess`, which is what the literal "Expense Excess" meant:
   * the settlement where the studio spent less than it advanced, so money comes back rather than
   * goes out. Both sides compared against that string.
   */
  "bank-account-types": {
    label: "Bank account type", model: "bankAccountType", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "bankAccount", field: "accountType", match: "exact", label: "bank account" }],
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  "payment-settlements": {
    label: "Settlement", model: "paymentSettlement", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "paymentRequest", field: "settlement", match: "exact", label: "payment request" }],
    requiredFlag: { field: "meansExcess", reason: "means the expense came in under what was advanced" },
    createSchema: z.object({ ...baseSchema, meansExcess: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, meansExcess: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },

  /* ───────────────── Sales & CRM, and HRM ─────────────────
   *
   * `offer-types` is what a lead is being quoted for, asked on Add Lead and again on the Quotation
   * Generator's Client Details - one list, offered under both, like Relationship beside it.
   *
   * `task-types` carries `asks_for_details`, which is what "Other" meant: the kind of work the list
   * does not cover, which then says what it actually was. It was `OTHER_TASK_TYPE` in the browser
   * and again in the tasks service, so renaming it stopped the form asking.
   */
  "offer-types": {
    label: "Offer type", model: "offerType", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "salesCrmLead", field: "offerType", match: "exact", label: "lead" }],
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  "task-types": {
    label: "Task type", model: "taskType", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "hrmTask", field: "taskType", match: "exact", label: "task" }],
    createSchema: z.object({ ...baseSchema, asksForDetails: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, asksForDetails: z.boolean().optional(), sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  /*
   * Where an application came from - Naukri, LinkedIn, Meta Ads, a referral, a walk-in.
   *
   * `sortOrder` because the order is the answer's own: the boards and ad platforms the studio spends
   * on first, and Other last wherever the list ends up. Counted against the candidates still on the
   * register, so deleting a source the studio has used says how many name it rather than stranding
   * them - the same `where` the lead lists use, for the same reason.
   */
  /*
   * The positions the Interview register offers beyond the designation list - "General" and
   * whatever else a studio adds. `usedBy` points at the candidate's own `position` column, so
   * deleting a row says how many candidates applied under that word instead of stranding them.
   */
  "interview-positions": {
    label: "Position", model: "interviewPosition", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "hrmInterviewCandidate", field: "position", match: "exact", label: "candidate", where: { deletedAt: null } }],
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
  "interview-sources": {
    label: "Source", model: "interviewSource", orderBy: { sortOrder: "asc" },
    usedBy: [{ model: "hrmInterviewCandidate", field: "source", match: "exact", label: "candidate", where: { deletedAt: null } }],
    createSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }),
    updateSchema: z.object({ ...baseSchema, sortOrder: z.number().int().min(0).max(9999).optional() }).partial(),
  },
};

for (const definition of Object.values(definitions)) {
  definition.createSchema ??= z.object(baseSchema);
  definition.updateSchema ??= z.object(baseSchema).partial();
}

module.exports = { definitions, BANK_ACCOUNT_TYPES, codeFromName };
