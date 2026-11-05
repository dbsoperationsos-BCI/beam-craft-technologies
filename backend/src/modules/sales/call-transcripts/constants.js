/**
 * The statuses a suggestion may propose.
 *
 * Mirrors LEAD_STATUS_OPTIONS in frontend/src/components/sales/CRMPage.js. The model is given this
 * list so it cannot suggest a status the CRM has no button for, and Apply cannot write one either.
 */
const LEAD_STATUS_VALUES = ["CNA", "Invalid", "Rejected", "Interested", "Followup", "Converted"];

/*
 * The lead fields a suggestion is allowed to write.
 *
 * An allowlist rather than a filter on what arrives: Apply takes a field name from the browser, and
 * without this a crafted request could set any column on the lead.
 */
const APPLICABLE_FIELDS = {
  leadStatus: { label: "Lead Status", from: "suggestedStatus" },
  nextFollowUpDate: { label: "Next Follow-up Date", from: "followUpDate" },
  eventPlannedType: { label: "Event Type", from: "eventType" },
  eventPlannedDate: { label: "Event Date", from: "eventDate" },
  preferredBudget: { label: "Preferred Budget", from: "budget" },
  city: { label: "Location", from: "location" },
};

module.exports = { LEAD_STATUS_VALUES, APPLICABLE_FIELDS };
