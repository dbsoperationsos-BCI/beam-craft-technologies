import * as sales from "@/services/sales/googleSheetLinks.service";
import * as interview from "@/services/hrm/interviewSheetLinks.service";

/**
 * The two places a linked Google Sheet can feed, described for the one integration panel.
 *
 * `GoogleSheetsIntegrationSection` is the whole Settings → Integrations flow - the cards, the
 * Google account, the link dialog with its assignment rules, the linked-sheet list, Sync Now,
 * Preview Import, Edit and Delete - written once. What differs between the CRM and the Interview
 * register is only what is listed here: which routes it calls, which tables a sheet may be linked
 * to, what the rows are called, and where the browser comes back to after a Google consent.
 *
 * The routes differ because the guards do: the CRM's answer for `SALES / CRM Leads`, the Interview
 * module's for `HRM / Interview`, and an HR role need not hold the first to use the second. The
 * Google account itself is the one connection per login; both sets read it.
 */

/** The three CRM boards a sheet may feed, and the vertical each files its leads under. */
export const CRM_TABLES = {
  "Dum Dum": { systemTableId: "crm-table-dum-dum", vertical: "Dum Dum", label: "Dum Dum" },
  "Qua Qua": { systemTableId: "crm-table-qua-qua", vertical: "Qua Qua", label: "Qua Qua" },
  Corp: { systemTableId: "crm-table-corp", vertical: "Corp", label: "Corp" },
};

// The CRM's verticals, read from the tables above so the Table Settings picker and the sheet-link
// form cannot end up offering different lists.
export const CRM_VERTICAL_OPTIONS = Object.values(CRM_TABLES).map((table) => ({ value: table.vertical, label: table.vertical }));

export const SALES_SHEET_INTEGRATION = {
  id: "sales",
  /** The Settings rail entry this panel sits under, which the OAuth return reopens. */
  sectionId: "integration",
  systemTableName: "CRM",
  /** How the module is named in a sentence: "will stop syncing into the CRM". */
  moduleName: "the CRM",
  noun: "lead",
  nounPlural: "leads",
  nounTitle: "Lead",
  ownerLabel: "CRM",
  recordFieldLabel: "CRM Field",
  tableSelectLabel: "Select System Table",
  tables: Object.values(CRM_TABLES).map((table) => ({ value: table.systemTableId, label: table.label, vertical: table.vertical })),
  /** What the CRM board listens for to re-read its rows after a sync, a link or a delete. */
  refreshEvent: "dbs:crm-leads-refresh",
  /** Where a half-made link waits while the browser is away at Google's consent screen. */
  pendingLinkKey: "dbs.pendingGoogleSheetLink",
  sheetsDescription: "Instantly pull data from your Google spreadsheets",
  driveDescription: "Pick spreadsheets straight from your Drive",
  meet: {
    description: "Schedule lead meetings with a Meet link",
    howTo: {
      lead: "Meetings are booked against a lead rather than from here. Open a lead in the CRM, press",
      action: "Meetings",
      rest: ", and schedule one - the Meet link is created with the calendar event and invites go out to the guests you add.",
    },
  },
  /** The handful of answers the import preview prints per row. */
  previewRow: (row) => ({
    name: row?.candidate?.leadName || row?.candidate?.name || row?.record?.lead?.name || "",
    phone: row?.candidate?.phone || row?.record?.lead?.phone || "",
    email: row?.candidate?.email || row?.record?.lead?.officialEmailId || "",
    status: row?.record?.lead?.status || "",
    owner: row?.record?.lead?.crm || "",
  }),
  matchedRecordId: (row) => row?.matchedRecord?.lead?.id || "",
  deletedCount: (response) => Number(response?.deletedLeads || 0),
  api: {
    list: sales.getGoogleSheetLinks,
    save: sales.saveGoogleSheetLink,
    sync: sales.syncGoogleSheetLink,
    remove: sales.deleteGoogleSheetLink,
    preview: sales.getGoogleSheetImportPreview,
    assignableEmployees: sales.getSheetAssignableEmployees,
    connection: sales.getGoogleConnection,
    disconnect: sales.disconnectGoogleAccount,
    startOAuth: sales.startGoogleOAuth,
    pickerToken: sales.getGooglePickerToken,
    spreadsheetTabs: sales.getSpreadsheetTabs,
  },
};

export const INTERVIEW_SHEET_INTEGRATION = {
  id: "interview",
  sectionId: "interview-integration",
  systemTableName: "Interview",
  moduleName: "the Interview register",
  noun: "candidate",
  nounPlural: "candidates",
  nounTitle: "Candidate",
  ownerLabel: "interviewer",
  recordFieldLabel: "Candidate Field",
  tableSelectLabel: "Select System Table",
  // One register rather than three boards; the picker stays so the dialog reads the same.
  tables: [{ value: "interview-candidates", label: "Interview Candidates" }],
  refreshEvent: "dbs:interview-candidates-refresh",
  pendingLinkKey: "dbs.pendingInterviewSheetLink",
  sheetsDescription: "Pull candidates from your Google spreadsheets and forms",
  driveDescription: "Pick spreadsheets straight from your Drive",
  meet: {
    description: "Schedule interviews with a Meet link",
    howTo: {
      lead: "Interviews are scheduled against a candidate rather than from here. Open a candidate on the Interview screen, choose",
      action: "Google Meet",
      rest: " as the mode, and paste the Meet link from this account's calendar into the candidate's Meet Link field.",
    },
  },
  previewRow: (row) => ({
    name: row?.candidate?.name || row?.record?.candidate?.name || "",
    phone: row?.candidate?.phone || row?.record?.candidate?.phone || "",
    email: row?.candidate?.email || row?.record?.candidate?.email || "",
    status: row?.candidate?.status || row?.record?.candidate?.status || "",
    owner: row?.record?.candidate?.interviewer || "",
  }),
  matchedRecordId: (row) => row?.matchedRecord?.candidate?.candidateCode || "",
  deletedCount: (response) => Number(response?.deletedCandidates || 0),
  api: {
    list: interview.getInterviewSheetLinks,
    save: interview.saveInterviewSheetLink,
    sync: interview.syncInterviewSheetLink,
    remove: interview.deleteInterviewSheetLink,
    preview: interview.getInterviewSheetImportPreview,
    assignableEmployees: interview.getInterviewSheetAssignableEmployees,
    connection: interview.getInterviewGoogleConnection,
    disconnect: interview.disconnectInterviewGoogleAccount,
    startOAuth: interview.startInterviewGoogleOAuth,
    pickerToken: interview.getInterviewGooglePickerToken,
    spreadsheetTabs: interview.getInterviewSpreadsheetTabs,
  },
};

/** Every integration section the Settings rail may open on, by rail id. */
export const SHEET_INTEGRATION_SECTION_IDS = [SALES_SHEET_INTEGRATION.sectionId, INTERVIEW_SHEET_INTEGRATION.sectionId];
