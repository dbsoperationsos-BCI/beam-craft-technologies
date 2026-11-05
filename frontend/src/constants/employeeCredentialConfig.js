/**
 * The Create Login Credentials form, described as sections for `SchemaFormPanel`.
 *
 * Three questions, in the order they have to be answered: what the person signs in with, what they
 * may then do, and who covers the work when they are away. They stack into one scrolling document,
 * the way every other form in the app reads, and the rail on the left follows the scroll rather than
 * replacing one section with the next.
 *
 * Who the account belongs to is not one of the questions. The name, the employee ID, the department
 * and the branch are all settled long before anyone reaches this form, so they are stated in the
 * summary strip above it — the same way every other panel names the record it is acting on — rather
 * than filling a section with fields nobody may type in.
 *
 * The Alternative pair is recorded against the employee, not the account — cover is a fact about
 * the person and outlives any login they are given.
 *
 * `temporaryPassword` and `roleIds` have no shared input between them; both are drawn by the
 * renderers the panel passes in `context.renderers`, which is what keeps this file a description of
 * the form rather than a second copy of it.
 */

/**
 * The employee the form is acting on, for the strip above the first section.
 *
 * The name and the ID, and nothing else. It carried the department and the branch too, and both had
 * stopped being facts the strip could state: the department is asked on this very page, in
 * Employment Details, so the strip was quoting a value the form below it was about to change - and
 * the branch was derived from a work location that is asked there as well. A summary that disagrees
 * with the field under it is worse than a shorter summary.
 *
 * Both remaining lines are read from the record and neither is asked for anywhere on the page, which
 * is what a strip like this is for: saying which record is being acted on.
 */
export const credentialSummary = (employee) => [
  ["Employee", employee.employeeName],
  ["Employee ID", employee.employeeId],
];

