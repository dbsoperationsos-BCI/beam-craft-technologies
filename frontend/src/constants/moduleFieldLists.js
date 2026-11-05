/**
 * Every option list Settings → Fields can edit, and which screens each one takes effect on.
 *
 * Settings → Fields asks three questions — which module, then which of its screens, then which of
 * that screen's fields — and only the third is answered here. The first two are the sidebar's own,
 * read straight from `navigation.mjs`: a module or a screen added to the hamburger appears in those
 * two pickers with nothing added to this file, which is the point of not writing them down twice.
 *
 * So a list says where it is *used*, and the picker is assembled from that:
 *
 *     screens: ["leads-followups", "quotations"]
 *
 * Those are `navigation.mjs` item ids. This file names them as plain strings rather than importing
 * the registry, because it stays data with no imports — `test/field-settings-list.test.mjs` and the
 * backend's `master-data-in-use.test.js` both read it directly, and one of them from the other
 * package. `field-settings-list.test.mjs` holds every id here to the registry, so a screen renamed
 * or removed there cannot leave a list stranded under a screen that no longer exists.
 *
 * ── A list can name more than one screen, and several do ──────────────────────────────────────
 *
 * Relationship and Referred From are asked for on CRM → Add Lead *and* on the Quotation Generator's
 * Client Details; the payment schedule's Category is on Bookings & Converted *and* on Projects;
 * Payment Mode is on Accounts Manager *and* on a project's payments. It is one list either way -
 * the same rows, the same endpoint - so it is offered under each screen it actually affects rather
 * than filed under one of them and hunted for from the other. Editing it from either place is the
 * same edit.
 *
 * ── What each field means ────────────────────────────────────────────────────────────────────
 *
 * `value`     The HRM master-data resource (`/api/hrm/<value>`), so picking one shows the rows that
 *             are already in it and a designation added here is the designation the employee form
 *             offers. There is no second store and nothing to keep in step.
 * `label`     The plural, as the picker and the list header say it.
 * `singular`  What the Add box and every message about one entry are worded from - "Add
 *             Designation", "Unable to add that designation" - so a new list arrives worded rather
 *             than described as its own plural.
 * `screens`   The `navigation.mjs` item ids this list is offered under. At least one.
 * `editor`    A list drawn by something other than the standard editor. Only the quotation's shoot
 *             types, which live on the brand and need a tab each.
 * `behaviours` Meaning carried on the row rather than in its spelling, so the studio can rename an
 *             entry without breaking what it does. The name `HrmOptionListEditor` takes.
 */
