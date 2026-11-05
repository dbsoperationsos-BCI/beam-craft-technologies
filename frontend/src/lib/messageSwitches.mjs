/*
 * Settings → Templates' ON / OFF for each message the studio sends over WhatsApp - the server's
 * `services/messageTemplateSwitches.js`, word for word. A message nobody switched is ON. OFF means
 * it is not sent at all: its Send WhatsApp button is absent (and refused by the server) and its
 * automatic sends stop.
 *
 * A switch is the message's template key, except the wishes: one switch per kind, for the ten
 * wordings picked from at random. Attendance WhatsApp Report, Photo Selection Submitted, New Lead
 * Welcome and Interview Welcome keep the switches they already had.
 */
export const MESSAGE_SWITCHES = Object.freeze({
  CASH_RECEIVED: "Cash Received",
  EMPLOYEE_ONBOARDING_INVITE: "Employee Invite",
  LOGIN_CREDENTIALS: "Login Credentials",
  CLIENT_LOGIN_CREDENTIALS: "Client Login Credentials",
  CRD_DOCUMENT_LINK: "CRD Document Link",
  INTERVIEW_APPLICATION_INVITE: "Interview Application Invite",
  EMPLOYEE_OFFBOARDING_FORM: "Offboarding Form",
  EMPLOYEE_OFFBOARDING_REMINDER: "Offboarding Reminder",
  EMPLOYEE_OFFBOARDING_APPROVED: "Offboarding Confirmed",
  EMPLOYEE_OFFBOARDING_NOT_ACCEPTED: "Offboarding Not Accepted",
  FEEDBACK_THANK_YOU: "Feedback Thank You",
  FEEDBACK_ISSUES: "Feedback Issues",
  PAYMENT_DUE_REMINDER: "Payment Reminder",
  SHOOT_CREW_ASSIGNED: "Shoot Crew Notice",
  SHOOT_CREW_REMOVED: "Shoot Crew Removed",
  PRODUCTION_STARTED_FROM_STUDIO: "Production — Started From Studio",
  PRODUCTION_REACHED_SHOOT_PLACE: "Production — Reached Shoot Place",
  PRODUCTION_SHOOT_COMPLETED: "Production — Shoot Completed",
  BIRTHDAY_WISH: "Birthday Wishes",
  WEDDING_ANNIVERSARY_WISH: "Anniversary Wishes",
  WORK_ANNIVERSARY_WISH: "Work Anniversary Wishes",
});

export const hasMessageSwitch = (key) => Object.prototype.hasOwnProperty.call(MESSAGE_SWITCHES, key);

// The Wishes Scheduler's tabs, to their switch.
export const WISH_SWITCH_FOR_TAB = Object.freeze({ birthday: "BIRTHDAY_WISH", weddingAnniversary: "WEDDING_ANNIVERSARY_WISH", workAnniversary: "WORK_ANNIVERSARY_WISH" });

// What OFF stops, for the line under each switch: a message somebody sends by hand, or one sent by itself.
const SENT_BY_HAND = new Set([
  "EMPLOYEE_ONBOARDING_INVITE", "LOGIN_CREDENTIALS", "CLIENT_LOGIN_CREDENTIALS", "CRD_DOCUMENT_LINK", "INTERVIEW_APPLICATION_INVITE",
  "EMPLOYEE_OFFBOARDING_FORM", "EMPLOYEE_OFFBOARDING_REMINDER", "EMPLOYEE_OFFBOARDING_APPROVED", "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED",
  "FEEDBACK_THANK_YOU", "FEEDBACK_ISSUES",
]);
export function switchNote(key, on) {
  if (on) return SENT_BY_HAND.has(key) ? "Sent from its Send WhatsApp button." : key === "CASH_RECEIVED" ? "Sent automatically to the project's group, and from the receipt's Send WhatsApp." : "Sent automatically on WhatsApp.";
  return SENT_BY_HAND.has(key) || key === "CASH_RECEIVED" ? "Off: not sent, and its Send WhatsApp button is hidden." : "Off: not sent.";
}
