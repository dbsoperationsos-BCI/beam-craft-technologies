/**
 * The helper line under every Settings screen's title: what the screen is for and what changing it
 * affects, in the studio's words. Drawn by the shared section heading (`SchemaFormSection`), so every
 * screen carries it in the same place. Keyed by the screen's id in `SettingsOverlay`; a screen added
 * there without a line here fails `test/settings-help.test.mjs`.
 */
const TEMPLATE_HELP = "Anything in {braces} is filled in from the record when it is sent.";

export const SETTINGS_HELP = {
  // User Settings
  whatsapp: "The CRMs who can chat from a lead, and whether their WhatsApp is linked. Each one links their own account from the WhatsApp Chat tab of any lead - it is their WhatsApp, so nobody else can link or unlink it for them.",
  "whatsapp-activity-log": "Every WhatsApp message the application sent or tried to send, with each attempt. A failed message can be sent again from here.",

  // User Preference
  "sidebar-layout": "The order of the modules in your own sidebar. It is saved to your login, so it follows you to any device and changes nobody else's.",

  // Overall
  "table-settings": "Choose a module and vertical, then build the fields its table and forms carry.",
  "field-settings": "The answers a form's fields offer - designations, departments, verticals, skills and the like. Changes apply once you save.",
  "project-services": "The services every project is built from. A project picks from this list, so a change here shows on new bookings.",
  "project-deliverables": "The deliverables every project is built from - albums, videos, prints. A project picks from this list, so a change here shows on new bookings.",

  // Exclude Phone Numbers
  "exclude-numbers": "Calls to and from these numbers are never turned into leads. A number takes effect as soon as it is saved.",

  // Integrations
  integration: "Google Sheets linked to the CRM. Each linked sheet brings its rows in as leads on the vertical you choose.",
  "interview-integration": "Google Sheets and forms linked to Interview. Each linked sheet brings its rows in as candidates; Google Meet adds a meeting link to scheduled interviews.",

  // Quotation Settings
  "quotation-general": "What every brand's quotation prints the same way. Applies to quotations made from now on; ones already sent keep theirs.",
  "quotation-brand-DUM_DUM": "Dum Dum's terms and the pictures and words on its quotation PDF. Applies to quotations made from now on.",
  "quotation-brand-QUA_QUA": "Qua Qua's terms and the pictures and words on its quotation PDF. Applies to quotations made from now on.",
  "quotation-brand-CORP": "Corp's terms and the pictures and words on its quotation PDF. Applies to quotations made from now on.",

  // Employee
  "employee-referral": "What the studio pays an employee for a referral, and in how many instalments.",
  "employee-whatsapp-groups": "The WhatsApp groups an employee can be added to from Employee Preference. Removing a group here does not take anyone out of it on WhatsApp.",
  "employee-attendance-rules": "The studio's working day. Every attendance status and hours target is worked out from these numbers.",
  "employee-payroll-rules": "How payroll counts the month: the pay cycle, the payable days, the loss-of-pay rate and how net salary is rounded.",
  "certificate-experience": "The signature, signatory and closing note printed on the experience certificate given to employees.",
  "certificate-employment": "The signature, signatory and closing note printed on the employment certificate given to employees.",
  "certificate-offer-letter": "When each employee's offer letter is made, and what it says and is signed with.",
  "wishes-scheduler": "The WhatsApp group, time and senders for the wishes, and under it the wishes themselves - Birthday, Anniversary and Work Anniversary - as tabs. One wish is picked at random each time. Nothing is sent until a group is named and a sender chosen.",

  // Templates
  "message-cash-received": `The payment receipt message for a client, sent into the project's WhatsApp group on its own when Accounts records money received (from Project Management → Payment reminder's sender), and offered again from Share invoice. ${TEMPLATE_HELP}`,
  "message-employee-invite": `The message that sends a new candidate their onboarding form link. ${TEMPLATE_HELP}`,
  "message-employee-offboarding-form": `The message that sends a leaving employee their offboarding form link. ${TEMPLATE_HELP}`,
  "message-employee-offboarding-reminder": `The reminder to a leaving employee who has not filled in their offboarding form. ${TEMPLATE_HELP}`,
  "message-employee-offboarding-approved": `Tells a leaving employee HR has accepted their offboarding, with their last working day. ${TEMPLATE_HELP}`,
  "message-employee-offboarding-not-accepted": `Tells an employee HR did not accept their offboarding form, with HR's remark. ${TEMPLATE_HELP}`,
  "message-login-credentials": `Hands an employee their username, temporary password and login link. ${TEMPLATE_HELP}`,
  "message-client-login-credentials": `Hands a client the login for their project. ${TEMPLATE_HELP}`,
  "message-crd-document-link": `Hands a client the link to their CRD form. ${TEMPLATE_HELP}`,
  "message-feedback-thank-you": `Thanks a client who rated the studio Excellent or Good, and asks for a Google review. ${TEMPLATE_HELP}`,
  "message-feedback-issues": `Tells a client who rated the studio Average or Poor that the team will sort it out. ${TEMPLATE_HELP}`,
  "message-attendance-report": `The day's attendance report: whether it is sent, when, from whose WhatsApp and into which group, then its wording - which the Attendance Register's Send uses too. ${TEMPLATE_HELP}`,
  "message-payment-reminder": `The message a project's WhatsApp group gets two days before a payment is due; who sends it, and when, is set under Project Management → Payment reminder. ${TEMPLATE_HELP}`,
  "message-photo-selection-submitted": `Tells a WhatsApp group when a client submits their photo selection: whether it is sent, from whose WhatsApp and into which group, then its wording. ${TEMPLATE_HELP}`,
  "message-crm-lead-welcome": `The message each new lead from a linked Google Sheet gets on WhatsApp, from the WhatsApp of whoever it is assigned to; whether it is sent is set under Automatic WhatsApp Message → New Lead Welcome. Ending on a question invites a reply. ${TEMPLATE_HELP}`,
  "message-crm-lead-welcome-verticals": `Welcomes each new lead a linked Google Sheet brings in, on WhatsApp from the lead owner's own number: whether it is sent, then its wording per vertical for office hours and after hours. A lead whose vertical has nothing written is not messaged. ${TEMPLATE_HELP}`,
  "message-interview-application-invite": `The message Interview → Send Application Invite sends a candidate on WhatsApp, with their application link, and whether it is sent at all. ${TEMPLATE_HELP}`,
  "message-interview-welcome": `The message each new candidate from a linked interview Google Sheet gets on WhatsApp, with whether it is sent and from whose WhatsApp. Asking the screening questions here brings the answers in before anybody calls. ${TEMPLATE_HELP}`,
  "message-production-started": `Posted to the project's WhatsApp group when the team leaves the studio for the shoot. ${TEMPLATE_HELP}`,
  "message-production-reached": `Posted to the project's WhatsApp group when the team reaches the shoot place. ${TEMPLATE_HELP}`,
  "message-production-completed": `Posted to the project's WhatsApp group when the shoot is completed. ${TEMPLATE_HELP}`,

  // Organization and the rest
  "studio-branding": "The studio name and logo shown on client galleries and the studio's branded pages.",
  branches: "The studio's branches. Every branch picker in the application - users, assets, roles, project IDs - draws from this list.",
  holidays: "The days the studio is closed. They show on the calendar and count as holidays, not absences.",
  "login-slide": "The pictures shown beside the staff sign-in form.",
  "client-page-images": "The pictures on the client sign-in page.",
  "shoot-crew-notice": "Whether each shoot's crew is told about it on WhatsApp two days before, and who sends it. Everybody given a service is sent what the shoot is, when and where, and the service they are on; a plan changed after that tells only the people whose own part changed. Nothing is sent until a sender is chosen and it is switched on.",
  "payment-reminder": "Who sends the WhatsApp reminder into each project's group two days before a payment is due, and at what time - and the Cash Received message when money is recorded. Nothing is sent until a sender is chosen.",
  "application-monitoring": "How long someone can be idle before they stop counting as using the application. Every usage figure in Reports & Analytics uses it.",
  "activity-log-purge": "Permanently deletes older User Activity Log entries. You see how many will go before anything is deleted.",
};

/** The helper line for a Settings screen id, or "" when it has none. */
export const settingsHelpFor = (id) => SETTINGS_HELP[id] || "";