export const FIELD_LISTS = [
  // ── Human Resource Management → Employee Repository ──
  // Every answer an employee record is described with. The public onboarding form offers the same
  // lists, carried to it with the invite, but that page is not a sidebar screen and has no entry.
  { value: "designations", label: "Designations", singular: "Designation", screens: ["employee-repository"] },
  { value: "departments", label: "Departments", singular: "Department", screens: ["employee-repository"] },
  { value: "verticals", label: "Verticals", singular: "Vertical", screens: ["employee-repository"] },
  { value: "skills", label: "Skills", singular: "Skill", screens: ["employee-repository"] },
  { value: "work-types", label: "Work Types", singular: "Work Type", screens: ["employee-repository"] },
  { value: "genders", label: "Genders", singular: "Gender", screens: ["employee-repository"] },
  { value: "marital-statuses", label: "Marital Statuses", singular: "Marital Status", screens: ["employee-repository"] },
  { value: "emergency-contact-relationships", label: "Emergency Contact Relationships", singular: "Emergency Contact Relationship", screens: ["employee-repository"] },
  // One list behind both Work Base Location and Current Work Location, which is how the employee
  // form has always offered them: the branches, plus the answers no branch can give.
  { value: "work-locations", label: "Work Locations", singular: "Work Location", screens: ["employee-repository"] },
  { value: "employee-statuses", label: "Employee Statuses", singular: "Employee Status", screens: ["employee-repository"] },
  { value: "blood-groups", label: "Blood Groups", singular: "Blood Group", screens: ["employee-repository"] },
  { value: "languages", label: "Languages", singular: "Language", screens: ["employee-repository"] },
  // The client contact's role on HRM → Client Details' Create Onboarding Invite.
  { value: "client-designations", label: "Client Designations", singular: "Client Designation", screens: ["employee-repository"] },

  // ── Sales & CRM ──
  /*
   * Relationship and Referred From, on Add Lead and on the quotation's Client Details. Typed with
   * suggestions on both: the list is offered so the common answers are spelled one way, and an
   * answer not on it can still be typed.
   */
  { value: "lead-relationships", label: "Relationships", singular: "Relationship", screens: ["leads-followups", "quotations"] },
  { value: "referral-sources", label: "Referral Sources", singular: "Referral Source", screens: ["leads-followups", "quotations"] },
  /*
   * Category, on every quotation's Client Details. `quotations` alone rather than the lead screen
   * too: the CRM does not ask for it, and offering the list where nothing reads it is a setting
   * that appears to do something and does not.
   *
   * `scopedBy: "vertical"` - one list per brand, Dum Dum's not being Qua Qua's, so Field Settings
   * draws a tab per brand over the standard editor and every row is filed under the tab it was
   * typed in. The resource is still `religions`, its original name, which nothing on screen shows.
   */
  { value: "religions", label: "Categories", singular: "Category", screens: ["quotations"], scopedBy: "vertical" },
  /*
   * The shoots each brand quotes for. Not an HRM master-data resource at all - a brand's shoots
   * live on the brand - so `editor` names the component that draws it, because the answer is per
   * brand and Dum Dum's is not Qua Qua's.
   */
  { value: "shoot-types", label: "Shoot Types", singular: "Shoot Type", screens: ["quotations"], editor: "quotation-shoot-types" },
  // The Tier a Dum Dum group is booked at, minted into the W/A group name on Bookings & Converted.
  { value: "tiers", label: "Tiers", singular: "Tier", screens: ["bookings-converted"] },
  {
    value: "payment-schedule-categories", label: "Payment Schedule Categories", singular: "Payment Schedule Category",
    // The schedule is filled in when a project is booked on Bookings & Converted and again when it
    // is started or edited under Projects.
    screens: ["bookings-converted", "projects"],
    // No `behaviours` here by request: Settings → Fields no longer asks "Which category closes a
    // schedule?" or "Which can a schedule hold more than one of?" on this list. The `settlesBalance`
    // and `repeatable` flags this used to let the studio set are untouched on the existing rows and
    // still drive SchedulePaymentSection.js exactly as before - this only removes the two questions
    // from this screen, not the columns or the rule they carry.
  },

  // ── Accounts ──
  {
    value: "payment-modes", label: "Payment Modes", singular: "Payment Mode",
    // The cash entry form, which is Accounts Manager's and is also opened against a project.
    screens: ["accounts-manager", "projects"],
    // No `behaviours` here by request: Settings → Fields no longer asks which modes ask for a
    // reference, which account, or what the payment was. `asksForTransactionId`, `asksForAccount`
    // and `asksForDetails` are untouched on the existing rows and still drive the cash entry form
    // (both the browser's and the controller's) exactly as before - only the three questions are
    // gone from this screen, not the columns or the rule they carry.
  },

  // ── Resource Management → Assets ──
  // The words the studio judges and moves its equipment by. All three were arrays in
  // `formPanelConfig.js`; Conditions and Shipment Types were written a second time on the server
  // for Client Storage, which is why those two are a list each rather than one shared - the studio
  // asked for Assets and Client Storage to be able to part company.
  { value: "asset-conditions", label: "Asset Conditions", singular: "Asset Condition", screens: ["assets"] },
  { value: "asset-repair-severities", label: "Repair Severities", singular: "Repair Severity", screens: ["assets"] },
  { value: "asset-shipment-types", label: "Asset Shipment Types", singular: "Asset Shipment Type", screens: ["assets"] },

  // ── Resource Management → Client Storage ──
  // Its own conditions and shipment types, by the studio's choice. See the note above.
  { value: "storage-conditions", label: "Storage Conditions", singular: "Storage Condition", screens: ["client-storage"] },
  { value: "storage-shipment-types", label: "Storage Shipment Types", singular: "Storage Shipment Type", screens: ["client-storage"] },

  // ── Resource Management → Vendors ──
  // What a vendor is engaged for. It was an array on the server alone, served to the form, so a
  // studio that started hiring a trade it had not hired before could not say so.
  { value: "vendor-types", label: "Vendor Types", singular: "Vendor Type", screens: ["vendors"] },

  // ── Accounts → Accounts Manager ──
  // Written out twice: once in `accountsConfig.js` for the picker and once as the `z.enum` that
  // validates a bank account, so the two could disagree about what an account may be.
  { value: "bank-account-types", label: "Bank Account Types", singular: "Bank Account Type", screens: ["accounts-manager"] },

  // ── Accounts → Payment Requests ──
  {
    value: "payment-settlements", label: "Settlements", singular: "Settlement", screens: ["payment-requests"],
    /*
     * `means_excess` is what the literal "Expense Excess" meant - the settlement where the studio
     * spent less than it advanced, so the money comes back rather than goes out. It was compared
     * against that exact string on both sides, so renaming it stopped the sum working.
     *
     * One answer, not a tick per row: a request settles one way or the other, and the row that means
     * "money comes back" is the only one that may.
     */
    behaviours: [
      {
        field: "meansExcess", mode: "one",
        question: "Which settlement means money comes back?",
        summary: "means the money comes back",
        hint: "The studio spent less than it advanced, so the difference is returned rather than paid out.",
      },
    ],
  },

  // ── Sales & CRM → Leads & Followups, Quotations ──
  // One list, offered under both, like Relationship beside it: Add Lead asks what the enquiry is
  // for, and the Quotation Generator's Client Details asks the same thing again.
  { value: "offer-types", label: "Offer Types", singular: "Offer Type", screens: ["leads-followups", "quotations"] },

  // ── HRM → Tasks ──
  {
    value: "task-types", label: "Task Types", singular: "Task Type", screens: ["tasks"],
    /*
     * `asks_for_details` is what "Other" meant - the kind of work the list does not cover, which
     * then says what it actually was. It was `OTHER_TASK_TYPE` in the browser and again in the
     * tasks service, so renaming it stopped the form asking and the server accepting.
     *
     * `many`, because a studio may well name more than one way out.
     */
    behaviours: [
      {
        field: "asksForDetails", mode: "many",
        question: "Which types ask what the work was?",
        summary: "ask what the work was",
        hint: "The way out for anything the named types do not cover - it then says what it actually was.",
      },
    ],
  },

  // ── HRM → Interview ──
  /*
   * Where an application came from - Naukri, LinkedIn, Meta Ads, a referral, a walk-in.
   *
   * It was an array in `hrm/interview/candidates.js` and a second copy of the same array in
   * `constants/interviewConfig.js`, so a studio that started advertising somewhere new could not
   * say so and the two copies could disagree about what the picker offered. One list now, read by
   * Add Application, Bulk Entry and the candidate's record through the module's options endpoint.
   *
   * The two sources the *application* writes for itself - "Application Form" and "Google sheet
   * integration" - are deliberately not in it: they are what the public form and the sheet importer
   * stamp on a candidate and compare against, so renaming a row here cannot change what an importer
   * writes.
   */
  { value: "interview-sources", label: "Sources", singular: "Source", screens: ["interview"] },
  /*
   * Positions the register offers **beyond** the designation list, which Position Applied For reads
   * first. A role the studio employs somebody as belongs in Designations, where an employee record
   * reads it too; this list is for a position nobody is ever employed as - "General", the answer to
   * a hiring ad that names no role - because a row in Designations is also a row in every
   * employee's designation picker. The options endpoint merges the two.
   */
  { value: "interview-positions", label: "Positions", singular: "Position", screens: ["interview"] },
];

/**
 * The lists one screen offers, in the order they are written above.
 *
 * A screen nobody has given a list to answers with an empty array, which is not a failure: most
 * screens have no editable answers, and the picker says so rather than hiding the screen. Hiding it
 * would mean the Screen dropdown disagreed with the hamburger about what the application has.
 */
export function fieldListsForScreen(screenId) {
  return screenId ? FIELD_LISTS.filter((item) => item.screens.includes(screenId)) : [];
}

/** Every screen id any list names, for the test that holds them to the sidebar registry. */
export const FIELD_LIST_SCREEN_IDS = [...new Set(FIELD_LISTS.flatMap((item) => item.screens))];
