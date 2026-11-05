/**
 * Details-screen help for people fields - see `index.js`.
 *
 * Every key is written as "<Section title>.<key>": the employee, invite, role and user panels share
 * key names (employeeName, designation, skills, branchNames...) with other modules where they mean
 * something else, and a bare key here would leak into those screens.
 */
const HELP = {
  // ── Employee repository: an employee row (`employeeInfoSections`) ──
  "Employee information.employeeId": "The studio's own code for this person, such as DBS-12, given automatically when the record is first saved.",
  "Employee information.employeeName": "The person's full name, built from the first and last name typed on their employee record.",
  "Employee information.employmentStatus": "Where this person stands with the studio, such as Active, PIP, Long Leave, Relieved or HR Onboarding Pending; it decides their tab.",
  "Employee information.contactNumber": "The employee's own mobile number, where the studio calls or messages them.",
  "Employee information.emailId": "The employee's personal email address, given on their onboarding form; not their login email.",
  "Employee information.dateOfJoining": "Their first working day at the studio; the first salary review is set six months from it.",
  "Employee information.dateOfRelieving": "Their last day at the studio: set when their offboarding is recorded, so somebody serving notice shows the day it ends. Blank while nobody has recorded one.",

  "Role.designation": "Their job title at the studio, picked from the designations list kept in Settings.",
  "Role.department": "The teams they work in, such as Production or Post Production; one person can be in several.",
  "Role.skills": "The work they can do, such as photography, editing or album designing, ticked on their record.",
  "Role.vertical": "The studio brand or team they work under, such as Dum Dum, Qua Qua, Corp or Team 33.",
  "Role.workBaseLocation": "The office they were hired for and normally belong to.",
  "Role.currentWorkLocation": "Where they are working at present, which can differ from their base office.",
  "Role.photoShooter": "Whether this person is marked as somebody who shoots photos; the current employee form does not ask it.",
  "Role.workType": "How they work with the studio: full time, part time, trainee or intern.",
  "Role.languagesKnown": "The languages they can speak with clients and the team, ticked on their record.",

  "Personal.bloodGroup": "Their blood group, kept on record in case of a medical emergency.",
  "Personal.fatherName": "Their father's full name, as given on the onboarding form.",
  "Personal.motherName": "Their mother's full name, as given on the onboarding form.",
  "Personal.dateOfBirth": "Their date of birth as on their ID; the studio takes nobody under eighteen.",
  "Personal.maritalStatus": "Single, married and so on; when married, the spouse, anniversary and children are asked too.",
  "Personal.weddingAnniversary": "Their wedding date, filled in only for a married employee.",
  "Personal.currentAddress": "Where they live now, with door number, street, city and PIN code.",
  "Personal.permanentAddress": "Their home address as on their ID; the same as the current address when they ticked so.",

  "Qualification & Experience.qualificationSummary": "Their education in one line - each degree or course, the college and the year passed. The full list is on the edit form.",
  "Qualification & Experience.experienceSummary": "The companies they worked at before, in one line. The full list, with any relieving letters, is on the edit form.",

  "Emergency Contact.emergencyContactName": "The person the studio should call if something happens to this employee at work.",
  "Emergency Contact.emergencyContactNumber": "The phone number to call that person on in an emergency.",
  "Emergency Contact.emergencyContactRelationship": "How the emergency contact is related to the employee, such as father, spouse or friend.",

  "Photo.profilePhotoUrl": "Their face photo, shown on their staff record, the org chart and their profile.",

  "Identity.aadharCardNumber": "The twelve-digit number on their Aadhaar card, the government ID collected at onboarding.",
  "Identity.panCardNumber": "Their ten-character PAN, the income-tax number used for salary and tax records.",
  "Identity.aadharCardImageUrl": "The photo of their Aadhaar card they uploaded, to check the number against.",
  "Identity.panCardImageUrl": "The photo of their PAN card they uploaded, to check the number against.",

  "Bank.bankName": "The bank of the account their salary is paid into.",
  "Bank.bankLocation": "The branch or city of that salary bank account.",
  "Bank.accountNumber": "The salary account number the studio pays them into.",
  "Bank.ifscCode": "The eleven-character code of their bank branch, needed for salary transfers.",
  "Bank.bankAccountStatus": "Whether this salary account is marked Active or Inactive; the employee form does not set it.",

  "Notes.remarksDetails": "Free-text remarks HR has kept about this employee.",
  "Notes.appreciationDetails": "Free-text notes of praise or recognition kept on this employee's record.",

  // ── Employee repository: an onboarding invite not yet a record (`inviteInfoSections`) ──
  "Invite information.employeeName": "The candidate's name as HR typed it when sending the onboarding invite.",
  "Invite information.emailId": "The email the invite was sent to; the candidate confirms it, or the phone, to open the form.",
  "Invite information.contactNumber": "The candidate's phone as HR typed it on the invite; it can be used to open the form.",
  "Invite information.designation": "The job HR intends to hire them for, typed on the invite; it can still change at review.",
  "Invite information.employmentStatus": "Always Employee Submission Pending here: the candidate has not sent their onboarding form yet.",

  "Invite Status.inviteCreatedAt": "When HR created and sent this onboarding invite.",
  "Invite Status.inviteExpiresAt": "The last moment the onboarding link opens; HR sets it and can move it later.",
  "Invite Status.inviteStatus": "Created means the link is not opened yet; Verified means the candidate has opened it and confirmed who they are.",
  "Invite Status.candidateSubmission": "Whether the candidate has sent their onboarding form back; until then it reads Pending.",

  // ── Admin → Role Management (`roleInfoSections`) ──
  "Identification.name": "The role's name, as shown when it is given to somebody in User Management.",
  "Identification.description": "A short note on what this role is for, written by whoever made the role.",
  "Identification.typeLabel": "Locked roles come with the app and cannot be changed - duplicate one to edit it. Custom roles are the studio's own.",
  "Identification.userCount": "How many logins hold this role now; a role still held by somebody cannot be deleted.",
  "Reach.branchNames": "The branches where this role's permissions apply. A role naming no branches gives access in none.",
  "Reach.moduleNames": "The parts of the app this role opens anything in, such as CRM, HRM or Accounts.",
  "Action permissions.readWrite": "What this role can both see and change - add, edit and delete.",
  "Action permissions.readOnly": "What this role can only look at, without changing anything.",

  // ── Admin → User Management (`userInfoSections`) ──
  "Account.name": "The login's display name, usually the name of the employee it belongs to.",
  "Account.email": "The email this login signs in with and receives password reset links on.",
  "Account.statusLabel": "Whether the login can sign in; ACTIVE means it is in use.",
  "Account.employeeLabel": "The employee record this login belongs to. A login not linked cannot mark attendance or raise payment requests.",
  "Access.branchLabel": "The branch recorded on the login itself. It does not decide what they can reach - their roles do.",
  "Access.roleNames": "The roles given to this login; together they decide every screen and action open to them.",
  "Access.branchNames": "Every branch their roles reach, added up across all the roles they hold.",
};

export default HELP;