export const credentialSections = [
  {
    id: "credentials",
    title: "Credentials",
    fields: [
      { name: "username", label: "Username", required: true, placeholder: "name.dbs001", helperText: "The sign-in name this person types to log in, like name.dbs001." },
      { name: "email", label: "Login Email", required: true, props: { type: "email" }, placeholder: "name@company.com", helperText: "The email address saved on this login account." },
      { name: "temporaryPassword", label: "Temporary Password", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "roles",
    title: "Roles",
    columns: 1,
    fields: [{ name: "roleIds", label: "Roles", type: "custom" }],
  },
  /*
   * The way out of the WhatsApp rule for one named person.
   *
   * Its own section rather than a field under Roles, because it is not a permission: a role says
   * what somebody *may* do, and this releases them from something they must otherwise have done
   * first. The two are granted and revoked by different people for different reasons, and folding
   * this in with the roles would have it copied along with them the next time a role is duplicated.
   */
  {
    id: "whatsapp",
    title: "WhatsApp",
    columns: 1,
    fields: [{ name: "whatsappAllowed", label: "WhatsApp", type: "custom" }],
  },
  /*
   * Exclude: whether this person is kept out of the Attendance module altogether - not listed, not
   * counted, their days and details not shown there. The employee's, not the account's, so it is
   * saved on the employee with the cover and approvers below.
   */
  {
    id: "exclude",
    title: "Exclude",
    columns: 1,
    fields: [{ name: "excludeFromAttendance", label: "Exclude", type: "custom" }],
  },
  /*
   * Flexible Shift: whether this person may log in at any time on the Flexible Shift work mode - the
   * day judged on its hours alone, never Late or Early exit. The employee's, saved with Exclude above.
   */
  {
    id: "flexibleShift",
    title: "Flexible Shift",
    columns: 1,
    fields: [{ name: "allowFlexibleShift", label: "Flexible Shift", type: "custom" }],
  },
  /*
   * WhatsApp Groups: the studio's groups (Settings -> Employee -> WhatsApp Groups) this person is in,
   * and an Add that puts their mobile number into more of them at once. Not saved with the form - the
   * add happens on its own (`employees/EmployeeWhatsAppGroups`).
   */
  {
    id: "whatsappGroups",
    title: "WhatsApp Groups",
    columns: 1,
    fields: [{ name: "whatsappGroups", label: "WhatsApp Groups", type: "custom" }],
  },
  {
    id: "alternative",
    title: "Alternative",
    fields: [
      // Two named slots rather than a list: there are exactly two, and a slot that says which one
      // it is can be filled in either order and read back without counting. Each slot's menu hides
      // whoever the other slot already names, so the pair cannot hold one person twice.
      {
        name: "alternative1EmployeeId",
        label: "Alternative 1",
        helperText: "The colleague who covers this person's work while they are away.",
        type: "select",
        options: "alternative1Options",
        placeholder: "Select an employee",
        props: { searchable: true },
      },
      {
        name: "alternative2EmployeeId",
        label: "Alternative 2",
        helperText: "A second colleague who can also cover this person's work.",
        type: "select",
        options: "alternative2Options",
        placeholder: "Select an employee",
        props: { searchable: true },
      },
    ],
  },
  {
    id: "leave-approval",
    title: "Leave Approval",
    columns: 1,
    // One ticked list rather than three dropdowns: the approvers are one answer of up to three
    // people, picked in the order their approval is asked for. Drawn by the dialog's renderer.
    fields: [{ name: "leaveApproverIds", label: "Leave Approvers", type: "custom" }],
  },
  {
    id: "permission-approval",
    title: "Permission Approval",
    columns: 1,
    /*
     * One person, and so one dropdown rather than the ticked list above.
     *
      * A permission is an hour or two out of a single day and is settled the same morning it is
     * asked for, so there is nobody to escalate to and no order to ask in - the two things the
     * leave list exists to express. This person - and nobody else - decides a permission; with nobody
     * chosen one cannot be raised. They also stand in for an attendance regularization when no
     * Attendance Regularization Approver is chosen below. A named slot says that on the screen: a
     * reader who sees one box knows one person decides, without counting the ticks.
     *
     * Its own section rather than a second field under Leave Approval, because the rail names what
     * each section decides and this decides a different request.
     *
     * **The placeholder is the answer for leaving it empty**, rather than a "Not set" row at the
     * top of the menu. Empty is not a choice among the colleagues - it is what
     * the field says before anybody is chosen - and a menu that opens on a non-person above the
     * names reads as one of them. So the box states what happens while nothing is in it, and the
     * list holds people and nothing else.
     */
    fields: [{
      name: "permissionApproverEmployeeId",
      label: "Permission Approver",
      helperText: "The one person who decides this employee's permission requests.",
      type: "select",
      options: "permissionApproverOptions",
      placeholder: "Not set - permissions cannot be raised",
      props: { searchable: true },
    }],
  },
  {
    id: "regularization-approval",
    title: "Attendance Regularization Approval",
    columns: 1,
    /*
     * One person, like the Permission Approver above and for the same reason: a regularization is one
     * day's status put right, settled by one person with nobody to escalate to. They - and nobody
     * else - decide this employee's Attendance Regularization requests, and Raise Request names them.
     *
     * Empty is not a dead end: the placeholder says what happens then - the regularization goes to
     * the Permission Approver, who decided every one before this slot existed.
     */
    fields: [{
      name: "regularizationApproverEmployeeId",
      label: "Attendance Regularization Approver",
      helperText: "Decides their attendance regularizations; if empty, the Permission Approver does.",
      type: "select",
      options: "regularizationApproverOptions",
      placeholder: "Not set - regularizations go to the Permission Approver",
      props: { searchable: true },
    }],
  },
];

/**
 * The same page for an account that already exists, as Edit Employee shows it.
 *
 * Only the first section differs, and the rail is unchanged because the ids and titles are the
 * same — Credentials, Roles, Alternative, Leave Approval — so a reader moving between an employee
 * being onboarded and one already taken on meets one page, not two that resemble each other.
 *
 * **What changes is that first section, from three fields to one statement.** Username, email and
 * password are what the person signs in with. Changing an identity belongs to Admin → User
 * Management, which is the one screen that owns accounts; two screens writing it is how the two end
 * up disagreeing about who somebody is, and a password box here would be a second way to take an
 * account over. So they are stated as facts, the way every panel states the record it is acting on,
 * and the sections under them — what the account may *do*, and who covers the person while they are
 * away — stay exactly as editable as they are during onboarding.
 */
export const accountSections = [
  {
    id: "credentials",
    title: "Credentials",
    columns: 1,
    fields: [{ name: "accountIdentity", label: "Account", type: "custom" }],
  },
  ...credentialSections.slice(1),
];
