"use client";

import { createPortal } from "react-dom";
import useStickyTab from "@/components/shared/useStickyTab";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useFormErrors from "@/components/shared/useFormErrors";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import { usePreference } from "@/components/preferences/PreferencesProvider";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import HelpTip from "@/components/shared/HelpTip";
import { detailHelpFor } from "@/constants/detailHelp";
import { Fragment, cloneElement, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess, useRouteAccess } from "@/components/auth/PermissionsProvider";
import { toIsoDay } from "@/lib/crmLeadDates";
import { useRouter, useSearchParams } from "next/navigation";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import MultiSelectField from "@/components/shared/MultiSelectField";
import OptionsMenu from "@/components/ui/OptionsMenu";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import BulkImportLeadsDialog from "@/components/sales/BulkImportLeadsDialog";
// The studio's own clock, which several of this board's own stamps are read in. The call formatters
// that also used it have moved to `@/lib/callFormats.mjs` and carry their own copy of it.
const ACTIVITY_TIME_ZONE = "Asia/Kolkata";

import CallTranscriptsTab from "@/components/shared/CallTranscriptsTab";
// The two call formatters the popup and the shared tab both read a call by.
import { formatActivityTime, formatCallDuration } from "@/lib/callFormats.mjs";
import LeadAiPanel from "@/components/sales/LeadAiPanel";
import LeadNebulaPanel from "@/components/ai/LeadNebulaPanel";
import LeadNebulaButton from "@/components/ai/LeadNebulaButton";
import ContextMenu from "@/components/ui/ContextMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { MOVE_TARGETS, VERTICAL_MOVE_CLEARS, verticalMoveWarning } from "@/lib/crmVerticalMove.mjs";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import { leadFormHasEntries } from "@/lib/crmLeadForm.mjs";
import { MAX_REMARK_ATTACHMENTS, leadRemarkEntries, normalizeRemarkAttachments, normalizeRemarkEntries, remarkSummary } from "@/lib/crmRemarks.mjs";
/*
 * The notes composer, which used to be defined in this file. Moved to `shared/` because the Interview
 * register needs the same control and had grown a second, poorer answer to the same question; nothing
 * about it changed for the lead.
 */
import NotesComposer from "@/components/shared/NotesComposer";
import CrmKanbanBoard from "@/components/sales/CrmKanbanBoard";
import { formatDateTime } from "@/lib/formatDateTime.mjs";
import { openNebula } from "@/lib/ai/nebulaPanel";
import DataTable from "@/components/data-table/DataTable";
import SimpleTable from "@/components/data-table/SimpleTable";
import { ACTIONS_COLUMN } from "@/components/data-table/tableCells";
import { ProjectRecordPanel } from "@/components/data-table/ProjectDataTable";
import { commonProjectInfoSections } from "@/constants/infoPanelConfig";
import { createExportFileName, exportToCsv } from "@/lib/tableExport";
import TextField from "@/components/shared/TextField";
import PhoneField from "@/components/shared/PhoneField";
// Whether a typed number is finished, so the WhatsApp Number field can save itself the moment
// it is - the one field on the lead popup that does not wait for Update.
import { isCompletePhoneNumber } from "@/lib/phoneNumber";
// The CRM is a 12-hour application. Callyzer is not, so the Calls board needs translating.
import { toTwelveHourClock } from "@/lib/clockTime.mjs";
import ComboBoxField from "@/components/shared/ComboBoxField";
import DateField from "@/components/shared/DateField";
import TimeField from "@/components/shared/TimeField";
import RadioGroupField from "@/components/shared/RadioGroupField";
import DataTableShell from "@/components/data-table/DataTableShell";
// How a cell keeps its contents inside its column - one rule, shared with `DataTable`.
import DataTableInfoPanel from "@/components/data-table/DataTableInfoPanel";
import TableFooter from "@/components/data-table/TableFooter";
import IconButton from "@/components/shared/IconButton";
import ChevronIcon from "@/components/ui/ChevronIcon";
import { setActiveVertical } from "@/lib/ai/activeVertical";
import CloseIcon from "@/components/ui/CloseIcon";
import FilterCombobox from "@/components/shared/FilterCombobox";
import FilterDateInput from "@/components/shared/FilterDateInput";
import { apiRequest } from "@/lib/apiClient";
import { getLeadQuote, getQuotationBookings, getQuotationCatalogue } from "@/services/sales/quotationCalculator.service";
import { calculatorTotals, serviceQuantitiesFromRows, serviceRowsFromQuantities, syncAutoDeliverables } from "@/lib/quotationCalculator.mjs";
import { generatorDraftFromCalculator } from "@/lib/quotationCalculatorHandoff.mjs";
import { stashQuotationGeneratorDraft } from "@/lib/quotationGeneratorDraft";
import { getProjectDeliverableDefinitions, getProjectServiceDefinitions } from "@/services/project-management/project-workflow.service";
import { getCrmLead, moveCrmLeadVertical } from "@/services/sales/crm-leads.service";
import { durationForSessionTiming } from "@/components/project-management/AddShootDialog";
import QuotationCalculatorLines from "@/components/sales/QuotationCalculatorLines";
import { checkCsvAgainstTable } from "@/lib/csvTemplateCheck";
import { streamCsvRows } from "@/lib/csv";
import { countSelected, emptySelection, headerState, isSelected, toggleAll, toggleOne } from "@/lib/leadSelection";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import FormatListBulletedRoundedIcon from "@mui/icons-material/FormatListBulletedRounded";
import FormatListNumberedRoundedIcon from "@mui/icons-material/FormatListNumberedRounded";
import OpenInFullRoundedIcon from "@mui/icons-material/OpenInFullRounded";
import CloseFullscreenRoundedIcon from "@mui/icons-material/CloseFullscreenRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import { CustomFieldInput, customFieldProblem, defaultOptionValue } from "@/components/sales/TableSettingsPanel";
import MeetingsDialog from "@/components/sales/MeetingsDialog";
import DuplicateEnquiryDialog from "@/components/sales/DuplicateEnquiryDialog";
import { getDuplicateEnquiries } from "@/services/sales/crm-lead-duplicates.service";
import WhatsAppChatPanel from "@/components/sales/WhatsAppChatPanel";
import { getWhatsappSession } from "@/services/sales/whatsapp-chat.service";
import { fetchRemarkAttachment, uploadRemarkAttachment } from "@/services/sales/remark-attachments.service";
import MeetingReminders from "@/components/sales/MeetingReminders";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import CloseButton from "@/components/shared/CloseButton";
import useEscapeKey from "@/components/shared/useEscapeKey";
// The verticals, nearest branches and CRM names, shared with every other page that offers
// the same choices rather than kept private to this one.
import { DEFAULT_VERTICAL, verticalOptions, crmNamesFromRows, crmOptionsFrom, normalizeVertical, optionValues } from "@/lib/crmOptions";
import useBranchOptions from "@/components/sales/useBranchOptions";
import useLeadSuggestionLists from "@/components/sales/useLeadSuggestionLists";
// The four boards this module is read through, and the rule that says which one a lead is on.
import { CALLS_BOARD, CALLS_BOARD_LABEL, boardOptions, isCallRecord, isUnassignedCall } from "@/lib/crmBoards";
import { CRM_BOARD_STATUS_ORDER, crmBoardColumnStatuses } from "@/lib/crmBoardOrder.mjs";
import DateRangeSwitch from "@/components/shared/DateRangeSwitch";
import { ALL_TIME, resolveDateRange, showsDateRange } from "@/lib/crmDateRange.mjs";
import { getCrmEmployees } from "@/services/sales/employees.service";
import { TABLE_SETTINGS_SAVED_EVENT } from "@/lib/globalSettings";
import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
import { matchesWordChunks } from "@/lib/wordChunks.mjs";
// The four boards the dropdown offers, as ids - what `useStickyTab` checks a remembered board
// against, so the two can never name different sets.
const boardIds = boardOptions.map((option) => option.value);

/*
 * ── The Calls board ───────────────────────────────────────────────────────────────────────────
 *
 * A fourth board beside the three verticals, holding the calls nobody has placed yet: Callyzer
 * delivers a call, the webhook makes a lead of it, and nothing in the call said which vertical it
 * belongs to. `@/lib/crmBoards` has the rule and why it exists.
 *
 * What this file adds is what that board looks like and what can be done on it. Somebody reads the
 * caller, double-clicks the row, and the Add Lead form opens on what the call already knows - the
 * name, the number, when it came in, who took it, what was said - on the Dum Dum form, with the
 * Vertical radio above it to move the caller to whichever of the three they turn out to be.
 * Confirming writes that vertical onto the same lead, and the row leaves this board for it. Nothing
 * is duplicated: the lead the call created is the lead that moves.
 */

const boardTableColumns = {
  "Dum Dum": [
    { id: "id", label: "Enquiry ID" },
    { id: "enquiryDate", label: "Enquiry Date" },
    { id: "addedTime", label: "Added Time" },
    { id: "name", label: "Enquiry Name" },
    { id: "phone", label: "Phone Number" },
    { id: "relationship", label: "Relationship" },
    { id: "status", label: "Status" },
    /*
     * The two follow-up dates, next to the status they qualify.
     *
     * Qua Qua has carried both since it was built and Dum Dum carried neither, which on the board
     * the three pending tabs are read from meant the date those tabs sort by could not be seen on
     * the row they sorted. Spelled exactly as Qua Qua spells them - the CSV template, the sheet
     * sync and the date filters all key off the label, so a second spelling would be a second
     * column.
     */
    { id: "lastFollowUpDate", label: "Last Followup Date" },
    { id: "nextFollowUpDate", label: "Next followup Date" },
    { id: "crm", label: "CRM" },
    { id: "assignedBranch", label: "Nearest Branch" },
    { id: "referredFrom", label: "Referred From" },
    { id: "offerType", label: "Offer Type" },
    { id: "campaignName", label: "Campaign Name" },
    { id: "adsetName", label: "Adset Name" },
    { id: "adName", label: "Ad Name" },
    { id: "preferredBudget", label: "Preferred Budget" },
    { id: "city", label: "City" },
    { id: "state", label: "State" },
    { id: "eventPlannedType", label: "Type of Event Planned" },
    { id: "eventPlannedDate", label: "When is the Event Planned" },
    { id: "groomName", label: "Groom Name" },
    { id: "groomContact", label: "Groom Contact" },
    { id: "groomLocation", label: "Groom Location" },
    { id: "brideName", label: "Bride Name" },
    { id: "brideContact", label: "Bride Contact" },
    { id: "brideLocation", label: "Bride Location" },
    { id: "referenceName", label: "Referenced Person Name" },
    { id: "referenceContact", label: "Referenced Person Contact" },
    { id: "remarks", label: "Remarks" },
    { id: "source", label: "Source" },
  ],
  "Qua Qua": [
    { id: "id", label: "Enquiry ID" },
    { id: "enquiryDate", label: "Enquiry Date" },
    { id: "name", label: "Enquiry Name" },
    { id: "addedTimestamp", label: "Added Timestamp" },
    { id: "phone", label: "Phone Number" },
    { id: "status", label: "Status" },
    { id: "crm", label: "CRM" },
    { id: "assignedBranch", label: "Nearest Branch" },
    { id: "offerType", label: "Offer Type" },
    { id: "campaignName", label: "Campaign Name" },
    { id: "adsetName", label: "Adset Name" },
    { id: "adName", label: "Ad Name" },
    { id: "referredFrom", label: "Referred From" },
    { id: "preferredBudget", label: "Preferred Budget" },
    { id: "city", label: "City" },
    { id: "state", label: "State" },
    { id: "eventPlannedType", label: "Type of Event Planned" },
    { id: "eventPlannedDate", label: "When is the Event Planned" },
    { id: "contactRepeated", label: "Contact Repeated" },
    { id: "shootType", label: "Shoot Type" },
    { id: "location", label: "Location" },
    { id: "ihOh", label: "IH/OH" },
    { id: "lastFollowUpDate", label: "Last Followup Date" },
    { id: "nextFollowUpDate", label: "Next followup Date" },
    { id: "lastConvertedDate", label: "Last Converted Date" },
    { id: "shootId", label: "Shoot ID" },
    { id: "babyOrMotherName", label: "Baby (or) Mother Name" },
    { id: "dateOfBirthOrEdod", label: "Date of Birth (or) EDOD" },
    { id: "remarks", label: "Remarks" },
    { id: "source", label: "Source" },
  ],
  Corp: [
    { id: "id", label: "Enquiry ID" },
    { id: "enquiryDate", label: "Enquiry Date" },
    { id: "name", label: "Enquiry Name" },
    { id: "addedTimestamp", label: "Added Timestamp" },
    { id: "phone", label: "Phone Number" },
    { id: "status", label: "Status" },
    { id: "crm", label: "CRM" },
    { id: "assignedBranch", label: "Nearest Branch" },
    { id: "referredFrom", label: "Referred From" },
    { id: "offerType", label: "Offer Type" },
    { id: "campaignName", label: "Campaign Name" },
    { id: "adsetName", label: "Adset Name" },
    { id: "adName", label: "Ad Name" },
    { id: "preferredBudget", label: "Preferred Budget" },
    { id: "city", label: "City" },
    { id: "state", label: "State" },
    { id: "companyName", label: "Company Name (or) Client organisation" },
    { id: "primaryDecisionMaker", label: "Primary decision-maker - Contact" },
    { id: "designation", label: "Designation" },
    { id: "contactNumber", label: "Contact Number" },
    { id: "alternateMobileNumber", label: "Alternate Mobile Number" },
    { id: "officialEmailId", label: "Official Email ID" },
    { id: "companyWebsite", label: "Company Website" },
    { id: "companyType", label: "Company Type" },
    { id: "companySize", label: "Company Size" },
    { id: "branches", label: "Branches" },
    { id: "projectType", label: "Project Type" },
    { id: "location", label: "Location" },
    { id: "shootCity", label: "Shoot City" },
    { id: "expectedBudget", label: "Expected Budget" },
    { id: "competitions", label: "Competitions" },
    { id: "remarks", label: "Remarks" },
    { id: "source", label: "Source" },
  ],
  /*
   * What a call is, before anybody has decided whose it is.
   *
   * The same column ids the verticals use, so the filters, the sort arrows and Manage Columns all
   * behave exactly as they do everywhere else - what changes is which of them are worth showing
   * and, in three places, what they are called. On this board `crm` is the employee whose phone
   * took the call and `enquiryDate` / `addedTime` are when it came in, so they are labelled as the
   * call rather than as the enquiry.
   *
   * None of the vertical-specific columns are here. A caller nobody has placed has no groom, no
   * baby's date of birth and no company size - those are questions the vertical asks, and the
   * vertical is what this board exists to establish.
   *
   * Contact Repeated and Referred From have gone. Both were a lead's answers shown against a call:
   * Referred From read "Callyzer Call Log" on every row of a board where every row comes from
   * Callyzer, and Contact Repeated was a marker the webhook wrote onto a lead. Call Type and
   * Duration stand in their place, and both differ from row to row.
   */
  // The key is spelled out rather than computed from `CALLS_BOARD` so this map stays a plain
  // literal - the CSV template checks in backend/test read it as text. `crm-boards.test.mjs` pins
  // `CALLS_BOARD` to this same spelling so the two cannot drift.
  Calls: [
    /*
     * The enquiry, under whatever it is called so far.
     *
     * A call carries an enquiry id from the moment it arrives - its own, in a format of its own
     * (`DBS-CLID-000001`), which reads as "an enquiry nobody has looked at yet". The moment somebody
     * adds the caller it is the lead's, in that vertical's format (`DBS-EID-QQ-CBE-000004`), and
     * this cell changes to say so. One column rather than two, because it is one fact: what this
     * enquiry is called, and how far along it is.
     *
     * The row's own key is the call's code and is not shown - a client rung five times is five rows
     * that would otherwise all be drawn under one lead's id.
     */
    { id: "enquiryId", label: "Enquiry ID" },
    { id: "enquiryDate", label: "Call Date" },
    { id: "addedTime", label: "Call Time" },
    { id: "name", label: "Caller Name" },
    { id: "phone", label: "Phone Number" },
    { id: "crm", label: "Attended By" },
    // Which way the call went and how long it lasted: between them they say everything the six
    // tabs cut this board by, so a row can be read without working out which tab it is in.
    { id: "callType", label: "Call Type" },
    { id: "duration", label: "Duration" },
    // Connected, Not Connected or Never Attended - the call's outcome rather than a lead's status.
    // Two of the three are also tabs; the third is the one this column exists to say.
    { id: "status", label: "Status" },
    { id: "remarks", label: "Remarks" },
    { id: "source", label: "Source" },
  ],
};

// Qua Qua alone runs a lead through conversion and follow-up together, so this status is
// offered on that vertical only - Dum Dum and Corp never see it, in the pills, the Status
// column filter, Add Lead or a bulk update. Named once here because it is also the label
// leads carrying the older "Followup & Converted" spelling are read back as.
/*
 * Unanswered attempts a lead is allowed before it stops being chased.
 *
 * Six are recorded and shown - the lead reads "CNA (1)" through "CNA (6)" as they accumulate.
 * The seventh press is the one that gives up: the lead moves to Rejected rather than being
 * called forever, and CNA is closed off for it.
 *
 * So six is the last count a lead can wear, not the count at which it is rejected.
 */
const MAX_CNA_ATTEMPTS = 6;

// How long the edits have to stop for before the page says they saved. Long enough that typing
// a name is one confirmation rather than one per letter, short enough to still read as a reply
// to what was just done.
const SAVED_NOTICE_DELAY_MS = 700;

// How often the popup re-reads whether WhatsApp is still linked. Slow on purpose: it answers
// from memory on the server, and the answer only changes when a device is linked or unlinked.
const WHATSAPP_STATUS_POLL_MS = 15000;

// Statuses that end the conversation. A lead marked Invalid or Rejected is not being chased,
// so it has no follow-up date to record and the picker is closed off for them.
const STATUSES_WITHOUT_FOLLOW_UP = ["Invalid", "Rejected"];

/*
 * Whether a lead at this status carries no next follow-up: the two above everywhere, and plain
 * Converted on **Dum Dum and Corp** - a wedding or corporate client who has booked is not called back
 * about the enquiry, and the day it converted is its Last Follow-up Date. A Qua Qua client comes back
 * (the newborn, the birthday, the next shoot), so a Converted Qua Qua lead keeps an optional next
 * follow-up. "Converted & Followup" always keeps one.
 *
 * `vertical` is the lead's own vertical text, read the way the server's `board_key` reads it (blank
 * is Dum Dum), so the form and the server agree on which leads this is. Kept apart from the list
 * above because that one also decides what a turned-down lead may be saved without
 * (`REJECTED_LEAD_FIELDS`), and a converted lead still needs everything a lead needs. Mirrors
 * `endsTheConversation` in backend/src/modules/sales/crm-leads/crmLeadService.js.
 */
const isQuaQuaVertical = (vertical) => String(vertical ?? "").trim().replace(/ /g, "").toLowerCase() === "quaqua";
function dropsNextFollowUp(status, vertical) {
  const current = String(status ?? "").trim();
  return STATUSES_WITHOUT_FOLLOW_UP.includes(current) || (current === "Converted" && !isQuaQuaVertical(vertical));
}

const CONVERTED_AND_FOLLOWUP_STATUS = "Converted & Followup";

/*
 * Statuses that may not be saved without a Next Follow-up Date: the lead is still being chased,
 * so when the next call is due has to be written down. The rest either end the chase
 * (`dropsNextFollowUp`) or have no status yet, and the Last Follow-up Date - stamped
 * by every save - is all they keep.
 */
const NEXT_FOLLOW_UP_REQUIRED_STATUSES = ["CNA", "Interested", "Followup", CONVERTED_AND_FOLLOWUP_STATUS];
const NEXT_FOLLOW_UP_FIELD = { key: "nextFollowUpDate", label: "Next Follow-up Date", message: "Next Follow-up Date is required for this status." };
const CONVERTED_AND_FOLLOWUP_VERTICAL = "Qua Qua";

/*
 * ── The statuses that open a project instead of being written down ────────────────────────────
 *
 * Converting is not a status change, it is the start of a project: the lead is handed to Sales
 * Manager in a second tab, and it is that project's own save which marks the lead converted. So
 * these two pills do not write anything here - they ask, and then they open a tab.
 *
 * **Converted & Followup** belongs on this list for exactly the reason Converted does. It is Qua
 * Qua's own status for a client who has bought and is still being worked - the shoot is booked and
 * the follow-ups carry on - and a client who has bought needs a project just as much as one who has
 * bought and is finished with. It was setting a status and stopping, so the one press that should
 * have opened Create Project was the one press that quietly did not.
 *
 * Which of the two was pressed travels with the conversion and is applied by the project's save, so
 * the lead ends up reading the status that was actually chosen rather than a flattened "Converted".
 */
const PROJECT_OPENING_STATUSES = ["Converted", CONVERTED_AND_FOLLOWUP_STATUS];
const opensProjectFor = (status) => PROJECT_OPENING_STATUSES.includes(String(status ?? "").trim());

/**
 * The Create Project link for a conversion, built in one place.
 *
 * The status rides in the URL rather than being written to the lead first, which is what keeps the
 * promise the confirmation makes: nothing changes until the project is saved, so a tab closed
 * without saving leaves the lead exactly as it was. Plain "Converted" is left off - it is what the
 * server falls back to, and a link carrying it says nothing the server did not already assume.
 */
function convertProjectUrl(leadId, status = "") {
  const params = new URLSearchParams({ convertLead: String(leadId || "") });
  if (status && status !== "Converted") params.set("convertStatus", status);
  return `/sales/manager?${params.toString()}`;
}

// The statuses a lead can hold, in the order they are offered.
/*
 * The two statuses a lead wears when nobody has given it one.
 *
 * A lead that arrives and is left alone is not "Interested" - nobody has spoken to it yet, and
 * reading it as interested overstates what is known. It is Yet to connect on the day it lands,
 * and Inactive once a day has passed with still no status against it.
 *
 * Neither is stored and neither is a pill anyone can press. They are worked out from the
 * lead's own arrival date each time it is read, so a lead becomes Inactive overnight on its
 * own - no job to run, nothing to bulk-update, and no way for the label to be left stale on a
 * lead that has since been worked. The moment a real status is set it takes over completely.
 */
const YET_TO_CONNECT_STATUS = "Yet to connect";
const INACTIVE_STATUS = "Inactive";

/*
 * A lead nobody has been given.
 *
 * `crm` is the person a lead is assigned to - Assign To on the form, the CRM column on the board -
 * and a lead with nothing in it has been given to nobody. Trimmed, because a cell holding a space
 * is not a person: those arrive from sheets and from files all the time.
 *
 * Like Yet to connect, **Unassigned is not a status anybody sets**: nothing stores the word, no pill
 * offers it, and it is worked out from the lead each time it is read. Putting somebody on the lead
 * brings its own status straight back, untouched underneath.
 *
 * Unlike Yet to connect, it is read *before* the lead's own status rather than instead of a missing
 * one. A lead nobody has been given is not being worked whatever the status against it says, and
 * that was the studio's ask: a lead reading Converted with nobody on it is a lead nobody owns, and
 * showing it as Converted is how it stays that way.
 *
 * Mirrors `UNASSIGNED_SQL` and the `unassigned` clause in leadQueryService.js, which decide the same
 * thing for the tab, its count and the Status column the server prints.
 */
const UNASSIGNED_STATUS = "Unassigned";
/*
 * Every project of the lead is in Resource Management → Recycling Bin. Shown, never stored and never
 * offered as a status to choose: the server reads it (`PROJECT_DELETED_SQL` in crmLeadService.js) and
 * the lead reads its own status again once the project is restored.
 */
const PROJECT_DELETED_STATUS = "Project deleted";
const isUnassignedLead = (lead = {}, details = {}) => !String(lead?.crm ?? details?.crm ?? "").trim();

/**
 * The day a lead arrived: its **Enquiry Date**, which is what every tab on this board is read from.
 *
 * The same three sources the server's `COLUMN_SQL.enquiryDate` coalesces, in the same order - the
 * enquiry's own `date`, then `created_date`, then the row's own insert timestamp for a lead nothing
 * dated. It read `createdDate` alone, so a lead whose source supplied `date` and no `created_date`
 * was dated here by its insert timestamp while the server dated it by the cell: the pill said
 * Inactive on a lead the Yet to connect tab was listing, and neither was arguably wrong because the
 * two were answering different questions. Keep this chain identical to that expression.
 */
function leadArrivalDay(lead = {}, details = {}) {
  const candidates = [lead.date, details.date, lead.enquiryDate, details.enquiryDate, lead.createdDate, details.createdDate];
  for (const candidate of candidates) {
    /*
     * `toIsoDay`, not an ISO test.
     *
     * These are text columns holding whatever wrote them, and a CSV exported from Excel writes
     * `09-Sep-26`. Matched against `^\d{4}-\d{2}-\d{2}$` that is not a date, so a whole imported
     * file fell past every candidate to the insert timestamp below and the Enquiry Date column
     * printed **today** on every row - while the server, reading the same columns with the same
     * shapes, filed them under no tab at all. One list of shapes now, shared with the SQL.
     */
    const stated = toIsoDay(candidate);
    if (stated) return stated;
  }
  const created = lead.createdAt || details.createdAt;
  if (!created) return "";
  const date = new Date(created);
  return Number.isNaN(date.getTime()) ? "" : getLocalDateKey(date);
}

/*
 * ── A Qua Qua lead with an occasion open is being worked for that occasion ─────────────────────
 *
 * Qua Qua shoots children, and the same client is worth calling more than once. Two occasions say
 * so: a **newborn** window around the estimated delivery date, and a **birthday** window before the
 * child's first birthday. Either is a fresh reason to call rather than a continuation of whatever
 * was sold before, so the board puts the lead back into Yet to connect when one opens, and the
 * status set from there is kept against the occasion - the lead's own status stays as the record of
 * the last shoot, and the next occasion arrives with nothing against it and lands in Yet to
 * connect again.
 *
 * The API sends the occurrence beside the lead rather than folded over it (`occasionWindow`,
 * `occasionStatus`, and so on - see `occasionLeadService.js` and `extractDetailsFromRow` on the
 * server), which is what lets a screen read a lead and save it back without ever copying an
 * occasion's status onto the lead. Everything below is the reading half of that: three fields that
 * take the occasion's value while its window is open, and the lead's value the rest of the time.
 * The writing half needs nothing here - the server decides where a status belongs.
 */
// Optional chaining rather than default parameters: these are called with whatever the caller has
// to hand, and a lead that has not loaded yet is `null`, which a default would not catch.
function isOccasionLead(lead, details) {
  return Boolean(lead?.occasionWindow ?? details?.occasionWindow);
}

function occasionValue(lead, details, key) {
  return lead?.[key] ?? details?.[key];
}

/**
 * The status a lead reads as: the one it was given, or Yet to connect until somebody gives it one.
 *
 * No status set means nobody has spoken to the lead, and that is as true a month later as on the
 * day the enquiry arrived - so there is no age in this any more. It used to read Yet to connect
 * only on the day of the lead's own arrival and **Inactive** from the next morning, with a lead
 * inside an occasion window and a lead a Google Sheet link put here exempted from the ageing,
 * because each of those was plainly a call still to be made. The queue emptied itself overnight
 * while the calls in it went unmade, so the ageing is gone and the two exemptions with it - there
 * is nothing left for them to be exempted from, and `isSyncedFromSheet` had no other reader.
 *
 * Inactive is still shown when a lead actually stores it: an import whose own Status column said so
 * writes the word, and a stored status is returned above, whatever it says.
 *
 * Mirrors `unsetStatusSql` and the `yetToConnect` clause in leadQueryService.js, which have to pick
 * out exactly the rows this prints that label on.
 */
function resolveLeadStatus(lead = {}, details = {}) {
  if (lead.projectDeleted || details.projectDeleted) return PROJECT_DELETED_STATUS;
  // Before everything else, occasions included: an occasion nobody has been given is no more being
  // worked than an ordinary lead is. See `UNASSIGNED_STATUS`.
  if (isUnassignedLead(lead, details)) return UNASSIGNED_STATUS;
  if (isOccasionLead(lead, details)) {
    return String(occasionValue(lead, details, "occasionStatus") || "").trim() || YET_TO_CONNECT_STATUS;
  }
  const stored = String(details.leadStatus || lead.leadStatus || lead.status || "").trim();
  return stored || YET_TO_CONNECT_STATUS;
}

// Attempts counted against this occasion rather than against the lead - so a client rung three
// times about last year's shoot starts this one at zero.
function resolveLeadCnaSequence(lead = {}, details = {}) {
  const raw = isOccasionLead(lead, details)
    ? occasionValue(lead, details, "occasionCnaSequence")
    : details.cnaSequence ?? lead.cnaSequence;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * A status change written into a record the way the server is about to store it.
 *
 * Both halves, always. `leadStatus` and `cnaSequence` are what the request names - the server reads
 * those to know what changed, whichever table it ends up writing to - and on an occasion the same
 * values are echoed onto the occasion's own fields, because that is where `resolveLeadStatus` and
 * `resolveLeadCnaSequence` read them back from. Without the echo the pill would light up on the
 * press and go out again the moment the reply arrived carrying the lead's untouched status.
 *
 * `record` may be a flat table row or either half of a record; the occasion fields are carried on
 * all of them, which is why the same object is passed for both arguments below.
 */
function leadStatusPatch(record, status, cnaSequence) {
  const counted = cnaSequence === undefined ? {} : { cnaSequence };
  const patch = { leadStatus: status, status, ...counted };
  if (!isOccasionLead(record, record)) return patch;
  return {
    ...patch,
    occasionStatus: status,
    ...(cnaSequence === undefined ? {} : { occasionCnaSequence: cnaSequence }),
  };
}

/**
 * One detail edit, echoed onto the occasion's own copy of the same field.
 *
 * `{}` when the lead has no occasion open, or when the field is not one an occasion owns, so every
 * caller can spread it unconditionally. Needed because the three fields an occasion owns are read
 * back off the occasion: an edit written only under its ordinary name would be sent to the server
 * correctly and then vanish from the screen, because that is not where the screen looks.
 */
function occasionEcho(record, key, value) {
  if (!isOccasionLead(record, record)) return {};
  if (key === "leadStatus") return { occasionStatus: value };
  if (key === "nextFollowUpDate") return { occasionNextFollowUpDate: value };
  if (key === "nextFollowUpTime") return { occasionNextFollowUpTime: value };
  return {};
}

/**
 * What a status change to Invalid, Rejected or Converted takes with it.
 *
 * A lead being turned down is not being chased, so it has no next call to book - and the popup
 * takes the two fields off the form when one of those is chosen. Hiding them is not enough on its
 * own: a lead that already carried a date would keep it, unseen, and turn up in somebody's Pending
 * Followups the next morning under a status that says the conversation is over. So the fields are
 * cleared by the same press that hides them.
 *
 * The occasion's own copies go too. An occasion lead's follow-up is read off the occasion rather
 * than off the lead - see `occasionEcho` - so clearing only the ordinary pair would leave the date
 * that the Newborns and Birthdays tabs actually count.
 *
 * Add Lead applies the same rule in `updateForm`, against a form that has no occasion to echo to.
 */
function followUpClearedBy(record, key, value) {
  if (key !== "leadStatus" || !dropsNextFollowUp(value, record?.vertical)) return {};
  return {
    nextFollowUpDate: "",
    nextFollowUpTime: "",
    ...occasionEcho(record, "nextFollowUpDate", ""),
    ...occasionEcho(record, "nextFollowUpTime", ""),
  };
}

// The follow-up booked for this occasion, which is what the Pending Followups tabs count it under.
function resolveLeadFollowUp(lead = {}, details = {}, key) {
  if (isOccasionLead(lead, details)) {
    const occasionKey = key === "nextFollowUpDate" ? "occasionNextFollowUpDate" : "occasionNextFollowUpTime";
    return String(occasionValue(lead, details, occasionKey) || "");
  }
  return details[key] || lead[key] || "";
}

/*
 * Each status names its own border as well as its fill.
 *
 * The button carries a bare `border`, which sets a width and leaves the colour to `currentColor` -
 * and the text on a chosen status is white, so the selected pill drew a white ring around itself.
 * Invisible on a white page, and on a dark one a bright outline around the blue. Naming the border
 * the same colour as the fill is what makes a chosen status read as one solid shape.
 */
const LEAD_STATUS_OPTIONS = [
  { value: "CNA", className: "bg-black text-white border-black" },
  { value: "Invalid", className: "bg-[#8f9097] text-white border-[#8f9097]" },
  { value: "Rejected", className: "bg-[#ff3b3b] text-white border-[#ff3b3b]" },
  { value: "Interested", className: "bg-[#0b60ff] text-white border-[#0b60ff]" },
  { value: "Followup", className: "bg-[#ff8a1e] text-white border-[#ff8a1e]" },
  { value: "Converted", className: "bg-[#00973e] text-white border-[#00973e]" },
  { value: CONVERTED_AND_FOLLOWUP_STATUS, className: "bg-[#10b981] text-white border-[#10b981]" },
];

/*
 * The order the **board's** columns stand in, which is the pipeline's own: a lead nobody owns, one
 * not yet rung, the two states it is worked in, then the ways it ends.
 *
 * Deliberately not the order of `LEAD_STATUS_OPTIONS` above, and the list above is deliberately not
 * reordered to match: that one is the order the **pills** offer a status in, inside the lead popup
 * and the info panel, and it is read by people choosing one rather than by somebody reading a
 * pipeline left to right. Two different questions, two orders.
 *
 * A status missing from this list is **not** dropped - it falls in after the ones named, which is
 * what keeps a status added to the module later from quietly having no column. A status named here
 * that the vertical does not offer simply does not appear; `Converted & Followup` is Qua Qua's alone.
 */
const BOARD_STATUS_ORDER = CRM_BOARD_STATUS_ORDER;

/** The vertical's statuses in the board's order, with anything unnamed kept at the end. */
function boardStatusOptions(vertical) {
  const options = leadStatusOptionsForVertical(vertical);
  const rank = (option) => {
    const at = BOARD_STATUS_ORDER.indexOf(option.value);
    return at === -1 ? BOARD_STATUS_ORDER.length : at;
  };
  // `sort` is stable, so the unnamed ones keep the order the module lists them in.
  return [...options].sort((a, b) => rank(a) - rank(b));
}

function leadStatusOptionsForVertical(vertical) {
  if (normalizeVertical(vertical) === CONVERTED_AND_FOLLOWUP_VERTICAL) return LEAD_STATUS_OPTIONS;
  return LEAD_STATUS_OPTIONS.filter((option) => option.value !== CONVERTED_AND_FOLLOWUP_STATUS);
}

/*
 * What the Status column reads on the Calls board, and the only three values it can hold.
 *
 * Not a lead's statuses at all: a call is not interested or converted, it either connected or it
 * did not. The same three words the last three tabs are named with, so the filter and the tabs are
 * two ways of asking the same question - and `CALL_STATUS_SQL` on the server prints exactly these.
 */
const CALL_STATUS_OPTIONS = ["Connected", "Not Connected", "Never Attended"];

/*
 * There is no `leadStatusFilterOptionsForBoard` any more, and that is the point.
 *
 * It built the Status filter's menu from the board's whole status list, as the fallback shown while
 * the column's real values were being fetched and if they never came. A single-select could live
 * with that - a stale menu offering a value no row has just empties the board, and the reader sees
 * it. A multi-select cannot: Select all against the fallback chose statuses the answer did not have,
 * the list then shrank under them, and those choices went on filtering from off the list with no
 * control on screen that could reach them. The filter now offers what the column holds and nothing
 * else - `columnFilterValues`, with an empty menu under "Loading..." while it is on its way.
 */

// How often the browser asks whether lead data changed. This is a tiny COUNT/MAX query,
// not the full lead list, so it can run often without cost.
const LEAD_VERSION_POLL_MS = 4000;
// Rows fetched per request; scrolling appends further pages.
const LEAD_PAGE_SIZE = 100;
// Rows per request when re-reading what is already on screen. The API caps a page at 500.
const LEAD_REFRESH_CHUNK = 500;

// The Info panel is split in two: the lead's own fields, and the notes and status kept
// against it. The info tab is read-only and follows the CRM module field order.
const INFO_PANEL_TABS = [
  { id: "info", label: "Info" },
  { id: "remarks", label: "Remarks & Status" },
];

// Rows per import request, and how many of those requests may be in flight at once. The
// product is the ceiling on rows buffered in memory; both are sized so a 5,000-row file
// is a handful of overlapping round-trips rather than ten sequential ones.
const CSV_CHUNK_ROWS = 2000;
const CSV_MAX_IN_FLIGHT = 3;

// The finished import, as label/value rows. Anything that did not happen is left out, so a
// clean import shows two lines rather than a column of zeroes.
export function importSummaryRows(summary) {
  /*
   * Read defensively, because this renders a finished import directly into the dialog.
   *
   * `summary.verticals` was `Object.entries`-d as it stood, and the producer was writing the same
   * tally under `branches` - so every completed CSV import threw "Cannot convert undefined or null
   * to object" and took the whole CRM page down with it, after the leads had been written. The two
   * names agree now; these defaults are so that a shape that drifts again costs a missing line
   * rather than the board.
   */
  const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const rows = [
    { label: "Leads imported", value: `${count(summary?.imported).toLocaleString()} of ${count(summary?.rows).toLocaleString()}` },
  ];

  // Where the rows landed. A file's own vertical column wins over the table picked in the
  // dialog, so this is worth showing even when only one vertical is involved.
  const spread = Object.entries(summary?.verticals || {});
  if (spread.length) {
    rows.push({
      label: spread.length === 1 ? "System table" : "System tables",
      value: spread.map(([name, count]) => `${name}: ${count.toLocaleString()}`).join(", "),
    });
  } else {
    rows.push({ label: "System table", value: summary?.table || "—" });
  }

  if (count(summary?.skipped)) rows.push({ label: "Blank rows skipped", value: count(summary.skipped).toLocaleString() });
  // Apart from the blank rows on purpose: a row held back because its vertical already holds that
  // number is somebody worth looking at, and folding it into "skipped" hides exactly that.
  if (count(summary?.duplicates)) {
    rows.push({ label: "Already on this number", value: count(summary.duplicates).toLocaleString(), tone: "warn" });
  }
  if (count(summary?.overwritten)) rows.push({ label: "Overwrote an existing lead", value: count(summary.overwritten).toLocaleString() });
  if (count(summary?.failed)) rows.push({ label: "Failed", value: count(summary.failed).toLocaleString(), tone: "warn" });
  return rows;
}

// One logged change as a title and a detail, matching how the log reads on screen:
// "Lead Status Changed | Followup → Converted".
const ACTIVITY_TITLES = {
  CREATED: "Lead Created",
  DELETED: "Lead Deleted",
  REMARK_ADDED: "Remarks Added",
  STATUS_CHANGED: "Lead Status Changed",
  FOLLOWUP_CHANGED: "Follow-up Updated",
  ATTACHMENTS_CHANGED: "Attachments Updated",
  SHOOTS_CHANGED: "Shoot Details Updated",
  // That a conversation happened, not what was said in it. The words live in the WhatsApp Chat
  // tab; the log is the record of contact, the same as a status change or a follow-up date.
  WHATSAPP_SENT: "WhatsApp Message Sent",
  WHATSAPP_RECEIVED: "WhatsApp Message Received",
  WHATSAPP_LINKED: "WhatsApp Linked",
  WHATSAPP_LOGGED_OUT: "WhatsApp Logged Out",
};

// The lead popup's log tabs. The same four on every vertical - a conversion is a conversion
// whether the lead is a wedding, a baby shoot or a corporate enquiry.

/*
 * The views that live behind the ⋮ at the end of the tab strip rather than on it.
 *
 * Six tabs already overflow a laptop and scroll on a phone; a seventh would push the strip past
 * being scannable. These open in the same panel - the ⋮ is where a view is chosen, not a different
 * place for it to appear.
 */
const LEAD_POPUP_MENU_TABS = [
  { id: "transcripts", label: "Transcripts" },
  { id: "ai", label: "AI Assistant" },
];

const LEAD_POPUP_TABS = [
  { id: "remarks", label: "Remarks" },
  { id: "activity", label: "Activity Logs" },
  { id: "call", label: "Call Logs" },
  { id: "converted", label: "Converted History" },
  { id: "whatsapp", label: "WhatsApp Chat" },
];

/*
 * The dot beside the WhatsApp Chat tab, in the module's own colours.
 *
 * Green and red are the two this tab has always used: linked, and not linked. Grey is the
 * third state - an administrator has switched WhatsApp off for the studio - and it is grey
 * rather than red because red asks the CRM to do something about it and there is nothing they
 * can do. It is the same grey the User Settings table uses for a row that is not linked and is
 * not waiting on anything either.
 */
const WHATSAPP_DOT = {
  connected: "bg-emerald-500",
  disconnected: "bg-red-500",
  blocked: "bg-slate-300",
};

const WHATSAPP_DOT_LABEL = {
  connected: "WhatsApp connected",
  disconnected: "WhatsApp not connected",
  blocked: "WhatsApp switched off by an administrator",
};

function formatConvertedAmount(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function activityTitle(entry) {
  if (ACTIVITY_TITLES[entry.action]) return ACTIVITY_TITLES[entry.action];
  const label = entry.fieldLabel || entry.field || "Lead";
  return `${label} Changed`;
}

function activityDetail(entry) {
  const from = String(entry.fromValue || "").trim();
  const to = String(entry.toValue || "").trim();
  if (entry.action === "REMARK_ADDED") return to;
  if (entry.action === "CREATED" || entry.action === "DELETED") return "";
  // Follow-up and other field edits read as a transition; a first value has nothing to
  // transition from, so it is shown on its own.
  if (from && to) return `${from} → ${to}`;
  if (to) return to;
  if (from) return "Cleared";
  return "";
}

// 12-hour clock, e.g. "06 Aug 2026 06:40 pm".

/*
 * The colour a call type carries.
 *
 * Direction is the first thing anyone scanning this tab wants - who rang whom, and did it connect.
 * Missed is the one that has to catch the eye, so it is the only one in red; the rest are quiet.
 * Anything Callyzer sends that is not one of these keeps the neutral slate.
 */
const CALL_TYPE_TONES = {
  incoming: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  outgoing: "bg-blue-50 text-blue-700 ring-blue-200",
  missed: "bg-red-50 text-red-700 ring-red-200",
  rejected: "bg-amber-50 text-amber-700 ring-amber-200",
};

function callTypeTone(callType) {
  return CALL_TYPE_TONES[String(callType || "").trim().toLowerCase()] || "bg-slate-100 text-slate-600 ring-slate-200";
}

// A bare day, in either shape the CRM stores. Carries no time, so it can only be a date.
const DATE_ONLY_PATTERN = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/;

/**
 * The time of day a lead was added.
 *
 * "Added Time" was showing a date because that is literally what was written into the column
 * - Add Lead stamped it with toLocaleDateString, and sheet imports put whatever their own
 * column held. A stored time is used when there is one; otherwise the row's insert timestamp
 * answers the question the column is actually asking.
 */
function formatAddedTime(lead) {
  const stored = String(lead?.addedTime || "").trim();
  if (stored && !DATE_ONLY_PATTERN.test(stored)) {
    /*
     * A clock time, put onto the 12-hour clock the rest of the CRM reads on.
     *
     * This used to return whatever was stored, on the grounds that a clock time is already a clock
     * time - which was true of a lead, because a lead stores "09:45 pm". It was not true of a call:
     * Callyzer sends "17:49:41" and the Calls board's Call Time column showed "17:49", the one
     * column in the application on a 24-hour clock, sitting beside leads reading "10:08 am".
     *
     * `toTwelveHourClock` answers for both shapes and normalises either, so a value that arrived
     * with a meridiem and one that arrived without read identically in the same column.
     */
    const clock = toTwelveHourClock(stored);
    if (clock) return clock;
    const parsed = new Date(stored);
    if (!Number.isNaN(parsed.getTime())) return formatClockTime(parsed);
  }
  const created = lead?.createdAt ? new Date(lead.createdAt) : null;
  return created && !Number.isNaN(created.getTime()) ? formatClockTime(created) : "—";
}

function formatClockTime(when) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ACTIVITY_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h12" })
    .format(when)
    .toLowerCase();
}

// Blank rows are dropped by the server and never become leads, so they have to count as
// handled - otherwise a file with one empty line sticks at 99% forever.
function importProcessedRows(progress) {
  return (progress?.imported || 0) + (progress?.failed || 0) + (progress?.skipped || 0);
}

function importPercentComplete(progress) {
  if (!progress?.rows) return 0;
  return Math.min(100, Math.floor((importProcessedRows(progress) / progress.rows) * 100));
}

// Projected from the throughput measured so far, against the total the reader currently
// believes in - the exact count once the file has been read, a projection from bytes
// consumed before that.
function importTimeRemaining(progress) {
  const done = importProcessedRows(progress);
  if (!progress?.startedAt || !done) return "calculating…";
  const remaining = Math.max(0, progress.rows - done);
  if (!remaining) return "0 seconds";
  const elapsed = (Date.now() - progress.startedAt) / 1000;
  const seconds = Math.max(1, Math.round((elapsed / done) * remaining));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

const CRM_TABLES = {
  "Dum Dum": {
    id: "crm-table-dum-dum",
    board: "Dum Dum",
    label: "CRM - Dum Dum",
  },
  "Qua Qua": {
    id: "crm-table-qua-qua",
    board: "Qua Qua",
    label: "CRM - Qua Qua",
  },
  Corp: {
    id: "crm-table-corp",
    board: "Corp",
    label: "CRM - Corp",
  },
  // The Calls board has a table id of its own so its column widths and hidden columns are
  // remembered apart from the verticals'. It is deliberately not offered as an import target -
  // a call arrives from Callyzer, never from a spreadsheet.
  Calls: {
    id: "crm-table-calls",
    board: CALLS_BOARD,
    label: "CRM - Calls",
  },
};

function getTableColumns(board) {
  return boardTableColumns[board] || boardTableColumns["Dum Dum"];
}

function getMergedColumns(board, customFieldsByVertical = {}) {
  const baseColumns = getTableColumns(board);
  const extraColumns = (customFieldsByVertical[board] || []).map((column) => ({
    id: column.key,
    label: column.label,
    // Table Settings fields live inside one JSON column, so the server has nothing to order
    // by; offering an arrow that quietly sorted by enquiry id instead would be worse.
    sortable: false,
  }));
  return [...baseColumns, ...extraColumns];
}

// What a field is called, for a message about it. The table's own column definitions answer
// first - they are what the user is looking at - and the Info panel's extra names fill the gaps.
// Fields the forms write under a different key from the column that shows them.
const EDIT_FIELD_LABELS = {
  leadStatus: "Lead Status",
  shoots: "Shoot Details",
  remarkEntries: "Remarks",
  attachments: "Attachments",
  nextFollowUpTime: "Next Follow-up Time",
};

function fieldLabelFor(key, board, customFieldsByVertical = {}) {
  const column = getMergedColumns(board, customFieldsByVertical).find((item) => item.id === key);
  return column?.label || INFO_FIELD_LABELS[key] || EDIT_FIELD_LABELS[key] || "";
}

// Names for the fields the Info panel shows that are not columns on the table. Without
// these the panel printed the raw key - "addedTimestamp", "vertical" - as its heading.
const INFO_FIELD_LABELS = {
  id: "Enquiry ID",
  enquiryDate: "Enquiry Date",
  name: "Enquiry Name",
  addedTime: "Added Time",
  addedTimestamp: "Added Time",
  phone: "Phone Number",
  status: "Status",
  vertical: "Verticals",
  crm: "CRM",
  assignedBranch: "Nearest Branch",
  referredFrom: "Referred From",
  offerType: "Offer Type",
  campaignName: "Campaign Name",
  adsetName: "Adset Name",
  adName: "Ad Name",
  preferredBudget: "Preferred Budget",
  estimatedValue: "Estimated Value",
  city: "City",
  state: "State",
};

function getInfoFieldsForBoard(board, customFieldsByVertical = {}) {
  const columns = getMergedColumns(board, customFieldsByVertical);
  /*
   * A call is read through its own columns and nothing else.
   *
   * The list below is a lead's: the vertical it is on, the branch it was assigned to, the campaign
   * that brought it in, the budget the client named. A call has none of those - answering "Verticals:
   * Dum Dum" over a row whose entire purpose is that nobody has said which vertical it is, which is
   * what `resolveLeadVertical` folds a blank onto, is worse than answering nothing. And `id` is that
   * board's row key rather than an identifier anybody reads; the Enquiry ID is a column of its own.
   */
  if (board === CALLS_BOARD) {
    return columns.map((column) => ({ key: column.id, label: column.label }));
  }
  const keys = [
    "id",
    "enquiryDate",
    "name",
    "addedTimestamp",
    "phone",
    "status",
    "vertical",
    "crm",
    "assignedBranch",
    "referredFrom",
    "offerType",
    "campaignName",
    "adsetName",
    "adName",
    "preferredBudget",
    // Beside the budget it sits beside on the form: what the client said, then what the studio
    // reckons.
    "estimatedValue",
    "city",
    "state",
    ...columns.map((column) => column.id),
  ];

  const seen = new Set();
  return keys.filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((key) => {
    const column = columns.find((item) => item.id === key);
    return { key, label: column?.label || INFO_FIELD_LABELS[key] || key };
  });
}

function getDynamicInfoFieldsForVertical(board, customFieldsByVertical) {
  return (customFieldsByVertical[board] || []).map((column) => ({ key: column.key, label: column.label }));
}

// The starting answers for a vertical's fields: the choice the builder ticked as Default,
// for the fields that have one.
function customFieldDefaults(fields = []) {
  const defaults = {};
  for (const field of fields || []) {
    const value = defaultOptionValue(field);
    if (value) defaults[field.key] = value;
  }
  return defaults;
}

// Whether a key names a Table Settings field on any vertical. Checked across all of them
// rather than one, because an edit is made against the lead's own vertical, which is not
// necessarily the one the table is currently showing.
function isCustomFieldKey(key, customFieldsByVertical = {}) {
  return Object.values(customFieldsByVertical).some((fields) => (fields || []).some((field) => field.key === key));
}

// Keeps only the answers belonging to fields the vertical actually has. A lead saved after
// the vertical was switched mid-entry would otherwise carry answers to another form's
// questions, which nothing would ever display.
function pickCustomFieldValues(values = {}, fields = []) {
  const picked = {};
  for (const field of fields || []) {
    const value = values?.[field.key];
    if (value !== undefined && value !== null && String(value) !== "") picked[field.key] = String(value);
  }
  return picked;
}

// The Table Settings response is a flat list across every vertical; the page reads it keyed
// by vertical, in the order the builder left the fields in.
function groupCustomFieldsByBranch(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((grouped, row) => {
    if (!row?.vertical || !row?.key || !row?.label) return grouped;
    if (!grouped[row.vertical]) grouped[row.vertical] = [];
    grouped[row.vertical].push({
      key: row.key,
      label: row.label,
      fieldType: row.fieldType || "text",
      placeholder: row.placeholder || "",
      required: Boolean(row.required),
      options: Array.isArray(row.options) ? row.options : [],
    });
    return grouped;
  }, {});
}


/**
 * What kind of control a column's filter should offer.
 *
 * Every filter stays a text box - the server matches them as text, and a partial like
 * "2026-08" or "Erode" is often exactly what is wanted. The kind only decides what is
 * offered *alongside* the typing: a calendar for a date, a list of times for a time, a list
 * of the known values for a closed set.
 *
 * Columns not named here fall through to plain text, so a new column needs no entry to work.
 */
const DATE_FILTER_COLUMNS = [
  "enquiryDate", "dateOfBirthOrEdod",
  "eventPlannedDate", "lastConvertedDate", "lastFollowUpDate", "nextFollowUpDate",
];
/*
 * Both of the names this column goes by, and both filtered as a time.
 *
 * Dum Dum calls it "Added Time" and the other two "Added Timestamp", but all three read the same
 * `added_time` column and all three render it through `formatAddedTime` - which produces a clock
 * time, "10:08 am", because that is what the column holds. `addedTimestamp` was listed as a date,
 * so those two verticals offered a calendar for a value that is never a date and the filter could
 * not match anything.
 */
const TIME_FILTER_COLUMNS = ["addedTime", "addedTimestamp"];

function columnFilterKind(columnId) {
  if (columnId === "status") return "status";
  if (DATE_FILTER_COLUMNS.includes(columnId)) return "date";
  if (TIME_FILTER_COLUMNS.includes(columnId)) return "time";
  // `crm` has choices too; they are fetched rather than written down, so they are not in the table
  // above and the column is named here instead.
  if (columnId === "crm" || columnId === "assignedBranch" || CHOICE_FILTER_OPTIONS[columnId]) return "choice";
  return "text";
}

function getCrmTableId(board) {
  return CRM_TABLES[board]?.id || CRM_TABLES["Dum Dum"].id;
}

/*
 * The tables a CSV may be imported into: the three verticals, and not Calls.
 *
 * A call reaches the CRM from Callyzer and from nowhere else. Offering Calls here would let a
 * spreadsheet write rows onto a board whose whole meaning is "Callyzer sent this and nobody has
 * placed it yet" - and every one of them would carry `vertical: "Calls"`, which is not a vertical
 * any part of this application can read.
 */
const IMPORT_TABLE_NAMES = Object.keys(CRM_TABLES).filter((name) => name !== CALLS_BOARD);

// Where Import opens: the board being read, unless that board cannot be imported into.
const importTableFor = (board) => (IMPORT_TABLE_NAMES.includes(board) ? board : "Dum Dum");

/**
 * The first shoot row on a lead with anything in it.
 *
 * Shoot Type, the venue, the district and the event date are entered as rows in Shoot Details
 * and stored together in `shoots` - they are not columns of their own. The table's Shoot Type,
 * Location and event-date columns therefore have nothing to read unless they are told to look
 * here, which is why a lead could be filled in fully and still show a row of dashes.
 *
 * The first filled row is the one that answers for the lead: a lead's remaining rows are the
 * later shoots of the same booking, and the column has room for one value. The blank row the
 * table keeps open for the next entry is skipped.
 */
function firstFilledShoot(lead) {
  const shoots = lead?.shoots || lead?.details?.shoots || [];
  if (!Array.isArray(shoots)) return null;
  return shoots.find((shoot) => Object.values(shoot || {}).some((value) => String(value || "").trim())) || null;
}

function getLeadCellValue(lead, key) {
  const details = lead ? lead.details || {} : {};
  // Read once rather than per case: several columns answer from the same row.
  const shoot = firstFilledShoot(lead) || {};
  const shootPlace = splitDistrictState(shoot.districtState);
  switch (key) {
    case "enquiryDate":
      /*
       * The same day every tab on this board is read from, so the cell and the tab cannot disagree.
       *
       * It listed its four sources and stopped, printing "—" for a lead none of them dated. The
       * server does not stop there - `COLUMN_SQL.enquiryDate` ends at the row's own insert
       * timestamp - so a lead with a blank Date column was still dated by the tabs, and sat in a
       * day's New Leads with nothing on screen saying which day it was counted as. `leadArrivalDay`
       * is that whole chain, insert timestamp included, and is what the Status pill already reads.
       */
      return leadArrivalDay(lead || {}, details) || "—";
    case "addedTime":
    case "addedTimestamp":
      return formatAddedTime(lead);
    case "status":
      return resolveLeadStatus(lead || {}, details);
    case "assignedBranch":
      return lead?.assignedBranch || details?.assignedBranch || "—";
    case "campaignName":
      return lead?.campaignName || details?.campaignName || "—";
    case "adsetName":
      return lead?.adsetName || details?.adsetName || "—";
    case "adName":
      return lead?.adName || details?.adName || "—";
    case "preferredBudget":
      return lead?.preferredBudget || details?.preferredBudget || lead?.budgetExpected || "—";
    case "estimatedValue":
      return lead?.estimatedValue || details?.estimatedValue || "—";
    case "city":
      return lead?.city || details?.city || shootPlace?.city || "—";
    case "state":
      return lead?.state || details?.state || shootPlace?.state || "—";
    case "eventPlannedType":
      return lead?.eventPlannedType || details?.eventPlannedType || lead?.shootType || details?.shootType || shoot.shootType || "—";
    case "eventPlannedDate":
      return lead?.eventPlannedDate || details?.eventPlannedDate || shoot.date || details?.nextFollowUpDate || "—";
    case "contactNumber":
      return lead?.contactNumber || lead?.phone || details?.contactNumber || "—";
    case "month":
      return lead?.month || details?.month || "—";
    case "ihOh":
      return lead?.ihOh || lead?.ih_oh || details?.ihOh || details?.ih_oh || "—";
    case "lastFollowUpDate":
      return details?.lastFollowUpDate || lead?.lastFollowUpDate || "—";
    case "nextFollowUpDate":
      return details?.nextFollowUpDate || lead?.nextFollowUpDate || "—";
    case "lastConvertedDate":
      return lead?.lastConvertedDate || details?.lastConvertedDate || "—";
    // Entered as a shoot row rather than as a column of its own, so the row answers when
    // the flat column is empty - which it is for every lead filled in through the CRM.
    case "shootType":
      return lead?.shootType || details?.shootType || shoot.shootType || "—";
    case "location":
      return lead?.location || details?.location || shoot.venue || shoot.districtState || "—";
    case "time":
      return lead?.time || details?.time || shoot.time || "—";
    case "shootId":
      return lead?.shootId || details?.shootId || details?.shoots?.[0]?.shootId || "—";
    case "babyOrMotherName":
      return lead?.babyOrMotherName || lead?.groomName || details?.babyOrMotherName || details?.groomName || "—";
    case "dateOfBirthOrEdod":
      return lead?.dateOfBirthOrEdod || lead?.brideLocation || details?.dateOfBirthOrEdod || details?.brideLocation || "—";
    case "companyName":
      return lead?.companyName || details?.companyName || "—";
    case "primaryDecisionMaker":
      return lead?.primaryDecisionMaker || details?.primaryDecisionMaker || "—";
    case "alternateMobileNumber":
      return lead?.alternateMobileNumber || details?.alternateMobileNumber || "—";
    case "officialEmailId":
      return lead?.officialEmailId || details?.officialEmailId || "—";
    case "companyWebsite":
      return lead?.companyWebsite || details?.companyWebsite || "—";
    case "companyType":
      return lead?.companyType || details?.companyType || "—";
    case "companySize":
      return lead?.companySize || details?.companySize || "—";
    case "branches":
      return lead?.branches || details?.branches || "—";
    case "projectType":
      return lead?.projectType || details?.projectType || "—";
    case "shootCity":
      return lead?.shootCity || details?.shootCity || shootPlace?.city || "—";
    case "expectedBudget":
      return lead?.expectedBudget || details?.expectedBudget || "—";
    case "competitions":
      return lead?.competitions || details?.competitions || "—";
    case "remarks":
      return remarkSummary(leadRemarkEntries(details?.remarkEntries, lead?.remarkEntries, details?.remarks, lead?.remarks)) || "—";
    case "source":
      return leadSourceLabel(lead, details);
    default:
      return lead?.[key] || details?.[key] || "—";
  }
}

function normalizeLeadStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "follow-up") return "Followup";
  if (status === "followup") return "Followup";
  // The label was renamed from "Followup & Converted"; sheets and rows written before the
  // rename still carry the old spelling, so both orders fold onto the current label.
  if (["followup & converted", "followup and converted", "followup-converted", "converted & followup", "converted and followup", "converted-followup"].includes(status)) return CONVERTED_AND_FOLLOWUP_STATUS;
  if (status === "in review") return "CNA";
  if (status === "cna") return "CNA";
  if (status === "invalid") return "Invalid";
  if (status === "rejected") return "Rejected";
  if (status === "converted") return "Converted";
  if (status === "interested") return "Interested";
  if (status === "yet to connect" || status === "yettoconnect") return YET_TO_CONNECT_STATUS;
  if (status === "unassigned") return UNASSIGNED_STATUS;
  if (status === "project deleted") return PROJECT_DELETED_STATUS;
  if (status === "inactive") return INACTIVE_STATUS;
  return value || "—";
}

/**
 * The status as it is printed, with CNA's number appended when there is one.
 *
 * Kept as one function because the number now shows in three places - the Status cell, the
 * status pills and the column filter - and a lead reading "CNA (3)" in the table but "CNA"
 * in its own panel would look like two different statuses.
 */
function statusCellLabel(value, cnaSequence = 0) {
  const status = normalizeLeadStatus(value);
  const sequence = Number(cnaSequence);
  return status === "CNA" && Number.isFinite(sequence) && sequence > 0 ? `CNA (${sequence})` : status;
}

function statusAppearance(value) {
  const status = normalizeLeadStatus(value);
  switch (status) {
    case "CNA":
      return { dot: "bg-black", text: "text-slate-600", border: "border-slate-300" };
    case "Invalid":
      return { dot: "bg-[#8f9097]", text: "text-slate-600", border: "border-slate-300" };
    case "Rejected":
      return { dot: "bg-[#ff3b3b]", text: "text-slate-600", border: "border-slate-300" };
    case "Interested":
      return { dot: "bg-[#0b60ff]", text: "text-slate-600", border: "border-slate-300" };
    case "Followup":
      return { dot: "bg-[#ff8a1e]", text: "text-slate-600", border: "border-slate-300" };
    case "Converted":
      return { dot: "bg-[#00973e]", text: "text-slate-600", border: "border-slate-300" };
    case CONVERTED_AND_FOLLOWUP_STATUS:
      return { dot: "bg-[#10b981]", text: "text-slate-600", border: "border-slate-300" };
    case UNASSIGNED_STATUS:
      // Violet, which no other status uses. A lead nobody owns is not a state of the work - it is
      // the absence of anybody doing it - so it reads as its own thing rather than as a shade of
      // the greys the untouched statuses wear.
      return { dot: "bg-[#7c3aed]", text: "text-slate-600", border: "border-slate-300" };
    case YET_TO_CONNECT_STATUS:
      return { dot: "bg-[#c3c7ce]", text: "text-slate-600", border: "border-slate-300" };
    case PROJECT_DELETED_STATUS:
      // Brown, which no other status wears: the lead's own work is done, its booking is in the bin.
      return { dot: "bg-[#92400e]", text: "text-slate-600", border: "border-slate-300" };
    case INACTIVE_STATUS:
      return { dot: "bg-[#6b7280]", text: "text-slate-600", border: "border-slate-300" };
    /*
     * The Calls board's three, which are outcomes of a call rather than statuses of a lead.
     *
     * Green for a call that connected, red for one the client made that nobody picked up - the
     * colours the rest of this list already uses for "it went well" and "it did not" - and grey in
     * between for a call that simply did not connect, which is neither.
     */
    case "Connected":
      return { dot: "bg-[#00973e]", text: "text-slate-600", border: "border-slate-300" };
    case "Never Attended":
      return { dot: "bg-[#ff3b3b]", text: "text-slate-600", border: "border-slate-300" };
    case "Not Connected":
      return { dot: "bg-[#8f9097]", text: "text-slate-600", border: "border-slate-300" };
    default:
      return { dot: "bg-slate-400", text: "text-slate-600", border: "border-slate-300" };
  }
}

/**
 * The tabs each vertical shows, in the order they are read.
 *
 * Every vertical opens the same way and closes the same way: All, then the leads nobody has
 * spoken to yet, and last the ones that have been turned down. Between them each vertical cuts
 * the list the way it actually works - Dum Dum and Corp chase follow-ups, Qua Qua runs newborn
 * and birthday shoots and keeps those two categories among its own follow-up tabs.
 *
 * The two ends are the states rather than the dates: Yet to connect is where a lead starts and
 * Rejected is where one ends, so a reader moving left to right is moving through the lead's life.
 */
const FOLLOWUP_TABS = [
  { id: "pending", label: "Today Pending Followups" },
  { id: "yesterdayPending", label: "Yesterday Pending Followups" },
  { id: "overallPending", label: "Overall Pending Followups" },
];

// The two ends, on all three verticals. Neither is a vertical's own cut of the list - a lead
// nobody has called and a lead that has been turned down mean the same thing everywhere.
const OPENING_TABS = [
  { id: "all", label: "All" },
  /*
   * Not a status anybody sets: a lead with nothing against it reads as Yet to connect on the day it
   * arrived and as Inactive from the next day on - unless a Google Sheet link put it here, which
   * never ages out, or it is an occasion inside its window. That is what `resolveLeadStatus` above
   * works out for the Status column. This tab is that same rule asked as a question, so what it
   * lists is exactly the rows whose Status column reads Yet to connect.
   */
  { id: "yetToConnect", label: "Yet to connect" },
  /*
   * The leads nobody has been given, which is what their Status column reads.
   *
   * Beside Yet to connect because the two are the questions asked at the start of a lead's life: is
   * anybody on it, and has anybody spoken to it. They are a clean split - Unassigned wins over the
   * lead's own status, so a lead in one is never in the other - and All still holds both.
   *
   * The pending tabs after it are deliberately *not* split this way: they are cut by the status a
   * lead holds rather than by the label its column prints, so an unassigned lead at Followup still
   * appears under the call it owes. This tab says who owns it; those say what is due.
   */
  { id: "unassigned", label: "Unassigned" },
  { id: "new", label: "Today New Leads" },
];

const REJECTED_TAB = { id: "rejected", label: "Rejected" };

/*
 * The Calls board's own tabs, which cut a different thing entirely.
 *
 * Every tab above is a cut of a lead's *state* - has anyone spoken to it, is a follow-up due, was
 * it turned down. A call has no state: it happened, it went one way or the other, and either
 * somebody talked or nobody did. So these are cuts of the call itself, and the six of them are two
 * questions asked of one list.
 *
 * Which way it went:
 *   Incoming  the client rang - answered, missed or rejected alike.
 *   Outgoing  the studio rang.
 *
 * And what came of it:
 *   Connected      somebody actually talked, whichever way the call went.
 *   Not Connected  nobody did.
 *
 * There was a sixth, Never Attended - the calls the client made that nobody picked up. It was taken
 * out because it said almost nothing the board did not already say: every call in it was in Incoming
 * and in Not Connected too, so it was those two read together rather than a cut of its own, and it
 * left the strip carrying a tab that was never the shortest way to anything.
 *
 * The four that are left still overlap on purpose, and All is not the sum of them. A missed call is
 * in Incoming and in Not Connected at once, because both are true of it - these are ways of reading
 * one list, not boxes to sort it into. The counts on the labels say so: they add up to more than the
 * board holds, which is the honest answer.
 */
const CALL_TABS = [
  { id: "all", label: "All" },
  { id: "incoming", label: "Incoming" },
  { id: "outgoing", label: "Outgoing" },
  { id: "connected", label: "Connected" },
  { id: "notConnected", label: "Not Connected" },
];

const BOARD_TABS = {
  "Dum Dum": [
    ...OPENING_TABS,
    ...FOLLOWUP_TABS,
    REJECTED_TAB,
  ],
  Corp: [
    ...OPENING_TABS,
    ...FOLLOWUP_TABS,
    REJECTED_TAB,
  ],
  // Qua Qua keeps its two shoot categories between Today Pending and the rest of the
  // follow-up tabs, which is the order it was asked for.
  "Qua Qua": [
    ...OPENING_TABS,
    FOLLOWUP_TABS[0],
    { id: "newborns", label: "Newborns" },
    { id: "birthdays", label: "Birthdays" },
    FOLLOWUP_TABS[1],
    FOLLOWUP_TABS[2],
    REJECTED_TAB,
  ],
  /*
   * Calls is the phone, not a pipeline, so it is read by the call rather than by the lead.
   *
   * It used to carry one tab, Yet to connect, and that was the whole of the board: everything on it
   * was a Callyzer call nothing had named a vertical for, and a row left the moment somebody gave it
   * one. The board now holds every call Callyzer has delivered, for good - so "yet to connect" is no
   * longer what the rows have in common, and the useful cuts are the ones a call actually has.
   *
   * None of the lead tabs are here, and none of them could be. A follow-up is worked inside a
   * vertical by the people who own that board; Today New Leads slices by arrival day, which on a
   * board nobody works through would hide yesterday's unanswered call; and Rejected is a decision
   * made about a lead, which a call is not. Rejecting a caller is done in the Add Lead form, and the
   * lead it writes lands in its own vertical's Rejected tab.
   */
  Calls: CALL_TABS,
};

/*
 * No column filters, as one object rather than a fresh `{}` each time.
 *
 * `filters` is debounced into `appliedFilters`, and `appliedFilters` is what the load effect
 * refetches on - so two empty objects are two different values and clearing the box costs a second
 * query 400ms after the first. Sharing the reference makes the debounce that follows a clear a
 * no-op, which matters on a board where the tab counts alone are a pass over 125,000 rows.
 */
const NO_FILTERS = Object.freeze({});

/*
 * A count for every tab, all zero.
 *
 * Beside the tabs rather than inside the component, because it is the answer to "what does the
 * board show before the server has said anything" and the fallback for a reply that carries no
 * counts - and those were two different half-lists, each missing tabs the other had. A tab added
 * to BOARD_TABS and forgotten here still reads (0) rather than breaking, which is exactly why it
 * is worth having one list to add it to.
 */
const EMPTY_TAB_COUNTS = Object.freeze({
  all: 0, yetToConnect: 0, unassigned: 0, pending: 0, new: 0, today: 0, converted: 0, rejected: 0,
  yesterdayPending: 0, overallPending: 0, newborns: 0, birthdays: 0, cna: 0,
  // The Calls board's own, which the server counts in a pass of its own over the call log.
  incoming: 0, outgoing: 0, connected: 0, notConnected: 0,
});

function getTabsForBoard(board) {
  // Asked before `normalizeVertical`, which knows the three verticals' spellings and answers "" for
  // anything else - Calls included, which would send this to Dum Dum's tabs.
  if (board === CALLS_BOARD) return BOARD_TABS[CALLS_BOARD];
  return BOARD_TABS[normalizeVertical(board)] || BOARD_TABS["Dum Dum"];
}

// Relationship and Referred From are suggested from the lists in Settings -> Field Settings ->
// Quotation, read by `useLeadSuggestionLists` - the same two the Quotation Generator offers. They
// were arrays here, a second copy of the quotation's, that no studio could add to. Both fields stay
// typed-with-suggestions: anything not listed can still be typed straight in.

// Shoot Type and Offer Type are the studio's lists too, read by the same hook: Shoot Type is the
// lead's vertical's own shoots (Settings -> Fields -> Shoot Types, a tab per brand - the list the
// Quotation Generator's Add Shoot offers for that brand), Offer Type the `offer-types` list. There
// is no array here to stand in for either: an entry removed there is gone from the form.

// Columns whose values come from a known set. The list is a convenience on top of the text
// box, not a restriction - sheets and imports put their own spellings in these columns.
const CHOICE_FILTER_OPTIONS = {
  vertical: optionValues(verticalOptions),
  // Callyzer's four, and its own API validates deliveries as exactly these - so the filter offers
  // the whole set rather than whatever this studio's calls happen to have been so far.
  callType: ["Incoming", "Outgoing", "Missed", "Rejected"],
  // `assignedBranch` and `crm` are not here: both are fetched rather than written down - the
  // branches the studio maintains, and the Sales roster - so the page merges them in at render.
  // Shoot Type, Event Planned Type and Offer Type are lists the studio keeps in Settings → Fields.
  // `true` here means "a choice column" and nothing more: the arrays in this object are never read
  // as the choices either - `columnFilterKind` asks only whether a column is named - and every
  // choice filter offers whatever its rows actually hold (`columnValues`).
  shootType: true,
  eventPlannedType: true,
  offerType: true,
  ihOh: ["IH", "OH"],
};

const districtStateOptions = [
  "Chennai, Tamil Nadu",
  "Coimbatore, Tamil Nadu",
  "Erode, Tamil Nadu",
  "Kancheepuram, Tamil Nadu",
  "Madurai, Tamil Nadu",
  "Namakkal, Tamil Nadu",
  "Salem, Tamil Nadu",
  "Tiruppur, Tamil Nadu",
  "Tiruchirappalli, Tamil Nadu",
  "Thanjavur, Tamil Nadu",
  "Thoothukudi, Tamil Nadu",
  "Vellore, Tamil Nadu",
  "Bengaluru, Karnataka",
  "Bengaluru Urban, Karnataka",
  "Mysuru, Karnataka",
  "Dakshina Kannada, Karnataka",
  "Hyderabad, Telangana",
  "Warangal, Telangana",
  "Kolkata, West Bengal",
  "Mumbai, Maharashtra",
  "Pune, Maharashtra",
];

function leadFromRecord(record) {
  const lead = record?.lead || {};
  const details = record?.details || {};
  return {
    ...lead,
    vertical: resolveLeadVertical(lead, details),
    /*
     * Whether this is a call still waiting to be given a vertical.
     *
     * Carried on the flat row because `vertical` above has already answered Dum Dum for it -
     * `resolveLeadVertical` folds a blank vertical onto Dum Dum, which is right for the table cell
     * and destroys the very fact the Calls board turns on. Worked out from the record while both
     * halves are still here, so nothing downstream has to hold the raw record to ask.
     */
    unassignedCall: isUnassignedCall(lead, details),
    /*
     * That this row is a call rather than a lead.
     *
     * The same fact `unassignedCall` above carries - every call on the board is one nobody has
     * added, because adding the caller is what takes it off the board. Both are kept because they
     * are read for different reasons: what a double click does, and which board's fields the info
     * panel reads the row under.
     */
    callRow: isCallRecord(lead, details),
    leadStatus: resolveLeadStatus(lead, details),
    /*
     * The occasion this row is being worked for, carried across whole.
     *
     * The table row is this flat object, so without these the row would lose the fact that it has an
     * occasion open at all - and `resolveLeadStatus` would then read the lead's own status back off
     * it and print last year's shoot in the Status column.
     */
    occasionWindow: Boolean(lead.occasionWindow ?? details.occasionWindow),
    occasionKind: lead.occasionKind || details.occasionKind || "",
    occasionYear: lead.occasionYear || details.occasionYear || 0,
    occasionOn: lead.occasionOn || details.occasionOn || "",
    // `??` rather than `||`: this is also called with an already-flattened row as `lead`, and an
    // occasion whose status was just cleared has to stay cleared rather than fall through.
    occasionStatus: details.occasionStatus ?? lead.occasionStatus ?? "",
    occasionCnaSequence: details.occasionCnaSequence ?? lead.occasionCnaSequence ?? 0,
    occasionNextFollowUpDate: details.occasionNextFollowUpDate ?? lead.occasionNextFollowUpDate ?? "",
    occasionNextFollowUpTime: details.occasionNextFollowUpTime ?? lead.occasionNextFollowUpTime ?? "",
    // The attempt count is stored alongside the details, but the table row is handed this
    // flat object - without carrying it across, every row would read a bare "CNA" with no
    // number against it.
    cnaSequence: resolveLeadCnaSequence(lead, details),
    nextFollowUpDate: resolveLeadFollowUp(lead, details, "nextFollowUpDate"),
    nextFollowUpTime: resolveLeadFollowUp(lead, details, "nextFollowUpTime"),
    // Carried across for the same reason: Shoot Type, Location and the event date are entered
    // as shoot rows and stored with the details, but the table row only ever sees this flat
    // object. Without them every shoot-backed column read as an empty dash however much had
    // been filled in.
    shoots: details.shoots || lead.shoots || [],
    referredFrom: lead.referredFrom || details.referenceFrom || "",
    offerType: lead.offerType || details.offerType || details.shootType || "",
    contactRepeated: lead.contactRepeated || details.contactRepeated || details.referenceContact || "",
  };
}

function mergeLeadDisplayRecord(lead = {}, details = {}) {
  return {
    ...details,
    ...lead,
    vertical: resolveLeadVertical(lead, details),
    // The same two facts the table row carries, for the same reason: `vertical` above has already
    // folded a blank vertical onto Dum Dum. See `leadFromRecord`.
    unassignedCall: isUnassignedCall(lead, details),
    callRow: isCallRecord(lead, details),
    leadStatus: resolveLeadStatus(lead, details),
    // The same occasion fields the table row carries, for the same reason. See `leadFromRecord`.
    occasionWindow: Boolean(lead.occasionWindow ?? details.occasionWindow),
    occasionKind: lead.occasionKind || details.occasionKind || "",
    occasionYear: lead.occasionYear || details.occasionYear || 0,
    occasionOn: lead.occasionOn || details.occasionOn || "",
    occasionStatus: details.occasionStatus ?? lead.occasionStatus ?? "",
    occasionCnaSequence: details.occasionCnaSequence ?? lead.occasionCnaSequence ?? 0,
    occasionNextFollowUpDate: details.occasionNextFollowUpDate ?? lead.occasionNextFollowUpDate ?? "",
    occasionNextFollowUpTime: details.occasionNextFollowUpTime ?? lead.occasionNextFollowUpTime ?? "",
    addedTime: lead.addedTime || details.addedTime || "",
    createdDate: lead.createdDate || details.createdDate || "",
    lastFollowUpDate: details.lastFollowUpDate || lead.lastFollowUpDate || "",
    nextFollowUpDate: resolveLeadFollowUp(lead, details, "nextFollowUpDate"),
    nextFollowUpTime: resolveLeadFollowUp(lead, details, "nextFollowUpTime"),
    lastConvertedDate: details.lastConvertedDate || lead.lastConvertedDate || "",
    // Named explicitly rather than left to the spread order above, so the freshly saved count
    // in the details always wins over the copy carried on the lead.
    cnaSequence: resolveLeadCnaSequence(lead, details),
    remarks: details.remarks || lead.remarks || "",
    // Both columns, because a lead that came in from a sheet or a file has only the flat one.
    remarkEntries: leadRemarkEntries(details.remarkEntries, lead.remarkEntries, details.remarks, lead.remarks),
    attachments: details.attachments || lead.attachments || [],
    shoots: details.shoots || lead.shoots || [],
  };
}

/**
 * What the Source column shows.
 *
 * The lead's own source answers wherever it has one. It is the column the table filters, sorts
 * and exports on, so deriving the cell from anything else made it disagree with the filter box
 * sitting directly above it - and it is where every producer already writes what it is: "CSV
 * import" from a file, "Google sheet integration" from the sheet sync, "Callyzer" from the call
 * webhook, and whatever a file's own Source column said when it carried one.
 *
 * The group metadata below answered for every row before, and could not: it is rebuilt for each
 * import and never stored, so a table row - which carries no details at all - fell through to
 * "Manual entry leads" whatever it actually was. It still answers for a lead that has no source
 * of its own, where it is the only thing that knows.
 */
function leadSourceLabel(lead = {}, details = {}) {
  const stated = String(lead.source || details.source || "").trim();
  if (stated) return stated;
  const { type } = leadGroup(details, lead);
  if (type === "csv") return "Import CSV leads";
  if (type === "google-sheets") return "Google sheet integration";
  if (type === "callyzer") return "Callyzer";
  return "Manual entry leads";
}

function leadGroup(details = {}, lead = {}) {
  const groupType = String(details.groupType || lead.groupType || lead.sourceType || "").trim().toLowerCase();
  const groupName = String(details.groupName || lead.groupName || "").trim().toLowerCase();

  if (details.groupId) return { id: details.groupId, name: details.groupName || "Untitled Lead Page", type: details.groupType || "other", createdAt: details.groupCreatedAt || "" };
  if (groupType === "google-sheets" || groupType === "google_sheets" || groupName === "google sheet integration" || (details.importedFrom && details.sourceEnquiryId)) return { id: "google-sheets", name: "Google sheet integration", type: "google-sheets", createdAt: "" };
  if (groupType === "csv" || groupName === "import csv leads" || details.csvImportKey) return { id: `csv-legacy-${String(details.csvImportKey || "").replace(/:[^:]+$/, "")}`, name: "Import CSV leads", type: "csv", createdAt: "" };
  if (groupType === "callyzer" || groupName === "callyzer") return { id: "callyzer", name: "Callyzer", type: "callyzer", createdAt: "" };
  return { id: "manual", name: "Manual entry leads", type: "manual", createdAt: "" };
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/*
 * The studio's date and time of day, in India, whatever zone this computer's clock is set to.
 * A lead's Added Time and Enquiry Date are facts about the studio; taken from the machine they came
 * out 5:30 behind on a laptop set to UTC. The server fills the same two from the same zone when a
 * record brings none (`services/studioTime.js`).
 */
function studioDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ACTIVITY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function studioClockTime(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ACTIVITY_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(date).toLowerCase();
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/*
 * ── Last Follow-up Date is stamped by the Update buttons, and by nothing else ─────────────────
 *
 * The date means "the day somebody last worked this lead", and the only honest moment to write it
 * is the moment somebody says they have finished with it: **CNA and Proceed Next**, **Update and
 * Close**, **Update and Proceed Next**. Pressing one of those is a person saying "I have dealt with
 * this lead today", which is exactly what the column is for.
 *
 * Deliberately **not** on a posted remark. A remark saves itself the instant it is written - it is
 * a record of what was said, not a decision about the lead - and it is very often written while
 * reading a lead nobody is working: skimming a thread, adding a note off a call that came in on
 * another lead, correcting a typo in yesterday's note. Stamping the date there would mean a lead
 * read on Tuesday claiming it was worked on Tuesday, and the Pending Followups tabs and the
 * Last Followup Date column would slowly fill with days nobody actually called anybody.
 *
 * It is written on every press, not only where something changed. A CRM who opens a lead, finds
 * nothing to change and presses Update has still worked it, and that is the day the column should
 * carry - the alternative is a lead that looks untouched for a week because each visit happened to
 * change nothing.
 *
 * Stamped into `details`, which is the half the server reads first for this column and the half
 * both popups show it from.
 */
const leadWorkedTodayPatch = () => ({ lastFollowUpDate: getLocalDateKey() });

// Required on every vertical. Each is stored in its own column, so a lead captured here
// shows up in the table column of the same name.
const REQUIRED_LEAD_FIELDS = [
  { key: "name", label: "Enquire Name", message: "Enter the client's name." },
  { key: "phone", label: "Contact", message: "Enter the contact number." },
  { key: "assignedBranch", label: "Assigned Branch", message: "Choose a branch." },
  // What the studio reckons the lead is worth. Required on all three verticals, unlike the budget
  // fields beside it: those are what the client said, and a client who has not said is common.
  { key: "estimatedValue", label: "Estimated Value", message: "Enter the estimated value." },
];

/*
 * ── Date of birth / EDOD: asked everywhere, demanded only in the lead popup ────────────────────
 *
 * It is the baby's or mother's date, so only Qua Qua shows it at all - and *where* it is demanded
 * is the part worth being careful about, because the answer differs by form.
 *
 * **Not on the way in.** A lead very often arrives before the date does: the call ended before
 * anybody asked, the mother has no scan date yet, the enquiry came through a planner. Demanding it
 * in Add Lead or Bulk Entry buys a date somebody invented - worse than an empty one, since the
 * Newborns and Birthdays tabs schedule shoots off it - or no lead at all.
 *
 * **Yes in the lead popup.** By the time somebody opens a Qua Qua lead to work it, the date is what
 * the whole vertical plans from, and a lead that has been worked and still has none is the lead
 * nobody can schedule. That is the moment to insist, and it is the only one.
 *
 * **Unless nobody got through.** A lead named `CNA`, and a lead whose *status* is CNA, are both
 * excused it - exactly as they are excused Estimated Value. The date is something somebody finds
 * out by reaching the client, so an unanswered call leaves it no more knowable than what the job is
 * worth, and insisting buys an invented date that the Newborns and Birthdays tabs then schedule a
 * shoot from. `Invalid` and `Rejected` excuse it too, along with everything else about the job -
 * see `REJECTED_LEAD_FIELDS`. See `UNKNOWN_CALLER_UNASKED_FIELDS` and `UNANSWERED_LEAD_STATUSES`.
 */
const POPUP_REQUIRED_FIELDS = {
  "Qua Qua": [{ key: "dateOfBirthOrEdod", label: "Date of Birth (or) EDOD", message: "Choose the date of birth or EDOD." }],
};

/*
 * Who the person is, and nothing else.
 *
 * What a lead that is being turned down needs. The four above are questions about a job: which
 * branch will do it, what it is worth, when the baby is due. A lead marked Invalid or Rejected is
 * not a job - it is a record that this person rang and the answer was no - and asking somebody to
 * estimate the value of work nobody is doing before they may write that down is asking them to
 * invent a number, or to give up and leave no record at all.
 *
 * The same two statuses `STATUSES_WITHOUT_FOLLOW_UP` names, for the same reason it names them:
 * these are the ones that end the conversation.
 */
const REJECTED_LEAD_FIELDS = REQUIRED_LEAD_FIELDS.filter((field) => ["name", "phone"].includes(field.key));

/*
 * ── A lead written down as `CNA` ──────────────────────────────────────────────────────────────
 *
 * `CNA` typed into **Enquire Name** is the studio's way of recording a caller nobody has reached:
 * the phone rang, the call did not connect, and the one thing not known yet is who they are. The
 * lead is still worth writing down - the number is the whole point of it - and everything that
 * makes it findable is still asked for: the name (such as it is), the contact and the branch.
 *
 * What cannot be asked for is **Estimated Value** - what the studio reckons the job is worth - and,
 * in the lead popup, **Date of Birth (or) EDOD**. Neither is knowable from a call that never
 * connected, so demanding them is asking somebody to invent two answers, or to give up and leave no
 * record of the call at all - which is the same reasoning `REJECTED_LEAD_FIELDS` already applies to
 * a lead being turned down.
 *
 * Any other name leaves both fields exactly as required as they were.
 */
const UNKNOWN_CALLER_NAME = "cna";
const UNKNOWN_CALLER_UNASKED_FIELDS = ["estimatedValue", "dateOfBirthOrEdod"];
const isUnknownCallerName = (name) => String(name ?? "").trim().toLowerCase() === UNKNOWN_CALLER_NAME;

/*
 * ── And the same two questions, excused by the **status** ─────────────────────────────────────
 *
 * `CNA` as a status is a call to this lead that went unanswered. It used to be read as a different
 * case from the name - the client is known, so the argument ran, the value and the date should
 * still be asked for - and the form went on demanding both. That is right about the client and
 * wrong about the questions: what the studio reckons the job is worth, and when the baby is due,
 * are things somebody finds out *by getting through*. A call that did not connect leaves them
 * exactly as unknowable as a caller nobody has reached, and a form that insists anyway is asking
 * for two invented answers - on Qua Qua, an invented date that the Newborns and Birthdays tabs
 * then schedule a shoot from.
 *
 * So the status excuses the same two fields the name does, and nothing else: the name, the contact
 * and the branch are all still demanded, because a CNA lead has all three. `Invalid` and `Rejected`
 * are handled a step earlier and more broadly - those end the conversation, so they keep only who
 * the person is - see `REJECTED_LEAD_FIELDS`.
 *
 * Not scoped to Qua Qua. `Date of Birth (or) EDOD` only exists there, so that half is Qua Qua's by
 * itself; Estimated Value is asked on all three verticals and is no more knowable from an
 * unanswered call on one than on another - which is already how `REJECTED_LEAD_FIELDS` and the CNA
 * name treat it.
 */
const UNANSWERED_LEAD_STATUSES = ["CNA"];

/**
 * What this form will not save without.
 *
 * The four in `REQUIRED_LEAD_FIELDS` on every vertical and every form. `popup` adds whatever that
 * vertical's `POPUP_REQUIRED_FIELDS` names, which is the lead popup insisting on a date that Add
 * Lead and Bulk Entry deliberately do not - see the note above that list for why the answer differs
 * by form rather than by field.
 *
 * `vertical` is only read when `popup` is set, and is the vertical the popup resolved for the lead
 * rather than anything typed: a lead's own `vertical` column is regularly blank and reads as Dum
 * Dum, which would quietly stop asking a Qua Qua lead for the one date its board is built on.
 */
function requiredLeadFields(status = "", name = "", { vertical = "", popup = false } = {}) {
  /*
   * Read through `normalizeLeadStatus`, not compared raw.
   *
   * The pills write `CNA`, `Invalid` and `Rejected` exactly, so a click was always matched - but a
   * lead's stored status is regularly one of the older spellings a sheet wrote, and `in review` is
   * normalised to CNA everywhere else on this screen. Comparing the raw column meant a lead whose
   * panel *said* CNA could still be refused for a date nobody could have known, which reads as the
   * rule working sometimes.
   */
  const current = normalizeLeadStatus(status);
  if (STATUSES_WITHOUT_FOLLOW_UP.includes(current)) return REJECTED_LEAD_FIELDS;
  const asked = [
    ...REQUIRED_LEAD_FIELDS,
    ...(popup ? POPUP_REQUIRED_FIELDS[String(vertical || "").trim()] || [] : []),
    // A lead still being chased has to say when the next call is - see `NEXT_FOLLOW_UP_REQUIRED_STATUSES`.
    ...(NEXT_FOLLOW_UP_REQUIRED_STATUSES.includes(current) ? [NEXT_FOLLOW_UP_FIELD] : []),
  ];
  // The caller nobody reached, or a call to this lead that went unanswered. Both leave Estimated
  // Value and - on Qua Qua - the date unknowable, so both excuse the same two fields.
  if (!isUnknownCallerName(name) && !UNANSWERED_LEAD_STATUSES.includes(current)) return asked;
  return asked.filter((field) => !UNKNOWN_CALLER_UNASKED_FIELDS.includes(field.key));
}

function isRequiredLeadField(key, status = "", name = "", options = {}) {
  return requiredLeadFields(status, name, options).some((field) => field.key === key);
}

function missingRequiredLeadFields(form, options = {}) {
  // The status and the name the form is holding, so the asterisks and the refusal to save agree with
  // what is on screen rather than with what the lead arrived carrying - somebody typing `CNA` over a
  // name sees the two fields stop being demanded as they type, and typing a real name back demands
  // them again.
  return requiredLeadFields(form?.leadStatus, form?.name, options)
    .filter(({ key }) => !String(form?.[key] ?? "").trim());
}

/** The same, as the message under each box: `{ phone: "Enter the contact number." }`. */
function leadFieldProblems(form, options = {}) {
  return Object.fromEntries(missingRequiredLeadFields(form, options).map(({ key, message }) => [key, message]));
}

/**
 * The vertical's own Table Settings fields the studio marked required, as `{ "custom:<key>": message }`.
 * Prefixed so a custom key can never land on a built-in box of the same name.
 */
function customLeadFieldProblems(form, fields = []) {
  return Object.fromEntries((fields || []).map((field) => [`custom:${field.key}`, customFieldProblem(field, form?.customFields?.[field.key])]));
}

/** The message a required lead box shows while it is marked and still empty, "" otherwise. */
function leadFieldMessage(key, marked, form, options = {}) {
  if (!marked) return "";
  return missingRequiredLeadFields(form, options).find((field) => field.key === key)?.message || "";
}

/**
 * The same form, moved to a vertical.
 *
 * One rule, used by both things that move it: the Vertical radio at the top of Add Lead, and the
 * Add Lead button itself, which opens the form on whichever board is being read. They had drifted
 * into two - the radio reset the status and seeded the vertical's custom fields, and the button did
 * neither - so the form opened on Dum Dum whatever board it was opened from, and a Qua Qua lead was
 * one radio press away from being filed in the wrong vertical by anybody who did not notice.
 *
 * Two things follow a vertical and are done here so neither caller can forget them:
 *
 *   * A status the new vertical does not offer falls back to Interested. Qua Qua alone has
 *     "Converted & Followup", and left standing on Corp it is a status with no pill lit to say so
 *     and no way to change it back.
 *   * The vertical's own Table Settings fields start on whatever the builder marked as default.
 *     Answers already typed are kept, since a field can exist on both verticals.
 */
function leadFormForVertical(form, vertical, customFieldsByVertical = {}) {
  const next = { ...form, vertical };
  if (!leadStatusOptionsForVertical(vertical).some((option) => option.value === next.leadStatus)) {
    next.leadStatus = "Interested";
  }
  next.customFields = { ...customFieldDefaults(customFieldsByVertical[vertical]), ...(next.customFields || {}) };
  return next;
}

function emptyLeadForm() {
  return {
    id: "",
    // Answers to the vertical's Table Settings fields, keyed by field key.
    customFields: {},
    name: "",
    // A time, not a date - the column is "Added Time", and the date is already carried
    // by createdDate and the row timestamp.
    addedTime: studioClockTime(),
    createdDate: studioDateKey(),
    phone: "",
    vertical: "Dum Dum",
    crm: "",
    referredFrom: "",
    offerType: "",
    contactRepeated: "",
    relationship: "",
    groomName: "",
    groomContact: "",
    groomLocation: "",
    brideName: "",
    brideContact: "",
    brideLocation: "",
    referenceName: "",
    referenceContact: "",
    assignedBranch: "",
    dateOfBirthOrEdod: "",
    // Qua Qua's own client fields, named for the same reason as Corp's below.
    babyOrMotherName: "",
    contactNumber: "",
    // Corp's own client fields. They are named here rather than borrowed from Dum Dum's
    // groom/bride keys, because the table column, the lead popup and the sheet sync all
    // read these names - a Corp answer stored under a Dum Dum key reaches none of them.
    companyName: "",
    primaryDecisionMaker: "",
    designation: "",
    companyWebsite: "",
    companyType: "",
    location: "",
    officialEmailId: "",
    expectedBudget: "",
    estimatedValue: "",
    leadStatus: "Interested",
    lastFollowUpDate: "",
    lastConvertedDate: "",
    /*
     * Today, on all three verticals.
     *
     * A lead being written down is one somebody is about to work - that is what the Interested it
     * opens on means - and the next call is almost always the same day it was taken. Left blank it
     * was a required-in-practice field answered by hand on every lead, and the ones nobody filled in
     * are the leads that appear on no Pending Followups tab and are chased by nobody.
     *
     * Read at the moment the form is built rather than written down, so it is genuinely today: a
     * board left open overnight is re-stamped when Add Lead is next opened - see the button, which
     * fills this in when it is blank. It is cleared, not kept, when the status becomes Rejected or
     * Invalid: a lead nobody is chasing carries no date for the next call. See `updateForm`.
     */
    nextFollowUpDate: getLocalDateKey(),
    nextFollowUpTime: "",
    remarks: "",
    remarkEntries: [],
    attachments: [],
    shoots: [emptyShootRow()],
  };
}

/**
 * The Add Lead form, opened on a call from the Calls board.
 *
 * Everything the call already told us is filled in - who rang, on what number, when, which
 * employee's phone took it, what they wrote against it and where the CRM had got to with it - so
 * the only work left is the work the board exists for: reading the caller and saying which vertical
 * they are.
 *
 * No id is carried across, and that is the change this whole board turns on. A call is not a lead
 * waiting to be edited; it is a call, under a Call ID of its own. Confirm creates the lead and the
 * server mints its Enquiry ID then - for the vertical that has just been chosen, which is the first
 * moment anybody knows it - and links this caller's calls to it. Sending the Call ID as a lead id
 * would ask the server to write a lead that does not exist.
 *
 * `vertical` is the one field deliberately left empty. It is the answer being collected, and a
 * preselected Dum Dum would put the caller back on the board the queue keeps them off the moment
 * somebody confirmed without looking.
 *
 * The status is taken only when it is one the pills actually offer. A Callyzer call can arrive
 * carrying its own CRM status, and "Yet to connect" and "Inactive" are read off the record rather
 * than set on it - neither is a pill, and seeding the form with one would leave the group showing
 * nothing chosen.
 */
function leadFormFromCall(lead = {}, details = {}) {
  const status = String(lead.leadStatus || details.leadStatus || lead.status || "").trim();
  // Against the vertical the form opens on, which is the one whose pills will be on screen.
  const offered = leadStatusOptionsForVertical(DEFAULT_VERTICAL).some((option) => option.value === status);
  const entries = leadRemarkEntries(details.remarkEntries, lead.remarkEntries, details.remarks, lead.remarks);
  return {
    // `vertical` is left as `emptyLeadForm` sets it - Dum Dum - so the form opens filled in and
    // ready to read rather than waiting on a choice. The radio above it moves the caller to
    // another vertical, and `updateForm` re-seeds that vertical's own fields when it does.
    ...emptyLeadForm(),
    // Deliberately not `lead.id`, which on this board is the Call ID. See above.
    id: "",
    name: lead.name || "",
    phone: lead.phone || "",
    contactNumber: lead.contactNumber || details.contactNumber || "",
    // When the call came in, not when the form was opened - `emptyLeadForm` stamps both with now.
    createdDate: lead.createdDate || details.createdDate || getLocalDateKey(),
    addedTime: lead.addedTime || details.addedTime || "",
    // The employee whose phone took the call. Callyzer writes it here, and it is who the lead
    // should stay with unless somebody says otherwise.
    crm: lead.crm || details.crm || "",
    referredFrom: lead.referredFrom || details.referredFrom || "",
    contactRepeated: lead.contactRepeated || details.contactRepeated || "",
    leadStatus: offered ? status : "Interested",
    nextFollowUpDate: details.nextFollowUpDate || lead.nextFollowUpDate || "",
    nextFollowUpTime: details.nextFollowUpTime || lead.nextFollowUpTime || "",
    remarkEntries: entries,
    remarks: remarkSummary(entries),
    attachments: details.attachments || [],
  };
}

/**
 * An **existing** lead as the Add Lead form holds it, for assigning one nobody owns.
 *
 * A lead with no CRM reads as "Unassigned" on the board whatever its status, and the lead popup has
 * no Assign To field - the only control that picks an employee is this form's. So dragging an
 * unassigned card onto a status opens the form on the lead it already is: its own details, its own
 * enquiry id, Assign To waiting, and the status it was dropped on already chosen.
 *
 * Unlike `leadFormFromCall` above, **the id is kept**: there is a lead here already and the save is
 * an update of it, not a new enquiry. Its vertical is kept for the same reason - the lead is on a
 * board already, and re-seeding it onto Dum Dum would move a Qua Qua lead by opening a form.
 *
 * Every field the form offers is taken from the record, details first where both hold a value: the
 * details row is what the popup writes, so it is the newer of the two.
 */
function leadFormFromLead(lead = {}, details = {}, status = "") {
  const merged = { ...lead, ...Object.fromEntries(Object.entries(details).filter(([, value]) => value !== null && value !== undefined && value !== "")) };
  const entries = leadRemarkEntries(details.remarkEntries, lead.remarkEntries, details.remarks, lead.remarks);
  const blank = emptyLeadForm();
  const taken = Object.fromEntries(Object.keys(blank).map((key) => [key, merged[key] ?? blank[key]]));
  return {
    ...taken,
    // Its own, not a new one: this form is updating the lead rather than writing another.
    id: lead.id || "",
    vertical: normalizeVertical(merged.vertical) || blank.vertical,
    // The column it was dropped on. Left as it was if the drop carried nothing.
    leadStatus: status || merged.leadStatus || "",
    remarkEntries: entries,
    remarks: remarkSummary(entries),
    attachments: details.attachments || [],
    customFields: merged.customFields || blank.customFields,
  };
}

// Event Details stores one "City, State" string. The CRM table has separate City and
// State columns, so split it on the last comma; with no comma the whole value is the city.
function splitDistrictState(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const index = text.lastIndexOf(",");
  if (index === -1) return { city: text, state: "" };
  return { city: text.slice(0, index).trim(), state: text.slice(index + 1).trim() };
}

function emptyShootRow() {
  return { shootType: "", venue: "", districtState: "", date: "", time: "" };
}

function resolveLeadVertical(lead = {}, details = {}) {
  return normalizeVertical(
    details.vertical ||
    details.assignedBranch ||
    details.vertical ||
    lead.vertical ||
    lead.assignedBranch ||
    lead.vertical ||
    details.groupName ||
    lead.groupName ||
    ""
  ) || "Dum Dum";
}

const CLIENT_FIELD_SECTIONS = {
  /*
   * Each inner array is one row of the popup's Client Details, and every row but the last is three
   * across - which is what the grid is. A short row leaves an empty column beside it and starts the
   * next group lower, a gap through the middle of the form. Groom, bride and the baby keep a row of
   * their own, so a person's fields read across together.
   *
   * The first two rows are the same on every vertical: who the client is and the numbers they are
   * reached on (WhatsApp beside Contact, to be compared), then where the lead sits and who works it.
   * Vertical and Assign To are the lead popup's own - picking a vertical moves the lead.
   */
  "Dum Dum": [
    [
      ["Enquiry Name", "name"],
      ["Contact", "phone"],
      ["WhatsApp Number", "whatsappNumber"],
    ],
    [
      ["Assigned Branch", "assignedBranch"],
      ["Vertical", "vertical"],
      ["Assign To", "crm"],
    ],
    [
      ["Relationship", "relationship"],
      ["Referred From", "referredFrom"],
      ["Estimated Value", "estimatedValue"],
    ],
    [
      ["Groom Name", "groomName"],
      ["Groom Contact", "groomContact"],
      ["Groom Location", "groomLocation"],
    ],
    [
      ["Bride Name", "brideName"],
      ["Bride Contact", "brideContact"],
      ["Bride Location", "brideLocation"],
    ],
    [
      ["Referenced Person Name", "referenceName"],
      ["Reference Contact", "referenceContact"],
    ],
  ],
  "Qua Qua": [
    [
      ["Enquiry Name", "name"],
      ["Contact", "phone"],
      ["WhatsApp Number", "whatsappNumber"],
    ],
    [
      ["Assigned Branch", "assignedBranch"],
      ["Vertical", "vertical"],
      ["Assign To", "crm"],
    ],
    [
      ["Relationship", "relationship"],
      ["Referred From", "referredFrom"],
      ["Offer Type", "offerType"],
    ],
    // No third "Contact" here: it read the lead's phone number, already in the first row.
    [
      ["Baby (or) Mother Name", "babyOrMotherName"],
      ["Date of Birth (or) EDOD", "dateOfBirthOrEdod"],
      ["Location", "location"],
    ],
    [
      ["Last Converted Date", "lastConvertedDate"],
      ["Estimated Value", "estimatedValue"],
    ],
  ],
  Corp: [
    [
      ["Enquiry Name", "name"],
      ["Contact", "phone"],
      ["WhatsApp Number", "whatsappNumber"],
    ],
    [
      ["Assigned Branch", "assignedBranch"],
      ["Vertical", "vertical"],
      ["Assign To", "crm"],
    ],
    [
      ["Company Name (or) Client organisation", "companyName"],
      ["Primary decision maker - Contact", "primaryDecisionMaker"],
      ["Designation", "designation"],
    ],
    [
      ["Company Website", "companyWebsite"],
      ["Company Type", "companyType"],
      ["Official Email ID", "officialEmailId"],
    ],
    // The two money fields side by side: what the client said they would spend, and what the
    // studio reckons the work is worth.
    [
      ["Location", "location"],
      ["Budget Expected", "expectedBudget"],
      ["Estimated Value", "estimatedValue"],
    ],
    [
      ["Referred From", "referredFrom"],
    ],
  ],
};

// The ⓘ line beside each lead field, by its key - shared by the lead popup and Add Lead.
const LEAD_FIELD_HELP = {
  name: "The client's name, as the lead is listed on the board.",
  phone: "The client's main number, used to call and to spot repeat enquiries.",
  whatsappNumber: "The number WhatsApp chats are held on; saved once it is complete.",
  contactNumber: "Another number the client can be reached on.",
  assignedBranch: "The branch that will handle this lead.",
  vertical: "Pick another vertical to move the lead there when you press Update.",
  crm: "The salesperson who follows up this lead.",
  relationship: "How the person enquiring is related to the client.",
  referredFrom: "Where or from whom the enquiry came to the studio.",
  estimatedValue: "What the studio expects this work to be worth, in rupees.",
  groomName: "The groom's name, as the couple want it used.",
  groomContact: "The groom's own number, if different from the main contact.",
  groomLocation: "The groom's town or city.",
  brideName: "The bride's name, as the couple want it used.",
  brideContact: "The bride's own number, if different from the main contact.",
  brideLocation: "The bride's town or city.",
  referenceName: "The person who referred this client to the studio.",
  referenceContact: "The referring person's number, to thank or follow up.",
  offerType: "The studio offer or package the client asked about.",
  babyOrMotherName: "The baby's name, or the mother's if the baby is not born yet.",
  dateOfBirthOrEdod: "The baby's birth date, or the expected due date if not born yet.",
  location: "Where the client is based or the shoot will happen.",
  lastConvertedDate: "The date this client last booked with the studio.",
  companyName: "The company or organisation the work is for.",
  primaryDecisionMaker: "The number of the person who decides on the booking.",
  designation: "The decision maker's job title at the company.",
  companyWebsite: "The company's website, to learn about the client before calling.",
  companyType: "What kind of business it is, such as hotel or factory.",
  officialEmailId: "The company email address to send quotations and updates to.",
  expectedBudget: "What the client says they plan to spend.",
};

// Fields the popup renders with something other than a plain text box, matching Add Lead.
const POPUP_FIELD_CONTROLS = {
  /*
   * `"branch"`, and it said `"board"` until September 2026.
   *
   * The renderer's case has always been `control === "branch"`, so this named a control that does
   * not exist and Assigned Branch fell through to the plain text box at the end of the chain - a
   * free-text field on the one screen where the value has to be one of the studio's branches. It is
   * how "dsa" could be saved as a branch, and it is why the popup looked nothing like Add Lead,
   * which has always drawn the real picker. A rename that reached the renderer and not the map.
   */
  assignedBranch: "branch",
  relationship: "combo",
  referredFrom: "combo",
  vertical: "vertical",
  crm: "crm",
};

/**
 * Which control the lead popup draws a field with.
 *
 * A **date column gets a calendar without being listed**, and that is the point of this function
 * rather than four more lines in the map above. `lastConvertedDate` was missing from it, so it fell
 * through to the plain text box at the end of the renderer's chain - a free-text box for a date, on
 * the one screen where the value is read back by a board that sorts and filters on it. Somebody
 * could type "last week" into it.
 *
 * It is the same fault the comment above `assignedBranch` describes, and the second time this map
 * has silently dropped a field: a hand-kept list of which columns are dates, sitting beside a
 * renderer that already knows, is a list that will go stale again. `DATE_FILTER_COLUMNS` is the
 * application's own answer to "which lead columns hold a day" - the column filters already read it -
 * so the popup asks that instead of keeping a second copy. `dateOfBirthOrEdod` is no longer named
 * here for exactly that reason: it was the duplicate that made the omission of the other one look
 * deliberate.
 *
 * The map still wins where a column needs something other than its type would suggest.
 */
const popupControlFor = (key) => POPUP_FIELD_CONTROLS[key] || (DATE_FILTER_COLUMNS.includes(key) ? "date" : undefined);

/**
 * Every lead key that holds a phone number, across all three verticals.
 *
 * Kept in one place because the same field is rendered by the lead popup and by Add Lead;
 * listing them separately is how one ends up accepting letters while the other does not.
 */
const PHONE_FIELD_KEYS = [
  "phone",
  "whatsappNumber",
  "contactNumber",
  "alternateMobileNumber",
  "groomContact",
  "brideContact",
  "referenceContact",
  "primaryDecisionMaker",
];

function isPhoneFieldKey(key) {
  return PHONE_FIELD_KEYS.includes(key);
}

function getPopupClientFieldSections(vertical) {
  return CLIENT_FIELD_SECTIONS[vertical] || CLIENT_FIELD_SECTIONS["Dum Dum"];
}

function normalizeCsvHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function csvValue(row, headerMap, ...headers) {
  for (const header of headers) {
    const index = headerMap.get(normalizeCsvHeader(header));
    if (index !== undefined) return String(row[index] || "").trim();
  }
  return "";
}

// Headers that mark a CSV as having a real header row. When one is present the
// column order is untrusted, so a missing field must resolve to blank rather than to
// whatever happens to sit at a fixed index.
const KNOWN_CSV_HEADERS = [
  "enquiryid",
  "enquiryname",
  "name",
  "phonenumber",
  "phone",
  "addedtime",
  "addedtimestamp",
  "nearestbranch",
  "assignedbranch",
  "status",
  "crm",
];

function csvHasHeaderRow(headerMap) {
  return KNOWN_CSV_HEADERS.some((header) => headerMap.has(header));
}

function csvValueOrPosition(row, headerMap, position, ...headers) {
  for (const header of headers) {
    const index = headerMap.get(normalizeCsvHeader(header));
    if (index !== undefined) return String(row[index] || "").trim();
  }
  return position === null || position === undefined ? "" : String(row[position] || "").trim();
}


/*
 * ── The board's rows, drawn by `DataTable` ────────────────────────────────────────────────────
 *
 * This board used to draw its own `<table>`: a memoised `LeadTableRow`, a header row with its own
 * drag and resize handlers from `useTableArrangement`, a filter row, a frozen-column effect that
 * wrote sticky offsets straight onto the cells, and its own Manage Columns. All of it answered the
 * same questions `DataTable` answers for every other table in the application, and the two had
 * drifted - the cell clipping, then the column filters, each corrected on one and not the other.
 *
 * So the board is a `DataTable` now, and what is left here is what only this board knows: what a
 * cell says (`getLeadCellValue`), how a status is drawn, what the row menu offers, and which
 * columns take a calendar or a clock under their heading. Everything the board did that the shared
 * table did not - sizing columns to their contents until one is pulled, a right-click menu, the
 * server's own sort, a blue hover - it now does through a prop, so no other table moved.
 */

// 48px: `w-12`, the width this board has always drawn its tick boxes at.
const SELECT_COLUMN_WIDTH = 48;

/** The row's identity, module-level so the memoised rows are never rebuilt for a fresh arrow. */
const leadRowId = (lead) => lead.id;
/** What the tick box calls its row: "Select lead L-1042", as it always has. */
const leadRowLabel = (lead) => `lead ${lead.id}`;

/**
 * The Status cell: the 8px dot every status table uses, and the label with CNA's number on it.
 *
 * CNA carries its number in the cell as well as on the pill and the column filter. A column of bare
 * "CNA" cannot be read in order, which is the one thing this status is for - it says how many
 * times the lead has gone unanswered relative to the others.
 */
function LeadStatusCell({ value, cnaSequence }) {
  const appearance = statusAppearance(value);
  return (
    <span className={`inline-flex items-center gap-2 font-normal ${appearance.text}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${appearance.dot}`} />
      <span className="truncate">{statusCellLabel(value, cnaSequence)}</span>
    </span>
  );
}

/**
 * One board column as `DataTable` reads it.
 *
 * `accessorFn` is what the cell shows, what a sort is asked about and what the CSV carries;
 * `title` is the same value readable on hover once the cell has clipped it - the same thing
 * `DataTable` does with every cell it draws. `filter` names the control under the heading where it
 * is not the plain box: a calendar for a date column, a clock for the two time columns. Status and
 * the closed-set columns are lists, which the board says through `filterValues` rather than here,
 * because their values are the server's answer and not a fact about the column.
 *
 * `sortDescFirst: false` because every press on this board has always started at ascending; left
 * to itself the table would start a column of numbers at descending.
 */
function leadTableColumn(column) {
  const kind = columnFilterKind(column.id);
  return {
    id: column.id,
    label: column.label,
    sortable: column.sortable,
    sortDescFirst: false,
    accessorFn: (lead) => getLeadCellValue(lead, column.id),
    title: (lead) => {
      const value = getLeadCellValue(lead, column.id);
      return typeof value === "string" && value !== "—" ? value : undefined;
    },
    ...(kind === "date" || kind === "time" ? { filter: kind } : {}),
    ...(column.id === "status"
      ? { cell: ({ row }) => <LeadStatusCell value={getLeadCellValue(row.original, "status")} cnaSequence={getLeadCnaSequence(row.original)} /> }
      : {}),
  };
}

function LeadStatusPills({ value, onChange, className = "", counts = {}, disabledValues = [], disabledTitle = "", options = [
    ...LEAD_STATUS_OPTIONS,
  ] }) {
  const disabled = new Set(disabledValues);
  const palette = {
    CNA: "bg-black text-white border-black",
    Invalid: "bg-[#8f9097] text-white border-[#8f9097]",
    Rejected: "bg-[#ff3b3b] text-white border-[#ff3b3b]",
    Interested: "bg-[#0b60ff] text-white border-[#0b60ff]",
    Followup: "bg-[#ff8a1e] text-white border-[#ff8a1e]",
    Converted: "bg-[#00973e] text-white border-[#00973e]",
    [CONVERTED_AND_FOLLOWUP_STATUS]: "bg-[#10b981] text-white border-[#10b981]",
  };
  const normalizedOptions = options.map((option) => {
    if (typeof option === "string") {
      return { value: option, className: palette[option] || "bg-slate-600 text-white border-slate-600" };
    }
    return { ...option, className: option.className || palette[option.value] || "" };
  });

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-3">
        {normalizedOptions.map((option) => {
          const isOff = disabled.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => !isOff && onChange(option.value)}
              disabled={isOff}
              // Said rather than left to a greyed-out pill, which on its own reads as
              // something being broken.
              title={isOff ? disabledTitle || undefined : undefined}
              className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                isOff
                  ? "cursor-not-allowed border-transparent bg-transparent text-slate-300"
                  : value === option.value
                    ? option.className
                    : `border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50`
              }`}
            >
              {option.value === "CNA" && normalizeLeadStatus(value) === "CNA" ? statusCellLabel("CNA", counts.CNA) : option.value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Takes a flat row or a whole record, and an occasion's own count over the lead's when one is
// being worked for one - see `resolveLeadCnaSequence`.
function getLeadCnaSequence(lead) {
  return resolveLeadCnaSequence(lead?.lead || lead || {}, lead?.details || lead || {});
}

/**
 * Whether a lead has used up its CNA attempts.
 *
 * True only for a lead the limit itself rejected: six recorded attempts and a seventh press.
 * A lead rejected by hand keeps its CNA pill, because nothing was ever counted against it and
 * closing the button off would leave no way to start counting.
 */
function cnaExhausted(lead) {
  return normalizeLeadStatus(lead?.leadStatus || lead?.status || "") === "Rejected"
    && getLeadCnaSequence(lead) > MAX_CNA_ATTEMPTS;
}

/**
 * The lead as a save would write it, for asking what that save needs filled in.
 *
 * A button can name the status (CNA and Proceed Next), and the press past the CNA limit writes
 * Rejected instead - which needs no next follow-up, so it must not be refused for lacking one.
 */
function leadAsSaved(lead, forcedStatus = "") {
  if (!forcedStatus) return lead;
  const rejected = forcedStatus === "CNA" && getLeadCnaSequence(lead) + 1 > MAX_CNA_ATTEMPTS;
  return { ...lead, leadStatus: rejected ? "Rejected" : forcedStatus };
}

/**
 * The module's confirmation popup, shown once a bulk action has actually landed.
 *
 * A bulk edit can touch thousands of rows and clears the selection behind it, so it gets an
 * acknowledgement the user has to dismiss rather than the corner toast used for passing
 * notes - the toast can be missed, and "did that go through?" is not a question this screen
 * should leave open.
 */
function CrmSuccessDialog({ message, onClose, open, title = "Saved!" }) {
  const confirmRef = useRef(null);

  // Focus is keyed on `open` alone. Keying it on the handler as well would move focus back
  // to OK on every re-render of the page behind the dialog, which polls while this is up.
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEscapeKey(() => onClose?.(), open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="crm-success-title"
        aria-describedby="crm-success-message"
        className="w-full max-w-[420px] rounded-[24px] bg-white px-6 py-9 text-center shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
      >
        <span aria-hidden="true" className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-4 border-emerald-100">
          <CheckRoundedIcon className="text-emerald-500" style={{ fontSize: 44 }} />
        </span>
        <h2 id="crm-success-title" className="mt-6 text-2xl font-semibold tracking-[-0.02em] text-slate-800">
          {title}
        </h2>
        <p id="crm-success-message" className="mt-3 text-sm leading-6 text-slate-600">
          {message}
        </p>
        <Button
          ref={confirmRef}
          type="button"
          variant="primary"
          size="md"
          className="mt-7 min-w-[7rem]"
          onClick={onClose}
        >
          OK
        </Button>
      </section>
    </div>
  );
}

function DistrictStateField({ value, onChange, className = "" }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const wrapperRef = useRef(null);
  const menuRef = useRef(null);
  const query = String(value || "").trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    if (!query) return districtStateOptions;
    return districtStateOptions.filter((option) => matchesWordChunks(option, query));
  }, [query]);

  // Closes the suggestions without closing the form they are being typed into.
  useEscapeKey(() => setOpen(false), open);

  useEffect(() => {
    function handlePointerDown(event) {
      if (wrapperRef.current?.contains(event.target)) return;
      if (menuRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const updatePosition = () => {
      const input = wrapperRef.current?.querySelector("input");
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const viewportPadding = 12;
      const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
      const menuHeight = Math.max(160, Math.min(260, availableBelow));
      setMenuStyle({
        position: "fixed",
        left: Math.max(viewportPadding, rect.left),
        top: rect.bottom + 4,
        width: rect.width,
        maxHeight: menuHeight,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <TextField
        label=""
        value={value || ""}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        placeholder="District & State"
        className="pt-0"
      />
      {open && menuStyle
        ? createPortal(
          <div
            ref={menuRef}
            /* Portalled to <body>, so `themed-surface` is what carries the dark palette to it. */
            className="themed-surface z-[9999] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              ...menuStyle,
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-y",
            }}
            onWheelCapture={(event) => event.stopPropagation()}
            onTouchMoveCapture={(event) => event.stopPropagation()}
          >
            {filteredOptions.length ? (
              filteredOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className="block w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-blue-50 hover:text-blue-700"
                >
                  {option}
                </button>
              ))
            ) : (
              <div className="rounded-xl px-4 py-3 text-sm text-slate-400">No matching locations</div>
            )}
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

// A row counts as filled once anything has been put in it. Used to decide whether Enter has
// something to commit, and to keep the trailing blank row from being added twice.
// How many shoot rows a lead can carry. Named once: the auto-append on Shoot Type, the
// Enter-to-commit handler and Add Lead all have to agree on it.
const MAX_SHOOT_ROWS = 8;

function shootRowFilled(shoot) {
  return Object.values(shoot || {}).some((value) => String(value || "").trim());
}

/**
 * The shoot rows on a lead.
 *
 * Enter commits the row being typed in: the row is kept, a fresh blank one opens beneath it,
 * and the cursor lands in the new row's Venue so a run of shoots can be entered without
 * reaching for the mouse. Previously a new row only appeared when a Shoot Type was picked on
 * the last row, so filling a row any other way left nowhere to put the next one.
 *
 * Nothing is thrown away by committing - the row is already in the list as it is typed. Enter
 * only opens the next one.
 */
/*
 * `shootTypeOptions` is the Shoot Types list of the lead's vertical from Settings → Fields - the
 * brand's own shoots, the same list the Quotation Generator offers - and `shootTypeStatus`
 * is why it might be empty - "loading", "error" or "ready" - so the control says so rather than
 * offering a blank menu with no explanation. A row already holding a word the list no longer has
 * (renamed or removed in Settings since the lead was filed) keeps that word as a choice, so the
 * lead reads as it was saved and nothing is changed by opening it.
 */
const SHOOT_TYPE_PLACEHOLDER = { loading: "Loading…", error: "Could not load", ready: "Select" };

function shootTypeRowOptions(options, current) {
  return current && !options.includes(current) ? [...options, current] : options;
}

function ShootDetailsTable({ shoots = [], onChangeRow, onRemoveRow, onAddRow, shootTypeOptions = [], shootTypeStatus = "ready", onRetryShootTypes }) {
  const shootTypePlaceholder = shootTypeStatus === "ready" && !shootTypeOptions.length ? "No shoot types" : SHOOT_TYPE_PLACEHOLDER[shootTypeStatus] || "Select";
  // The list is the brand's shoots, edited under Settings → Fields → Shoot Types, which answers to
  // `SETTINGS / Quotation Settings` Read/Write. Somebody who cannot open it is told to ask, not
  // sent somewhere closed.
  const { canWrite: canEditFieldLists } = useModuleAccess("SETTINGS", "Quotation Settings");
  // Enter is caught on the row rather than wired into each field, so every input in it
  // behaves the same. Buttons are left alone: Enter on the Shoot Type control opens its menu,
  // and on the delete control it deletes, neither of which should also add a row.
  function handleRowKeyDown(event, index) {
    if (event.key !== "Enter") return;
    if (event.target?.tagName !== "INPUT") return;
    // Stopped here whatever happens next: these rows sit inside forms and dialogs, and a
    // stray Enter reaching one of those would submit it.
    event.preventDefault();
    if (!shootRowFilled(shoots[index])) return;
    // Only the last row opens another. Pressing Enter part-way up the list means "done with
    // this one", and there is already a row below it.
    if (index !== shoots.length - 1) return;
    if (shoots.length >= MAX_SHOOT_ROWS) return;
    // Read now, not inside the callback: React clears currentTarget once the handler returns.
    const rowElement = event.currentTarget;
    onAddRow?.();
    // Focused after the new row has rendered.
    window.requestAnimationFrame(() => {
      const nextRow = rowElement?.parentElement?.children?.[index + 1];
      nextRow?.querySelector("input")?.focus();
    });
  }

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white">
      {/*
        Six columns of `minmax(0, …)` share whatever width there is, which on a phone leaves each
        one about fifty pixels - a Venue box too narrow to read a word in. The card scrolls
        sideways instead, and the rows below hold a width that keeps every field usable. The scroll
        lives here, inside the card, so the popup itself never scrolls sideways.

        The minimum is dropped again at `lg`: side by side the column is narrower than 40rem, and
        keeping it would have put a scrollbar under a table that had always fitted on a desktop.
      */}
      <div className="w-full overflow-x-auto">
        <div className="w-full min-w-[40rem] lg:min-w-0">
          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.95fr)_minmax(0,0.9fr)_44px] items-center border-b border-slate-200 px-4 py-4 text-sm font-semibold text-slate-600 sm:px-5">
            <div>Shoot Type<HelpTip text="Pick the kind of shoot the client is asking for." /></div>
            <div>Venue<HelpTip text="Where this shoot takes place, such as the hall or the home." /></div>
            <div>District &amp; State<HelpTip text="Pick or type the district and state the venue is in." /></div>
            <div>Date<HelpTip text="The day this shoot happens." /></div>
            <div>Time<HelpTip text="The time this shoot starts." /></div>
            <div />
          </div>
          <div className="divide-y divide-slate-200">
            {shoots.map((shoot, index) => (
              <div
                key={`shoot-${index}`}
                onKeyDown={(event) => handleRowKeyDown(event, index)}
                className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.95fr)_minmax(0,0.9fr)_44px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5"
              >
                <Dropdown
                  mode="switch"
                  ariaLabel={`Shoot type row ${index + 1}`}
                  value={shoot.shootType || ""}
                  onChange={(value) => onChangeRow(index, "shootType", value)}
                  options={shootTypeRowOptions(shootTypeOptions, shoot.shootType)}
                  placeholder={shootTypePlaceholder}
                  className="min-w-0 w-full"
                />
                <TextField
                  label=""
                  value={shoot.venue || ""}
                  onChange={(event) => onChangeRow(index, "venue", event.target.value)}
                  placeholder="Venue"
                  className="min-w-0 pt-0"
                />
                <div>
                  <DistrictStateField
                    value={shoot.districtState || ""}
                    onChange={(value) => onChangeRow(index, "districtState", value)}
                  />
                </div>
                <DateField
                  label=""
                  value={shoot.date || ""}
                  onChange={(value) => onChangeRow(index, "date", value)}
                  className="min-w-0 pt-0"
                />
                <TimeField
                  label=""
                  value={shoot.time || ""}
                  onChange={(event) => onChangeRow(index, "time", event.target.value)}
                  className="min-w-0 pt-0"
                />
                <div className="flex justify-center">
                  {/* The first row is the form itself - there is always one, and an empty one
                      has nothing to delete. It comes alive once something has been put in it.
                      Every row below it can always go. */}
                  <button
                    type="button"
                    onClick={() => onRemoveRow(index)}
                    disabled={index === 0 && !shootRowFilled(shoot)}
                    aria-label={`Remove shoot row ${index + 1}`}
                    className="flex h-8 w-8 items-center justify-center text-red-500 transition hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:text-slate-300"
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 20 }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Said once under the rows rather than guessed from an empty menu: where the list is kept,
          or that it did not arrive. Nothing is shown while it loads or when it is simply there. */}
      {shootTypeStatus === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200 px-4 py-2 text-xs text-red-600 sm:px-5">
          <span>Shoot types could not be loaded.</span>
          {onRetryShootTypes && <Button type="button" variant="secondary" size="sm" onClick={onRetryShootTypes}>Try again</Button>}
        </div>
      )}
      {shootTypeStatus === "ready" && !shootTypeOptions.length && (
        <p role="status" className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 sm:px-5">
          No shoot types for this vertical yet. {canEditFieldLists ? "Add them in Settings → Fields → Sales & CRM → Leads & Followups → Shoot Types." : "Ask an administrator to add them in Settings."}
        </p>
      )}
    </div>
  );
}

function LeadPopupModal({
  open,
  lead,
  details,
  cnaSequence = 0,
  leadTab,
  setLeadTab,
  // The studio's WhatsApp switch, owned by the page so it is already known when this opens.
  chatEnabled = true,
  onChatEnabledChange,
  activity = [],
  activityLoading = false,
  callLogs = [],
  callLogsLoading = false,
  transcripts = [],
  transcriptsLoading = false,
  projects = [],
  onClose,
  onSave,
  onUpdateLead,
  onCommitLead,
  onUpdateDetails,
  onUpdateRemarks,
  onUpdateShootRow,
  onMoveNext,
  onConvert,
  // Moves this lead to another vertical, once Update has saved the rest. Throws its refusal.
  onMoveVertical,
  onBack,
  onNotice,
  onError,
  // Opens another lead entirely, wherever this popup was opened from. Used by the duplicate warning
  // to hand the reader the enquiry that already holds the number they just typed.
  onOpenLead,
  duplicateEnquiries = null,
  // Reached by double-clicking a row as well as from the menu, so it cannot rely on the control
  // that opened it having been hidden: without READ_WRITE it reads the lead and offers no way to
  // change one.
  canWrite = true,
}) {
  // Declared before the early return: a hook cannot sit behind one, or the hook count
  // changes as the popup opens and React tears the component down.
  // The boxes the last refused save marked; each clears as it is answered.
  const requiredMarks = useFormErrors();
  // The status the last refused save was writing, when a button named one - so the Next Follow-up
  // Date is marked against CNA and Proceed Next rather than against the pills.
  const [requiredForStatus, setRequiredForStatus] = useState("");
  /*
   * The popup's own "one press, one update". Not about duplicate records - writing the same values
   * twice leaves the lead as it was - but about **Update and Proceed Next**, which advances the
   * board: pressed twice it saves one lead and steps past two, and the skipped one is the one
   * nobody then works.
   */
  const { busy: updatingLead, run: runUpdateLead } = useSubmitOnce();
  /*
   * The studio's branches, read here rather than handed in.
   *
   * Assigned Branch is drawn by this component, so this component is what needs the list. It was a
   * `branchOptions` from `CRMPage`'s own scope for a while, which is not a scope this function can
   * see: the popup threw `branchOptions is not defined` the moment a lead was double-clicked, and
   * only in the popup, because the three Add Lead forms that read the same name really are inside
   * `CRMPage`.
   *
   * Passing it as a prop would have fixed that one call and left the trap: `LeadPopupModal` is also
   * rendered by `LeadPopupHost`, which the Contacts directory opens a lead through and which knows
   * nothing about branches. Reading it here is the only arrangement where no caller can forget.
   */
  const { branches: branchOptions } = useBranchOptions();
  // The Sales roster for Assign To, read here for the reason above: the Contacts popup has none.
  const [crmEmployees, setCrmEmployees] = useState([]);
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    void getCrmEmployees()
      .then((response) => { if (active) setCrmEmployees(response?.data || []); })
      .catch(() => { if (active) setCrmEmployees([]); });
    return () => { active = false; };
  }, [open]);
  /*
   * The vertical picked in Client Details, held like any other edit until Update. Update then asks
   * the data-loss question (`confirmMove`, the press it interrupted), saves the rest, and moves.
   * A different lead opened in the same popup starts with nothing picked.
   */
  const [pendingVertical, setPendingVertical] = useState("");
  const [confirmMove, setConfirmMove] = useState(null);
  const [pendingFor, setPendingFor] = useState(lead?.id);
  if (pendingFor !== lead?.id) {
    setPendingFor(lead?.id);
    setPendingVertical("");
    setConfirmMove(null);
  }
  /**
   * Which option Assigned Branch should be sitting on, for a lead whose text is not the register's
   * own spelling.
   *
   * A branch is written into a lead by whatever wrote the lead, and an imported one says what the
   * file said - `Erode` where the register says `Erode TN`. The picker is built from the register,
   * `Dropdown` shows its placeholder for a value it cannot find among its options, and so a lead
   * filed perfectly well under `branch_id` 1 read as a lead with no branch at all.
   *
   * So the reference decides what is shown, not the text. Three steps, in this order:
   *
   *   1. **The text, when it is exactly an option.** This is the freshly picked value - somebody has
   *      just chosen a branch and the reference has not been written yet, because the server
   *      resolves it when the lead is saved. Their choice must win, or the field would snap back to
   *      the old branch under their hands.
   *   2. **`branchId`**, the branch the record is actually filed under, resolved by the server from
   *      whatever the text said. This is what makes `Erode` read as `Erode TN`.
   *   3. **Nothing.** Text naming no branch - `viza`, `erd`, `Out of Branch Location` - has no
   *      reference and gets the placeholder, which reads as the question it is: this lead is filed
   *      under no branch, choose one. The stored text is not shown as though it were a branch.
   *
   * Nothing is written by any of this. The popup sends only the fields somebody edited, so a lead
   * whose branch is unrecognised keeps its text until a branch is actually chosen - the one record
   * of what the file said is not quietly destroyed by opening the lead and saving something else.
   */
  const branchOptionFor = useCallback((lead) => {
    const typed = String(lead?.assignedBranch ?? "").trim().toLowerCase();
    const chosen = typed && branchOptions.find((option) => String(option.value).trim().toLowerCase() === typed);
    if (chosen) return chosen.value;
    const filedUnder = lead?.branchId == null
      ? null
      : branchOptions.find((option) => option.id != null && option.id === lead.branchId);
    return filedUnder ? filedUnder.value : "";
  }, [branchOptions]);
  // The lead's vertical, read before the early return below so the hook under it is called on
  // every render: the Shoot Types offered on its Event Details rows are that vertical's own.
  const vertical = lead ? resolveLeadVertical(mergeLeadDisplayRecord(lead, details), details) : "";
  // The suggestions behind the Relationship and Referred From combos and the Shoot Type rows -
  // the studio's lists, the shoots being the lead's vertical's.
  const suggestions = useLeadSuggestionLists({ vertical });
  /*
   * What the dot on the WhatsApp Chat tab is saying, in three states rather than two.
   *
   * "blocked" is an administrator having switched WhatsApp off for the studio, and it is not
   * the same as this CRM being logged out: there is nothing for them to do about it and no
   * point pressing Link. Red would send them looking for a fault of their own, so it takes the
   * module's grey - the same colour the Status column uses for a row that is not linked and is
   * not waiting on anything either.
   *
   * Held here rather than in the chat panel because the dot has to be right on every tab, and
   * the panel only exists while its own tab is open.
   */
  const [whatsappDot, setWhatsappDot] = useState("disconnected");
  /*
   * The project being read out of Converted History, held as an id rather than as the row.
   *
   * The popup stays mounted as somebody walks the queue with Update and Proceed Next, so a row held
   * directly here would go on showing the previous lead's project against the next lead. Resolved
   * out of the list below instead: when the projects change to another lead's, the id names nothing
   * and the panel closes itself. The same is true of a project deleted in Sales Manager while this
   * was open.
   */
  const [viewingProjectId, setViewingProjectId] = useState(null);
  const viewingProject = projects.find((project) => project.id === viewingProjectId) || null;
  /*
   * The tabs this popup is offering.
   *
   * WhatsApp Chat disappears entirely while the studio switch is off, rather than being shown
   * and refusing: with the switch off nothing can be linked and nothing can be sent, so the tab
   * has nothing behind it.
   *
   * Driven by the page's own answer rather than by this popup's first poll. Deciding it here
   * meant every open began by assuming the switch was on, drew the tab, and removed it again
   * once the poll replied - the tab flickering in and out on each open.
   */
  const visibleLeadTabs = LEAD_POPUP_TABS.filter((tab) => tab.id !== "whatsapp" || chatEnabled !== false);

  /*
   * The ⋮ views - Transcripts and AI Assistant - are screens rather than tabs.
   *
   * `openMenuTab` is whichever is on show, and null the rest of the time; the header reads from it.
   */
  const openMenuTab = LEAD_POPUP_MENU_TABS.find((tab) => tab.id === leadTab) || null;

  /*
   * Where Back goes: the tab that was open before, not a fixed one.
   *
   * Someone reading Call Logs who opens Transcripts to check a recording expects to land back on
   * Call Logs. Kept in a ref rather than state because it must not cause a render of its own - it
   * is read only at the moment Back is pressed.
   */
  const tabBeforeMenuRef = useRef("remarks");
  useEffect(() => {
    if (!LEAD_POPUP_MENU_TABS.some((tab) => tab.id === leadTab)) tabBeforeMenuRef.current = leadTab;
  }, [leadTab]);
  const tabBeforeMenu = tabBeforeMenuRef.current;
  /*
   * Keeps the tab's dot in step with the link.
   *
   * The pairing can end without this app doing anything - the phone can unlink the device, and
   * the connection can drop - so the dot is re-read on a slow beat rather than set once when the
   * popup opens. The chat panel reports its own connects and unlinks straight into it, so those
   * show immediately instead of waiting for the next read.
   */
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const read = async () => {
      try {
        const response = await getWhatsappSession();
        const data = response?.data || {};
        // Blocked outranks connected: the sweep that switches WhatsApp off disconnects
        // everybody, so a session still reading connected here is one this poll has caught
        // mid-sweep - and the reason it is about to end is the switch, not the CRM.
        if (cancelled) return;
        const off = data.chatEnabled === false;
        setWhatsappDot(off ? "blocked" : data.status === "connected" ? "connected" : "disconnected");
        // Reported upward rather than kept here, so the answer survives this popup closing.
        onChatEnabledChange?.(!off);
        // Switched off while somebody was reading the conversation: the tab is about to stop
        // existing, and a popup left pointing at a tab that is not there shows nothing at all.
        if (off) setLeadTab?.((current) => (current === "whatsapp" ? "remarks" : current));
      } catch {
        // Only the connection is unknown after a failed read, not the studio switch. Reporting
        // the switch as on here is what made the tab reappear for a poll and vanish again.
        if (!cancelled) setWhatsappDot((current) => (current === "blocked" ? current : "disconnected"));
      }
    };
    void read();
    const timer = window.setInterval(read, WHATSAPP_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Both are the page's own state setters, so neither changes and neither can restart the
    // poll; they are named because the effect reads them.
  }, [open, setLeadTab, onChatEnabledChange]);

  /*
   * A lead cannot be updated without a remark against it.
   *
   * The point of the update buttons is to record what happened on this call, and a status
   * moved from Interested to Followup with nothing written beside it leaves the next person
   * to ring with no idea what was said. So the two Update buttons wait for either a posted
   * remark or a note still in the box - the second counts because it is posted on the way
   * out, and losing what someone had just typed would be worse than refusing the save.
   *
   * The modal is keyed by lead id, so both reset as each lead is opened.
   */
  const [remarkAdded, setRemarkAdded] = useState(false);
  // Whether the box has anything in it, not what it says. The popup only needs the former,
  // and holding the text here would re-render this whole form on every keystroke.
  const [remarkDraftFilled, setRemarkDraftFilled] = useState(false);
  // Raised only once an update has actually been attempted without one, the way the required
  // field marking works. A lead that has just been opened is not owed a telling-off.
  const [showRemarkError, setShowRemarkError] = useState(false);

  /** The Remarks tab's scrolling pane, so a refusal can put the box and the reason back on screen. */
  const remarksPane = useRef(null);

  /**
   * Bring the remark box, and the message above it, into view to be answered.
   *
   * Asking for the tab is not enough: Remarks is the tab the popup **opens** on, so it is usually a
   * no-op, and both the box and the refusal sit at the top of a pane the reader has very likely
   * scrolled down through a long lead's history. Refused for a box and a reason that are off the top
   * of the pane, somebody sees nothing happen - which is the thing this path was written to prevent.
   */
  function revealRemarkBox() {
    setLeadTab?.("remarks");
    // After the tab has rendered, or it is the outgoing pane that gets scrolled.
    requestAnimationFrame(() => remarksPane.current?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  /*
   * The Activity Logs filter row.
   *
   * One per column, the same three controls the lead table's own filter row offers: a list to
   * pick a user from, the calendar for a date, and free text for the activity itself. The
   * date filter is what replaced the day banner that used to sit between the rows - it said
   * nothing the Time column did not already carry, and a filter answers the same question
   * without cutting the table into pieces.
   */
  const [activityFilters, setActivityFilters] = useState({ user: "", time: "", activity: "" });
  const commitRemarkRef = useRef(null);
  /*
   * True only while `attemptSave` is committing the note in the box, so the host writes the
   * entries to its own state and leaves the network write to the save that is about to run.
   * A ref, not state: it is read inside the same synchronous commit that sets it.
   */
  const skipRemarkPostRef = useRef(false);
  const hasRemark = remarkAdded || remarkDraftFilled;

  /*
   * ── One number, one enquiry, on the way out as well as the way in ─────────────────────────
   *
   * The number this lead had when it was opened, so an edit can be told from what was already
   * there. Both hosts mount this with `key={leadId}`, so first render is this lead's first render
   * and the ref is seeded once with the saved number rather than with a half-typed one.
   *
   * Only a *changed* number is worth warning about. A lead that has always shared a number with
   * another - a groom and a bride on one phone, a family, an office line - is a fact of the
   * studio's data, already stated in the header as "Enquired : 2 times", and raising a dialog over
   * it on every Update would be an alarm about something nobody just did.
   */
  const [phoneBaseline, setPhoneBaseline] = useState(() => ({ id: lead?.id || "", phone: String(lead?.phone || "").trim() }));
  /*
   * Re-seeded when the lead changes, which is React's own "adjusting state when a prop changes".
   *
   * A ref would be the obvious home for this and is the wrong one - reading `.current` during
   * render is exactly what the compiler refuses, and a lazy `useState` alone is not enough either:
   * `LeadPopupHost` mounts this form before its record has arrived, so the first render sees no
   * lead at all and would take an empty string as the number this lead started with. Every lead
   * opened from Contacts would then look as though its number had just been edited.
   */
  if (lead?.id && phoneBaseline.id !== lead.id) {
    setPhoneBaseline({ id: lead.id, phone: String(lead.phone || "").trim() });
  }

  // The enquiries the *edited* number is already on, `{ phone, leads }`, or null.
  const [phoneClash, setPhoneClash] = useState(null);
  // The number somebody has read the warning for and chosen to save anyway.
  const [clashAckPhone, setClashAckPhone] = useState("");
  const [clashAlert, setClashAlert] = useState(null);

  /*
   * Escape closes the lead popup.
   *
   * The screen this module is most used through, and it ignored the key entirely - so the one
   * gesture everybody reaches for did nothing on it. Registered above the early return, like every
   * other hook here, and `open` is what keeps it off the stack while there is nothing on screen.
   *
   * It is the *unsaved edits* that make this worth being careful about: closing is what `onClose`
   * already does from the ×, and that path is the one that decides what happens to a draft. Escape
   * is the same door, not a second one with its own rules.
   */
  useEscapeKey(() => onClose?.(), Boolean(open && lead));

  const editedPhone = String(lead?.phone || "").trim();
  const phoneChanged = Boolean(phoneBaseline.id && editedPhone && editedPhone !== phoneBaseline.phone);

  useEffect(() => {
    // Asked only of a number that is both whole and different from the one this lead arrived with.
    if (!phoneChanged || !isCompletePhoneNumber(editedPhone)) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getDuplicateEnquiries({ phone: editedPhone, excludeId: lead?.id || "" })
        .then((response) => {
          if (cancelled) return;
          const rows = response?.data?.leads || [];
          setPhoneClash(rows.length ? { phone: editedPhone, leads: rows } : null);
        })
        // A check that will not answer is not a clash; Update is never held up by a bad moment on
        // the network.
        .catch(() => {});
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [phoneChanged, editedPhone, lead?.id]);

  // Outstanding for the number as it stands now, and not yet gone ahead with.
  const phoneClashWarning = phoneClash && phoneClash.phone === editedPhone && phoneClash.phone !== clashAckPhone
    ? phoneClash
    : null;

  if (!open || !lead) return null;
  const displayLead = mergeLeadDisplayRecord(lead, details);
  const shoots = Array.isArray(displayLead.shoots) && displayLead.shoots.length ? displayLead.shoots : [emptyShootRow()];
  const cnaCount = cnaSequence > 0 ? cnaSequence : getLeadCnaSequence(displayLead);
  const headerPhone = displayLead.phone || "—";
  // At least one: this lead is itself an enquiry, and the server may raise it.
  const enquiryCount = Math.max(Number(duplicateEnquiries?.count) || 1, 1);
  const clientSections = getPopupClientFieldSections(vertical);
  // The people who have actually touched this lead, for the User filter's list.
  const activityUsers = [...new Set(activity.map((entry) => entry.actorName || "User"))].sort((a, b) => a.localeCompare(b));
  /*
   * The log rows the filters leave standing.
   *
   * Each filter matches on a substring, case-insensitively - the same rule the lead table
   * uses, which is what lets a typed partial like "2026-08" work alongside a date picked from
   * the calendar. Time is matched against the printed form and the ISO day both, and Activity
   * against the title and its detail together, so "Rejected" finds a status change to it.
   */
  const visibleActivity = activity.filter((entry) => {
    const user = activityFilters.user.trim().toLowerCase();
    const time = activityFilters.time.trim().toLowerCase();
    const text = activityFilters.activity.trim().toLowerCase();
    if (user && !matchesWordChunks(entry.actorName || "User", user)) return false;
    if (time) {
      const printed = formatActivityTime(entry.createdAt).toLowerCase();
      const iso = String(entry.createdAt || "").slice(0, 10).toLowerCase();
      if (!printed.includes(time) && !iso.includes(time)) return false;
    }
    if (text && !matchesWordChunks(`${activityTitle(entry)} ${activityDetail(entry) || ""}`, text)) return false;
    return true;
  });
  /**
   * Saves, or shows what is stopping it.
   *
   * Nothing is marked until an update has actually been attempted, so a lead being filled in
   * is not red from the moment it opens. Once a required box has been flagged the marking
   * stays live, and clears itself as each one is filled.
   */
  /**
   * Converting, once the form is complete enough to be written.
   *
   * Convert used to change nothing here - it handed the lead to Sales Manager and the project's own
   * save marked it - so it could be pressed on a half-filled form and nothing was lost. It writes
   * the lead now, which means it has to be held to the same line every other write is: a lead
   * cannot be marked Converted while the fields that make it a lead are still empty.
   *
   * The same marking the Update buttons use, so the missing boxes are shown rather than named in a
   * message - the reader is taken to the problem instead of being told about it.
   */
  function attemptConvert(status) {
    // Asked of the status being written: Converted & Followup needs its next call booked, and
    // Converted needs none.
    setRequiredForStatus(status);
    if (!requiredMarks.check(leadFieldProblems(leadAsSaved(displayLead, status), { vertical, popup: true }))) return;
    onConvert?.(status);
  }

  function attemptSave(closeAfter, advanceAfter, forcedStatus, moveConfirmed = false) {
    /*
     * One press, one update - refused before any of the checks below, so a second press cannot even
     * re-raise the phone-clash dialog or re-commit the note in the box.
     *
     * Writing the same values twice would leave the lead saying what it already said, so this is not
     * the duplicate-record problem Add Lead has. What it stops is the *other* half of these buttons:
     * **Update and Proceed Next** advances the board, so a double-click saves one lead and skips
     * two - and the one it skipped is the one nobody then works.
     */
    if (updatingLead) return;
    // Asked of the status this save writes: CNA and Proceed Next records CNA whatever the pills say,
    // and CNA needs its next call booked.
    const savedLead = leadAsSaved(displayLead, forcedStatus);
    setRequiredForStatus(forcedStatus ? savedLead.leadStatus : "");
    // `popup`, so this form asks for the date Add Lead and Bulk Entry deliberately do not - and asks
    // it against the vertical resolved above rather than the lead's own blank column.
    if (!requiredMarks.check(leadFieldProblems(forcedStatus ? savedLead : displayLead, { vertical, popup: true }))) return;

    // CNA is exempt. Nobody picked up, so there is nothing to write down, and a run of
    // unanswered attempts has to stay one press each.
    if (!hasRemark && forcedStatus !== "CNA") {
      setShowRemarkError(true);
      // The message sits above the notes box, so the notes box is where the user is sent, scrolled
      // to - pressing Update would otherwise flag a field they cannot see and read as a button that
      // does nothing.
      revealRemarkBox();
      return;
    }
    setShowRemarkError(false);

    // A vertical picked in Client Details: the data-loss warning, then this same press again.
    if (pendingVertical && !moveConfirmed) {
      setConfirmMove({ closeAfter, advanceAfter, forcedStatus });
      return;
    }

    /*
     * And last: has this number been edited onto a client the CRM already holds?
     *
     * Checked here rather than only while typing, for the reason Add Lead checks at Confirm too - a
     * number pasted in and saved in the same second never gave the check time to answer. The
     * warning names the enquiry that already has it; going ahead is possible and deliberate.
     */
    if (phoneClashWarning) {
      // `saving` says this was raised by an Update rather than by somebody pressing the line under
      // the field, which is what decides whether the dialog offers to go on with the save.
      setClashAlert({ ...phoneClashWarning, intent: "edit", saving: true, closeAfter, advanceAfter, forcedStatus, vertical });
      return;
    }

    /*
     * A note left in the box is committed first, so pressing Update is enough - the user does not
     * have to remember to press Enter before it as well.
     *
     * ── Committed, but deliberately not posted on its own ────────────────────────────────────
     *
     * A remark written on its own posts itself immediately, and should. One written and then left
     * in the box when Update is pressed must not, because the save is about to write this lead a
     * moment later and the two writes are the same endpoint.
     *
     * They used to both go, concurrently, and the remark's own write carries the lead **as it was
     * last saved** - it has no idea what is in the popup's draft. So whenever it happened to land
     * second it overwrote the update with pre-edit values: the status, the branch, the estimated
     * value, the follow-up dates, all quietly reverted a moment after a toast said the lead was
     * updated. Nothing said it had happened, and it depended on which of two requests won, which
     * is why it struck only sometimes.
     *
     * `skipRemarkPost` says so for the length of the commit: the entries still reach the host, so
     * the list on screen and the details the save is about to read are both up to date, but the
     * network write is left to the save. One press, one write, and the last word belongs to the
     * one that knows about the edits.
     */
    /*
     * The committed list is handed to the save rather than read back out of state, because it is
     * not in state yet: `setRecord` and `setDetailsByLead` land on the next render, and the save
     * runs on this one. `submitDraft` returns the new entries for exactly this caller.
     */
    let committedEntries = null;
    if (remarkDraftFilled) {
      skipRemarkPostRef.current = true;
      try {
        committedEntries = commitRemarkRef.current?.() || null;
      } finally {
        skipRemarkPostRef.current = false;
      }
    }
    void runUpdateLead(() => saveWithCommittedNote(closeAfter, advanceAfter, forcedStatus, committedEntries));
  }

  /**
   * The save, and the note it was carrying if it did not go through.
   *
   * Suppressing the note's own write is what stopped it racing the update - but it also made the
   * save the only thing writing it. A refused save therefore left the note on screen, in the list,
   * with the box cleared, and nowhere else: it looked posted and vanished on the next reload.
   *
   * So the suppression is conditional on the save actually happening. If it did not, the note is
   * posted on its own after all - which is what it would have done had Update never been pressed,
   * and there is no update left for it to race.
   */
  async function saveWithCommittedNote(closeAfter, advanceAfter, forcedStatus, committedEntries) {
    // With a move to follow, the save keeps the popup where it is - the move closes it, as the lead
    // leaves this vertical - and the rest of the edits are written first, on the vertical they are for.
    const moving = pendingVertical;
    const saved = await onSave(moving ? false : closeAfter, moving ? false : advanceAfter, forcedStatus, committedEntries);
    if (saved === false && committedEntries) onUpdateRemarks?.(committedEntries, { post: true });
    if (!moving || saved === false) return;
    try {
      await onMoveVertical(moving);
      setPendingVertical("");
    } catch (error) {
      onError?.(error.message || "Unable to move this lead.");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/40 p-2 sm:p-3">
      {/* `role="dialog"` is what it has always been - a modal over the page - and `themed-surface`
          is the hook globals.css uses to paint it in the dark tiers. It is portalled to <body>,
          so the shell's own theme rules never reached it and a dark CRM opened a white popup. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Lead ${displayLead.id || ""}`}
        className="themed-surface flex h-full w-full flex-col overflow-hidden rounded-[1.6rem] bg-[#f4f4f4] shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
          <div className="min-w-0 flex flex-wrap items-center gap-3 text-[15px] text-slate-700">
            {/* Bold, and the only thing in this header that is.

                Everything beside it - the enquiry id, the number, the repeat count - is reference
                you read once and confirm. The name is who the popup is about, so it is what the
                eye should land on when it opens. */}
            <span className="font-bold text-slate-900">{displayLead.name || "Client_Name"}</span>
            <span className="hidden text-slate-300 sm:inline">|</span>
            <span>Enquire ID : {displayLead.id || "—"}</span>
            <span className="hidden text-slate-300 sm:inline">|</span>
            <span>Mob Number : {headerPhone}</span>
            {/* Shown only when the number has come to us more than once. "Enquired : 1 time"
                is true of every lead and so tells the reader nothing; the count earns its
                place in the header precisely when it is a repeat caller. Kept in the
                header's own slate rather than a warning colour - a repeat enquiry is
                ordinary, not an alarm. */}
            {enquiryCount > 1 && (
              <>
                <span className="hidden text-slate-300 sm:inline">|</span>
                <span
                  className="font-medium text-slate-800"
                  title={(duplicateEnquiries?.leads || [])
                    .map((item) => `${item.enquiryId} · ${item.enquiryDate || "no date"}${item.nextFollowUpDate ? ` · follow-up ${item.nextFollowUpDate}` : ""}`)
                    .join("\n") || undefined}
                >
                  Enquired : {enquiryCount} times
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => onMoveNext?.("meetings")} className="rounded-md px-4 py-2 text-[13px] font-medium shadow-sm">
              Meetings
            </Button>
            <Button variant="primary" size="sm" onClick={() => onMoveNext?.("quotation")} className="rounded-md px-4 py-2 text-[13px] font-medium shadow-sm">
              Quotation Calculator
            </Button>
            <CloseButton onClick={onClose} ariaLabel="Close lead popup" size="lg" />
          </div>
        </div>

        {/*
          Below `lg` the body is one column that scrolls; from `lg` it is two panes that scroll
          inside themselves.

          It used to be height-locked at every width - `h-full` on the grid, `overflow-hidden` on
          both columns - which works only while the two sit side by side. Stacked on a phone the
          same rules gave each column a share of one screen and clipped whatever did not fit, so
          Client Details ended after three fields, the tabs collapsed to nothing, and there was no
          scrollbar to reach any of it. The lock now starts at `lg`, where it is true.
        */}
        {/* Everything the lead is made of stays on screen and stays readable; without READ_WRITE
            none of it can be typed into. The fields are not removed - a panel with its fields
            taken away is an empty record rather than a read-only one, and reading the lead is
            the whole reason this opens on READ. */}
        <ReadOnlyFieldset canWrite={canWrite} reason="You have read-only access to CRM leads." className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="grid min-h-0 gap-3 p-3 lg:h-full lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
            {/* The left column scrolls on its own from `lg`: Client Details is taller than a laptop
                screen leaves it, and held to the screen it squeezed Event Details to a strip with
                its shoots out of reach. */}
            <div className="flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
              <section className="shrink-0 overflow-hidden rounded-[1.3rem] bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-[18px] font-medium text-slate-700">Client Details</h3>
                </div>
                <div className="space-y-4 px-5 py-6">
                  {clientSections.map((section, sectionIndex) => (
                  <div key={sectionIndex} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {section.map(([label, key]) => {
                    const control = popupControlFor(key);
                    const required = isRequiredLeadField(key, displayLead.leadStatus, displayLead.name, { vertical, popup: true });
                    // Only after an update has been attempted: marking a field red before the
                    // user has tried to save is scolding them for not having finished yet.
                    const missing = Boolean(requiredMarks.errors[key]) && required && !String(displayLead[key] ?? "").trim();
                    // Each control exposes a different inner element, so the red border is
                    // aimed at whichever one it actually renders.
                    const invalidRing = missing ? "[&_input]:border-rose-400 [&_select]:border-rose-400 [&_button]:border-rose-400" : "";
                    /*
                     * "Already an enquiry", under the Contact box it is about.
                     *
                     * The same line Add Lead shows, in the same place, for the same reason - and it
                     * was missing here. Editing a lead's number onto one another lead holds was
                     * caught, but only on Update, by a dialog: so the number read as perfectly fine
                     * right up until the moment somebody tried to save it, which is the latest
                     * possible time to be told and the one point at which they have stopped looking
                     * at the field.
                     *
                     * Only on a number that was actually changed - `phoneClashWarning` is built on
                     * that - so a lead that has always shared a number with another does not wear a
                     * warning about a fact nobody just created. Its header already says
                     * "Enquired : 2 times".
                     */
                    const duplicate = key === "phone" ? phoneClashWarning : null;
                    const field = (node) => (
                      <div key={key} className={invalidRing} data-invalid={missing ? "true" : undefined}>
                        {node}
                        {missing && (
                          <p role="alert" className="mt-1 text-xs font-normal text-rose-600">{requiredMarks.errors[key]}</p>
                        )}
                        {!missing && duplicate && (
                          <button
                            type="button"
                            onClick={() => setClashAlert({ ...duplicate, intent: "edit", vertical })}
                            className="mt-1 text-left text-xs font-normal text-amber-700 underline decoration-amber-300 underline-offset-2 hover:decoration-amber-600"
                          >
                            Already an enquiry: {duplicate.leads.map((entry) => entry.enquiryId).join(", ")}
                          </button>
                        )}
                      </div>
                    );
                    if (control === "branch") {
                      return field(
                        /*
                         * Searchable, but closed.
                         *
                         * A branch is one of six, so typing filters the list rather than becoming
                         * the answer - the combo box used for Relationship keeps whatever is typed,
                         * which here saved "dsa" as a branch on the way past. What is typed is the
                         * search; only a branch that was chosen is stored.
                         */
                        <Dropdown
                          mode="input"
                          searchable
                          ariaLabel={label}
                          label={label}
                          helperText={LEAD_FIELD_HELP[key]}
                          required={required}
                          // The branch this lead is filed under, named the way the register names
                          // it - see `branchOptionFor`. Not the text as stored, which is whatever
                          // wrote the lead and is regularly a spelling this list does not hold.
                          value={branchOptionFor(displayLead)}
                          onChange={(value) => onUpdateLead(key, value)}
                          options={branchOptions}
                        />
                      );
                    }
                    if (control === "date") {
                      return field(
                        <DateField
                          label={label}
                          helperText={LEAD_FIELD_HELP[key]}
                          required={required}
                          value={displayLead[key] || ""}
                          onChange={(value) => onUpdateLead(key, value)}
                        />
                      );
                    }
                    if (control === "vertical") {
                      return field(
                        <>
                          <Dropdown
                            ariaLabel={label}
                            label={label}
                            helperText={LEAD_FIELD_HELP[key]}
                            value={pendingVertical || vertical}
                            options={MOVE_TARGETS.map((target) => ({ label: target, value: target }))}
                            sorted={false}
                            searchable={false}
                            disabled={!onMoveVertical}
                            onChange={(value) => setPendingVertical(value && value !== vertical ? value : "")}
                          />
                          {/* Nothing moves yet: said here so the pick is not mistaken for done. */}
                          {pendingVertical && (
                            <p className="mt-1 text-xs font-normal text-amber-700">
                              Moves to {pendingVertical} when you press Update - you will be asked to confirm.
                            </p>
                          )}
                        </>
                      );
                    }
                    if (control === "crm") {
                      return field(
                        <Dropdown
                          searchable
                          ariaLabel={label}
                          label={label}
                          helperText={LEAD_FIELD_HELP[key]}
                          value={displayLead.crm || ""}
                          onChange={(value) => onUpdateLead(key, value || "")}
                          // The current owner stays listed even when they have left the roster.
                          options={crmOptionsFrom(crmEmployees, [displayLead.crm].filter(Boolean))}
                        />
                      );
                    }
                    if (control === "combo") {
                      return field(
                        <ComboBoxField
                          label={label}
                          helperText={LEAD_FIELD_HELP[key]}
                          required={required}
                          value={displayLead[key] || ""}
                          onChange={(value) => onUpdateLead(key, value)}
                          options={suggestions[key] || []}
                        />
                      );
                    }
                    /*
                     * The two controls report a change differently, so the handler cannot be
                     * shared. TextField passes the DOM event; PhoneField passes the field name
                     * and the assembled number, because it is two inputs behind one value.
                     * Reading `event.target` off a PhoneField's first argument - a string - is
                     * what threw on every keystroke in Contact and left the lead unsaveable.
                     */
                    const isPhone = isPhoneFieldKey(key);
                    const FieldControl = isPhone ? PhoneField : TextField;
                    return field(
                      <FieldControl
                        label={label}
                        helperText={LEAD_FIELD_HELP[key]}
                        required={required}
                        value={displayLead[key] || ""}
                        onChange={isPhone
                          ? (_field, phone) => {
                            onUpdateLead(key, phone);
                            /*
                             * The WhatsApp Number saves itself the moment it is whole.
                             *
                             * Every other field on this form waits for Update, which is the popup's
                             * contract and stays that way. This one field is different because
                             * something else on the same screen depends on it: the WhatsApp Chat
                             * panel beside it can only hold a conversation with a number the server
                             * knows, so a number typed and left unsaved is a chat that works until
                             * the popup closes and then does not.
                             *
                             * Only once the number is finished - the tenth digit of an Indian
                             * number, the last of whatever its country allows. A partial number is
                             * never written, so nothing is saved on the way to typing something.
                             */
                            if (key === "whatsappNumber" && isCompletePhoneNumber(phone)) onCommitLead?.(key, phone);
                          }
                          : (event) => onUpdateLead(key, event.target.value)}
                      />
                    );
                  })}
                  </div>
                  ))}
                </div>
              </section>

              {/* Same as the tabs card opposite: `flex-1` is a share of a column that only
                  exists from `lg`, and stacked it collapsed Event Details to nothing. From `lg` it
                  fills what Client Details leaves, but never less than room for its rows - past
                  that the column scrolls. */}
              <section className="flex flex-col overflow-hidden rounded-[1.3rem] bg-white lg:min-h-[20rem] lg:flex-1">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-[18px] font-medium text-slate-700">Event Details</h3>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                  <ShootDetailsTable shoots={shoots} shootTypeOptions={suggestions.shootType} shootTypeStatus={suggestions.status?.shootType} onRetryShootTypes={suggestions.reload} onChangeRow={(index, key, value) => onUpdateShootRow(index, key, value)} onRemoveRow={(index) => onUpdateShootRow(index, "remove")} onAddRow={() => onUpdateShootRow(-1, "add")} />
                </div>
              </section>
            </div>

            <div className="flex flex-1 flex-col gap-4 lg:h-full lg:min-h-0 lg:overflow-hidden">
              {/* `flex-[1.2]` sets a flex-basis of zero, which is a share of the space beside
                  Follow-up Details - and zero height when the two are stacked with no free space
                  to share, so the whole tab card vanished on a phone. It applies from `lg`, where
                  there is a column to divide. */}
              <section className="flex flex-col overflow-hidden rounded-[1.3rem] bg-white lg:min-h-0 lg:flex-[1.2]">
                <div className="border-b border-slate-200 px-5 py-4">
                  {/* WhatsApp Chat is only offered while the studio switch is on. Off, there is
                      nothing behind the tab - no session may be linked and nothing may be sent -
                      so it is taken away rather than left to be pressed and explain itself. */}
                  {/* Five tabs do not fit a phone. The strip scrolls sideways on its own -
                      the panel behind it must never scroll sideways - and the scrollbar is
                      hidden because the cut-off tab at the edge already says there is more. */}
                  {/*
                    Transcripts and AI Assistant are their own screens, not another tab.

                    Both are opened from the ⋮ and both fill the panel, so the strip of tabs behind
                    them is only clutter - four headings for places you are not, above a view that
                    never named itself. In their place the view says what it is, with the way back
                    beside it.
                  */}
                  {openMenuTab ? (
                    <div className="flex items-center gap-2">
                      <IconButton
                        label="Back"
                        onClick={() => setLeadTab(tabBeforeMenu)}
                        className="-ml-1 text-slate-600 hover:text-blue-700"
                      >
                        <ChevronIcon direction="left" size={20} />
                      </IconButton>
                      <span className="text-base font-semibold text-slate-800">{openMenuTab.label}</span>
                    </div>
                  ) : (
                  <div className="flex items-center gap-2">
                  <div className="-mx-1 flex min-w-0 flex-1 gap-6 overflow-x-auto px-1 text-sm [scrollbar-width:none] sm:gap-8 [&::-webkit-scrollbar]:hidden">
                    {visibleLeadTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setLeadTab(tab.id)}
                        className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-2 py-1.5 transition ${leadTab === tab.id ? "border-blue-600 text-blue-600" : "border-transparent text-slate-600 hover:text-slate-900"}`}
                      >
                        {tab.label}
                        {/* How many projects this lead became, said on the tab the way the CNA
                            pill says how many attempts it has had. Only once there is one: a
                            "(0)" beside a tab reads as a count that failed to load rather than
                            as a lead that has not converted yet. */}
                        {tab.id === "converted" && projects.length > 0 && ` (${projects.length})`}
                        {/* Whether the CRM's WhatsApp is linked, said the way every other state
                            in this module is said - the same 8px dot the Status column and the
                            lead pills use, in the module's own three colours. */}
                        {tab.id === "whatsapp" && (
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 shrink-0 rounded-full ${WHATSAPP_DOT[whatsappDot] || WHATSAPP_DOT.disconnected}`}
                          />
                        )}
                        <span className="sr-only">
                          {tab.id === "whatsapp" ? ` (${WHATSAPP_DOT_LABEL[whatsappDot] || WHATSAPP_DOT_LABEL.disconnected})` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                  {/*
                    The overflow, pinned to the right edge of the strip.

                    `shrink-0` so it holds that corner while the tabs beside it scroll under it on
                    a narrow screen - a ⋮ that scrolls away is a ⋮ nobody finds. The trigger is the
                    module's own OptionsMenu, so it is the same control as every other ⋮ here.
                  */}
                  <OptionsMenu
                    ariaLabel="More lead views"
                    menuClassName="w-48"
                    // Above the popup, which is itself portalled over the page.
                    menuZIndexClassName="z-[140]"
                    triggerClassName={`shrink-0 ${LEAD_POPUP_MENU_TABS.some((tab) => tab.id === leadTab) ? "text-blue-600" : "text-slate-500"}`}
                    // No tick: the trigger turning blue already says which view is on screen, and a
                    // tick beside a single row reads as a setting that can be switched off.
                    items={LEAD_POPUP_MENU_TABS.map((tab) => ({
                      label: tab.label,
                      onSelect: () => setLeadTab(tab.id),
                    }))}
                  />
                  </div>
                  )}
                </div>

                {leadTab === "remarks" && (
                  <div ref={remarksPane} className="flex min-h-0 h-full flex-1 flex-col overflow-y-auto px-4 py-4 sm:px-5">
                    {/* Above the remarks rather than below the composer.

                        The list of remarks and the box for a new one can be taller than the pane,
                        so a message under them was off the bottom of a scrolled tab - the update
                        was refused and the reason was somewhere the user could not see. At the
                        top it is the first thing in the tab whichever way it is scrolled. It
                        still only appears once an update has been turned away, and clears itself
                        the moment something is typed or posted. */}
                    {showRemarkError && !hasRemark && (
                      <p role="alert" className="mb-3 shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 sm:text-sm">
                        Add a remark before updating this lead.
                      </p>
                    )}
                    <NotesComposer
                      onUploadAttachment={uploadRemarkAttachment}
                      onFetchAttachment={fetchRemarkAttachment}
                      key={displayLead.id}
                      value={displayLead.remarks || ""}
                      entries={leadRemarkEntries(displayLead.remarkEntries, displayLead.remarks)}
                      onPendingChange={setRemarkDraftFilled}
                      commitRef={commitRemarkRef}
                      onEntriesChange={(nextEntries) => {
                        // Only a genuinely new remark unlocks the update. Rewriting or
                        // removing one also lands here, and neither is a record of this call.
                        const before = leadRemarkEntries(displayLead.remarkEntries, displayLead.remarks).length;
                        if (nextEntries.length > before) setRemarkAdded(true);
                        // `post: false` while an update is committing this note - see `attemptSave`.
                        onUpdateRemarks?.(nextEntries, { post: !skipRemarkPostRef.current });
                      }}
                      attachments={displayLead.attachments || []}
                      onAttachmentsChange={(value) => onUpdateDetails("attachments", value)}
                      // Files this lead's remarks carry are filed under this lead in the bucket.
                      enquiryId={displayLead.id}
                      className="w-full"
                      placeholder="I add your notes here..."
                    />
                  </div>
                )}

                {leadTab === "activity" && (
                  activityLoading ? (
                    <div className="flex min-h-[20rem] items-center justify-center p-5 text-sm text-slate-500">
                      Loading activity...
                    </div>
                  ) : activity.length ? (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                      <SimpleTable
                        variant="card"
                        /* `table-fixed`, or the Activity column would not stay inside the card.
                           Its filter is a plain input, and an input carries a browser default width
                           of its own; under auto layout that becomes the column's minimum, so User's
                           10rem plus Time's 14rem plus that default overflowed the panel and the box
                           ran out under the right edge. The two comboboxes never did it because a
                           div has no intrinsic width. Fixed layout takes the widths from the header
                           row and lets Activity absorb whatever is left.

                           The heading is title case and bold, matching the lead table's headings -
                           set here directly rather than through the global rule keyed on
                           `.border-separate thead.uppercase`, which a border-collapse table never
                           reaches. */
                        classNames={{ wrapper: "!overflow-hidden", table: "table-fixed", head: "sticky top-0 z-30", row: "align-top" }}
                        columns={[
                          { key: "user", label: "User", headerClassName: "w-40", cellClassName: "font-semibold text-slate-800", render: (entry) => entry.actorName || "User" },
                          { key: "time", label: "Time", headerClassName: "w-52", cellClassName: "whitespace-nowrap text-slate-500", render: (entry) => formatActivityTime(entry.createdAt) },
                          {
                            key: "activity",
                            label: "Activity",
                            cellClassName: "text-slate-600",
                            render: (entry) => {
                              const detail = activityDetail(entry);
                              return <>
                                <span className="font-semibold text-slate-800">{activityTitle(entry)}</span>
                                {detail ? <span className="text-slate-500"> | {detail}</span> : null}
                              </>;
                            },
                          },
                        ]}
                        headerRow={(
                          <tr>
                            <th className="border-b border-slate-200 px-3 py-2">
                              {/* A closed set - only the people who have touched this lead can
                                  appear - so it offers its list, and can still be typed into like
                                  every other filter in the module. */}
                              <FilterCombobox
                                ariaLabel="Filter activity by user"
                                value={activityFilters.user}
                                onChange={(value) => setActivityFilters((current) => ({ ...current, user: value }))}
                                options={activityUsers}
                              />
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2">
                              <FilterDateInput
                                ariaLabel="Filter activity by date"
                                value={activityFilters.time}
                                onChange={(value) => setActivityFilters((current) => ({ ...current, time: value }))}
                              />
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2">
                              <input
                                value={activityFilters.activity}
                                onChange={(event) => setActivityFilters((current) => ({ ...current, activity: event.target.value }))}
                                placeholder="Filter"
                                aria-label="Filter activity"
                                size={1}
                                className="min-h-7 w-full min-w-0 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                              />
                            </th>
                          </tr>
                        )}
                        rows={visibleActivity}
                        emptyMessage="No activity matched the filters."
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-[20rem] items-center justify-center p-5 text-sm text-slate-500">
                      No activity logs available.
                    </div>
                  )
                )}

                {/*
                  The calls Callyzer has reported against this lead.

                  Same card, headings and dividers as Activity Logs and Converted History either
                  side of it, and the same `overflow-x-auto` container: seven columns do not fit a
                  phone, so the table scrolls inside its own box rather than the panel scrolling
                  sideways.
                */}
                {leadTab === "call" && (
                  callLogsLoading ? (
                    <div className="flex min-h-[20rem] items-center justify-center p-5 text-sm text-slate-500">
                      Loading call logs...
                    </div>
                  ) : callLogs.length ? (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                      <SimpleTable
                        variant="card"
                        classNames={{ row: "align-top" }}
                        columns={[
                          {
                            key: "callType",
                            label: "Call Type",
                            cellClassName: "whitespace-nowrap",
                            render: (call) => <>
                              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${callTypeTone(call.callType)}`}>
                                {call.callType || "Call"}
                              </span>
                              {/* WhatsApp calls and video calls are a different thing from a phone
                                  call, and Callyzer is the only place that says so. */}
                              {call.callMethod && call.callMethod !== "PhoneCall" ? (
                                <span className="mt-1 block text-[11px] text-slate-500">
                                  {call.callMethod}{call.callMode ? ` · ${call.callMode}` : ""}
                                </span>
                              ) : null}
                            </>,
                          },
                          {
                            key: "when",
                            label: "Date & Time",
                            cellClassName: "whitespace-nowrap text-slate-600",
                            // The fallback for a call with no timestamp reads on the same clock as
                            // the stamp it stands in for - Callyzer sends its `call_time` as 24-hour,
                            // and a list where some rows say "04:30 pm" and others "16:30" is one
                            // nobody can scan.
                            render: (call) => formatActivityTime(call.calledAt) || `${call.callDate || ""} ${toTwelveHourClock(call.callTime)}`.trim() || "—",
                          },
                          { key: "duration", label: "Duration", cellClassName: "whitespace-nowrap text-slate-600", render: (call) => formatCallDuration(call.durationSeconds) },
                          // Who took the call - the answer to "who has spoken to this client", which
                          // is the same question the CRM column answers.
                          { key: "crm", label: "CRM", cellClassName: "whitespace-nowrap font-semibold text-slate-800", render: (call) => call.employeeName || "—" },
                          { key: "status", label: "Call Status", cellClassName: "whitespace-nowrap text-slate-600", render: (call) => call.crmStatus || "—" },
                          {
                            key: "note",
                            label: "Note",
                            headerClassName: "!whitespace-normal",
                            cellClassName: "text-slate-600",
                            render: (call) => (call.note ? <span className="whitespace-pre-line">{call.note}</span> : <span className="text-slate-400">—</span>),
                          },
                          {
                            key: "recording",
                            label: "Recording",
                            // Streamed from Callyzer, which is where the file lives. `preload="none"`
                            // so opening the tab does not fetch every recording at once - a lead with
                            // twenty calls would pull twenty MP3s nobody asked to hear.
                            render: (call) => (call.recordingUrl ? (
                              <audio controls preload="none" src={call.recordingUrl} className="h-9 w-56 max-w-full">
                                <a href={call.recordingUrl} target="_blank" rel="noreferrer">Open recording</a>
                              </audio>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )),
                          },
                        ]}
                        rows={callLogs}
                      />
                    </div>
                  ) : (
                    <div className="flex min-h-[20rem] items-center justify-center p-5 text-sm text-slate-500">
                      No call logs available.
                    </div>
                  )
                )}

                {/* The lead itself, not just its id: enquiry ids are reissued after a deletion, so the
                    stored thread is keyed to this lead's own creation stamp. See LeadAiPanel. */}
                {leadTab === "ai" && <LeadAiPanel leadId={lead?.id} lead={lead} onError={onError} />}

                {leadTab === "transcripts" && (
                  <CallTranscriptsTab
                    transcripts={transcripts}
                    loading={transcriptsLoading}
                    // A lead's transcripts are the CRM's own, behind `SALES / CRM Leads`.
                    loadDetail={(id) => apiRequest(`/api/sales/crm-leads/transcripts/${encodeURIComponent(id)}`)}
                    onError={onError}
                  />
                )}

                {leadTab === "converted" && (
                  activityLoading ? (
                    <div className="flex min-h-[20rem] items-center justify-center p-5 text-sm text-slate-500">
                      Loading converted history...
                    </div>
                  ) : projects.length ? (
                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                      {/* What the lead actually became, read live from Sales Manager. This is
                          the answer to "what did we sell them", and it reads first - the
                          status change underneath is the paperwork, this is the outcome.
                          More than one row is correct: a client who comes back for a second
                          shoot is converted again against the same enquiry. */}
                      {projects.length > 0 && (
                        <div>
                          <h4 className="mb-2 text-sm font-semibold text-slate-600">
                            {projects.length > 1 ? `Projects created (${projects.length})` : "Project created"}
                          </h4>
                          {/* Said once above the table rather than as a hint on every row: the
                              gesture is the same one every table in the OS answers, and a row that
                              opens something has to say so somewhere or it is only found by
                              accident. */}
                          <p className="mb-2 text-xs text-slate-500">Double-click a project to read it in full.</p>
                          {/* Same card, headings and dividers as the Activity Logs table
                              beside it, so a project does not look like a different kind of
                              thing from the rest of the tab. */}
                          <SimpleTable
                            variant="card"
                            columns={[
                              { key: "eventId", label: "Event ID", cellClassName: "whitespace-nowrap font-semibold text-slate-800", render: (project) => project.eventId || "—" },
                              { key: "project", label: "Project", headerClassName: "!whitespace-normal", cellClassName: "text-slate-600", render: (project) => project.whatsappGroupName || "—" },
                              // The number the project was created against, next to the project it
                              // belongs to. A lead can convert more than once, and the number is what
                              // says which client each one is for.
                              { key: "clientMainNumber", label: "Client Main Number", cellClassName: "whitespace-nowrap text-slate-600", render: (project) => project.clientMainNumber || "—" },
                              { key: "convertedAmount", label: "Converted Amount", cellClassName: "whitespace-nowrap text-slate-600", render: (project) => formatConvertedAmount(project.initialConvertedValue) },
                              { key: "crm", label: "CRM", headerClassName: "!whitespace-normal", cellClassName: "text-slate-600", render: (project) => project.crmName || "—" },
                              { key: "branch", label: "Branch", headerClassName: "!whitespace-normal", cellClassName: "text-slate-600", render: (project) => project.sourceBranch || verticalCode(project.vertical) || "—" },
                              // A project can be started before the date is settled, which the form
                              // records as its own flag rather than as a blank date.
                              { key: "mainEventDate", label: "Main Event Date", cellClassName: "whitespace-nowrap text-slate-600", render: (project) => (project.mainEventDate ? formatDate(project.mainEventDate) : project.mainEventDateKnown ? "—" : "Not decided") },
                              { key: "status", label: "Status", headerClassName: "!whitespace-normal", cellClassName: "text-slate-600", render: (project) => project.projectStatus || "—" },
                              { key: "createdOn", label: "Created On", cellClassName: "whitespace-nowrap text-slate-500", render: (project) => formatActivityTime(project.createdAt) },
                            ]}
                            rows={projects}
                            /*
                             * The row is the way into the project, because the row *is* the project -
                             * Converted History could say a project existed and name it, and then
                             * the trail stopped: reading what was actually sold meant leaving the
                             * lead, opening Sales Manager and finding the Event ID again by hand.
                             *
                             * Double click, which is the gesture every table in the OS answers with
                             * the record - a single click on a row is how people select one, and
                             * opening a panel on it would fire on a gesture nobody meant as an
                             * instruction.
                             *
                             * `role="button"` with Enter and Space beside it because a double click
                             * cannot be made with a keyboard: without these the only route to a
                             * project would be a mouse, which is the shape "the feature exists but
                             * not for you" usually takes.
                             */
                            rowProps={(project) => ({
                              role: "button",
                              tabIndex: 0,
                              "aria-label": `Open project ${project.eventId || project.whatsappGroupName || ""}`,
                              onDoubleClick: () => setViewingProjectId(project.id),
                              onKeyDown: (event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                // Space scrolls the pane underneath otherwise, which moves the table
                                // out from under the row that was just opened.
                                event.preventDefault();
                                setViewingProjectId(project.id);
                              },
                              className: "cursor-pointer align-top transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
                            })}
                          />
                        </div>
                      )}

                      {/*
                        * The project itself, read the same way Sales Manager reads it.
                        *
                        * `ProjectRecordPanel` rather than a panel of this popup's own, so a field
                        * added to a project appears here without the CRM learning about it - and so
                        * a project looks like the same kind of thing wherever it is opened from.
                        *
                        * `commonProjectInfoSections` is the sale's own reading: identity, client and
                        * branch, planning, deliverables, the WhatsApp group and the timestamps. Not
                        * the workflow - shoots, service allocations, post-production - which belongs
                        * to Project Management's permission rather than the CRM's, and is not what
                        * this endpoint reads. Payments are Accounts' figures and are not offered
                        * here at all.
                        *
                        * It portals to the body, so it does not matter that it is written inside a
                        * scrolling pane; the layer does, and it is named because the lead popup this
                        * sits in is already above the record view's own.
                        */}
                      {viewingProject && <ProjectRecordPanel
                        project={viewingProject}
                        sections={commonProjectInfoSections}
                        zIndexClassName="z-[160]"
                        onClose={() => setViewingProjectId(null)}
                      />}
                    </div>
                  ) : (
                    <div className="flex min-h-[20rem] items-center justify-center p-5 text-sm text-slate-500">
                      No project has been created from this lead yet.
                    </div>
                  )
                )}

                {/* Mounted only while its own tab is open: the panel polls, and a chat kept
                    running behind Remarks would poll for a lead nobody is looking at. */}
                {leadTab === "whatsapp" && (
                  <WhatsAppChatPanel
                    canWrite={canWrite}
                    leadId={displayLead.id}
                    leadName={displayLead.name}
                    /*
                     * The WhatsApp Number as it stands in the form beside this panel, saved or not.
                     *
                     * `displayLead` is the stored lead with the popup's draft laid over it, so this
                     * is what the field on the left is showing. The popup holds its edits until
                     * Update, so without passing it the chat would say "no number on this lead"
                     * about a number the CRM has just typed in and is looking straight at - and
                     * messaging a new client would mean saving the lead first.
                     *
                     * The server takes it only when it is a whole, valid number, and still refuses
                     * to send to one that is not on WhatsApp. A half-typed or absent number leaves
                     * the panel exactly as it is today.
                     */
                    draftPhone={displayLead.whatsappNumber || ""}
                    onNotice={onNotice}
                    onError={onError}
                    // The panel's own connects and unlinks, so those show at once rather than
                    // waiting for the next poll. It reports this CRM's session only, so a
                    // studio-wide block is left to the poll above - which is the one thing that
                    // knows about it.
                    onSessionChange={(status) => setWhatsappDot((current) => (current === "blocked"
                      ? current
                      : status === "connected" ? "connected" : "disconnected"))}
                  />
                )}
              </section>

              <section className="shrink-0 overflow-hidden rounded-[1.3rem] bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-[18px] font-semibold text-slate-800">Follow-up Details</h3>
                </div>
                <div className="space-y-4 px-5 py-5">
                  <fieldset className="space-y-2">
                    <legend className="text-[15px] font-semibold text-slate-600">Lead Status<HelpTip text="Pick where this lead stands after the latest follow-up." /></legend>
                    <LeadStatusPills
                      value={displayLead.leadStatus}
                      /*
                       * CNA is chosen here and counted at the save, like every other status.
                       *
                       * It used to post the moment it was pressed, each press raising the number:
                       * six presses took a lead to Rejected without anything being saved in
                       * between, which made an unanswered call something you could record by
                       * accident - and gave the pill no way to be un-chosen, since it had already
                       * been written. Now it selects, and **CNA and Proceed Next** below is what
                       * records the attempt. Choosing it and pressing Update does the same; the
                       * count follows the save, not the press.
                       *
                       * Converted still goes to its own handler: it hands the lead to Sales
                       * Manager in a second tab, which is not a status this form can write.
                       */
                      // Converting writes the lead now, so it asks for the same fields a save does
                      // before it will open the confirmation - see `attemptConvert`.
                      onChange={(value) => (opensProjectFor(value)
                        ? attemptConvert(value)
                        : onUpdateDetails?.("leadStatus", value))}
                      options={leadStatusOptionsForVertical(vertical)}
                      counts={{ CNA: cnaCount }}
                      // Every status locks, not only CNA. A lead the limit rejected is done
                      // being worked - offering to move it back to Interested or Followup
                      // would undo the rule the moment it fired.
                      // Converting and CNA post the moment they are pressed rather than waiting for
                      // Update, so read-only has to stop them here rather than at the footer.
                      disabledValues={!canWrite || cnaExhausted(displayLead) ? leadStatusOptionsForVertical(vertical).map((option) => option.value) : []}
                      disabledTitle={canWrite ? `This lead went unanswered ${MAX_CNA_ATTEMPTS} times and was Rejected.` : "You have read-only access to CRM leads."}
                    />
                  </fieldset>
                  {/* Last Follow-up Date is not asked for on any vertical: the log already says
                      when this lead was last worked, and a date typed here only disagreed with it.
                      The column and its filter stay, for the leads that already carry one. */}
                  {/* A lead being turned down is not being chased, so it has no next call to book
                      - the same rule Add Lead and Bulk Update already applied, through the same
                      list, and the one place the popup was still asking. The press that chooses
                      the status also clears whatever date the lead was carrying; see
                      `followUpClearedBy` for why hiding the fields alone would not be enough. */}
                  {/* A converted lead has had its last follow-up and has no next call to book. The
                      date is said rather than offered as a field: every save from this popup stamps
                      it with today (`leadWorkedTodayPatch`), so an edit here would not survive. */}
                  {String(displayLead.leadStatus || "").trim() === "Converted" && dropsNextFollowUp(displayLead.leadStatus, displayLead.vertical) ? (
                    <p className="text-xs font-normal text-slate-500 sm:text-sm">
                      {displayLead.lastFollowUpDate ? `Last Follow-up Date: ${displayLead.lastFollowUpDate}. ` : ""}Converted leads have no next follow-up.
                    </p>
                  ) : STATUSES_WITHOUT_FOLLOW_UP.includes(String(displayLead.leadStatus || "").trim()) ? (
                    /* Said rather than left as a gap, in the same words Bulk Update uses: two
                       fields that were there a moment ago and are now missing is worth one line. */
                    <p className="text-xs font-normal text-slate-500 sm:text-sm">
                      Follow-up dates are not set for {String(displayLead.leadStatus).trim()} leads.
                    </p>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <DateField
                        label="Next Follow-up Date"
                        helperText="The day this lead is due a call; it shows on Pending Followups."
                        value={displayLead.nextFollowUpDate || ""}
                        onChange={(value) => onUpdateDetails?.("nextFollowUpDate", value)}
                        required={isRequiredLeadField("nextFollowUpDate", requiredForStatus || displayLead.leadStatus, displayLead.name, { vertical, popup: true })}
                        error={requiredMarks.errors.nextFollowUpDate && !String(displayLead.nextFollowUpDate ?? "").trim()
                          && isRequiredLeadField("nextFollowUpDate", requiredForStatus || displayLead.leadStatus, displayLead.name, { vertical, popup: true })
                          ? requiredMarks.errors.nextFollowUpDate : ""}
                      />
                      <TimeField label="Next Follow-up Time" helperText="The time to call back on the follow-up day." value={displayLead.nextFollowUpTime || ""} onChange={(event) => onUpdateDetails?.("nextFollowUpTime", event.target.value)} />
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
        </ReadOnlyFieldset>

        {/* A `<footer>` rather than a bordered `<div>`: it is the popup's footer, and the rule about
            where a footer's buttons sit is read off every footer in the application
            (`test/form-footer-buttons.test.mjs`) - a footer that does not say it is one escapes it. */}
        {/* `pr-24` keeps the last button clear of the Nebula AI button, which floats over this corner. */}
        <footer className="border-t border-slate-200 bg-white py-4 pl-5 pr-24">
          {/* One group at the right, as every footer in the application now reads (`SchemaFormPanel`,
              `ui/Dialog`). It was `justify-between`, which left Back alone at the far edge with a
              hole across the middle of the row. */}
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            {/* Back rather than Cancel: the popup writes each edit as it is made, so there
                was never anything for a Cancel to undo - it only closed. Stepping back to the
                lead above is the useful other half of Update and Proceed Next, and the × in
                the header still closes. */}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => onBack?.()} className="rounded-md">Back</Button>
            </div>
            {canWrite && <div className="flex flex-wrap items-center gap-3">
              {/* The buttons stay live and answer when pressed. Disabled ones with a list of
                  names beside them left the user to work out which box on a long form the
                  names referred to; pressing now marks those boxes instead. */}
              <Button variant="secondary" onClick={() => attemptSave(false, true, "CNA")} busy={updatingLead} className="rounded-md bg-blue-50 text-blue-600">
                CNA and Proceed Next
              </Button>
              <Button variant="primary" onClick={() => attemptSave(true)} busy={updatingLead} className="rounded-md disabled:bg-slate-300">
                Update and Close
              </Button>
              <Button variant="primary" onClick={() => attemptSave(false, true)} busy={updatingLead} className="rounded-md disabled:bg-slate-300">
                Update and Proceed Next
              </Button>
            </div>}
          </div>
        </footer>
      </div>

      {/* "This number is already an enquiry", over the popup that is about to save it.

          Inside the popup rather than in the board around it, because the popup is opened from two
          places - the CRM board and the Contacts directory, through `LeadPopupHost` - and the
          warning belongs to whichever one has the record open. */}
      {clashAlert && (
        <DuplicateEnquiryDialog
          phone={clashAlert.phone}
          leads={clashAlert.leads}
          // The vertical this lead is in. A number moved onto a client this vertical already holds
          // is refused; the same number on another vertical's enquiry is only worth naming.
          vertical={clashAlert.vertical || vertical}
          intent="edit"
          onClose={() => setClashAlert(null)}
          /*
           * The other enquiry, opened where this popup was.
           *
           * The edit is left unsaved on purpose: it is the number of a client the CRM already holds,
           * and the record that holds it is the one worth reading before deciding what to do.
           */
          onOpenEnquiry={(enquiryId) => {
            setClashAlert(null);
            onOpenLead?.(enquiryId);
          }}
          /*
           * Offered only when an Update was interrupted.
           *
           * Raised from the line under the Contact box, this dialog is telling somebody something
           * while they are still typing - there is no save to go on with, and a button reading
           * "Save anyway" that saved a half-finished edit would be a trap. The dialog shows only the
           * way to the other enquiry then, and Escape or the × closes it.
           */
          onContinue={clashAlert.saving ? () => {
            const pending = clashAlert;
            setClashAckPhone(pending.phone);
            setClashAlert(null);
            // Committed without posting and handed to the save, exactly as `attemptSave` does it -
            // this is the same interrupted press, so it must not race its own update either.
            let committedEntries = null;
            if (remarkDraftFilled) {
              skipRemarkPostRef.current = true;
              try {
                committedEntries = commitRemarkRef.current?.() || null;
              } finally {
                skipRemarkPostRef.current = false;
              }
            }
            // The same save that was interrupted, with the answers it was called with rather than
            // whatever the buttons would supply now - and through the same wrapper, so a note it
            // committed is not lost if that save is refused.
            void saveWithCommittedNote(pending.closeAfter, pending.advanceAfter, pending.forcedStatus, committedEntries);
          } : undefined}
        />
      )}

      {/* Update with a vertical picked: the same words Bulk Update gives, before anything is written. */}
      <ConfirmDialog
        open={Boolean(confirmMove && pendingVertical)}
        layer="confirmOverDialog"
        title={`Update and move ${displayLead.id || "this lead"} to ${pendingVertical}?`}
        message={`${verticalMoveWarning(vertical, pendingVertical)} If this number is already an enquiry in ${pendingVertical}, the lead is not moved.`}
        confirmLabel={`Update and move to ${pendingVertical}`}
        cancelLabel="Go back"
        tone="danger"
        onCancel={() => setConfirmMove(null)}
        onConfirm={() => {
          const press = confirmMove;
          setConfirmMove(null);
          attemptSave(press.closeAfter, press.advanceAfter, press.forcedStatus, true);
        }}
      />

      {/* Nebula for the lead on screen, in the one corner of a form that is reliably empty.
          `scope="lead"` inside the panel is what keeps it about this person rather than the
          pipeline - it reads this record's own remarks, calls, transcripts and WhatsApp. */}
      <LeadNebulaButton leadId={displayLead.id} lead={displayLead} onError={onError} />
    </div>,
    document.body,
  );
}

/**
 * The lead popup, opened from a screen that is not the CRM board.
 *
 * `LeadPopupModal` above is a form and nothing else - it is handed a lead, its details and every
 * handler it needs, and the CRM board is what has always supplied them out of the state it keeps
 * for its own table. That is why opening a lead from elsewhere used to mean *going* to the CRM:
 * only that page could feed the popup.
 *
 * This is that supply, for one lead, with no table behind it. It reads the lead and its tabs from
 * the same endpoints the board reads, holds the same unsaved-edit draft, and writes with the same
 * requests - so the Contacts directory opens the identical popup, on the page the reader is
 * already on, rather than sending them to another module to see it.
 *
 * ── What is different, and why ────────────────────────────────────────────────────────────────
 *
 * `queue` is the list of lead ids Back and "Proceed Next" step through - on the board that is the
 * visible rows, and here it is whatever the calling screen is showing. Given nothing to step to,
 * both simply close: a lead opened on its own has nowhere to proceed to, and a button that
 * silently does nothing is worse than one that finishes.
 *
 * Everything the popup writes goes to the server and is patched into the record held here, the way
 * the board patches its own row rather than refetching - so what is on screen stays put while the
 * reader is working in it. The calling screen is told through `onChanged` when something was
 * written, and decides for itself whether its own list needs re-reading.
 *
 * Mount it with `key={leadId}`: a new lead is a new popup - fresh draft, fresh tabs, opened on
 * Remarks - and remounting is what states that plainly.
 */
export function LeadPopupHost({ leadId, queue = [], canWrite = true, onOpenLead, onClose, onNotice, onError, onChanged }) {
  // `{ lead, details }` as the server holds it, or null while it is being read. The popup draws
  // nothing until it arrives, which is why `open` below waits for it.
  const [record, setRecord] = useState(null);
  // Edits made in the popup, held until one of its Update buttons is pressed - the same bargain
  // the board's own popup makes, so nothing typed here is in the CRM before it is finished.
  const [draft, setDraft] = useState({ lead: {}, details: {} });
  const [leadTab, setLeadTab] = useState("remarks");
  // Bumped whenever something is written, which is what re-reads the log, the calls, the
  // transcripts and the converted projects together.
  const [refreshKey, setRefreshKey] = useState(0);
  const [customFieldsByVertical, setCustomFieldsByBranch] = useState({});
  const [chatEnabled, setChatEnabled] = useState(true);
  const [duplicateEnquiries, setDuplicateEnquiries] = useState(null);
  // `null` is "not read yet" rather than "none", which is what the tabs show as loading.
  const [activity, setActivity] = useState(null);
  const [callLogs, setCallLogs] = useState(null);
  const [transcripts, setTranscripts] = useState(null);
  const [projects, setProjects] = useState([]);
  /*
   * Which converted status is waiting to be confirmed, or "" for none.
   *
   * A string rather than a boolean: Qua Qua offers "Converted & Followup" beside "Converted" and
   * both open Create Project, so the dialog has to remember which pill was pressed - it is what the
   * project's save marks the lead with.
   */
  // Convert navigates in this tab now rather than opening a second one.
  const router = useRouter();
  const [confirmConvert, setConfirmConvert] = useState("");
  const [meetingsOpen, setMeetingsOpen] = useState(false);

  useEffect(() => {
    if (!leadId) return undefined;
    let active = true;
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}`)
      .then((response) => {
        const data = response?.data;
        if (!active) return;
        if (!data?.lead) {
          // Closed rather than left as an empty popup: a lead deleted since the calling list was
          // read is a real answer, and leaving the id open would make the same row unopenable.
          onError?.("That lead could not be found.");
          onClose?.();
          return;
        }
        setRecord({ lead: leadFromRecord(data), details: data.details || {} });
      })
      .catch((error) => {
        if (!active) return;
        onError?.(error.message || "That lead could not be opened.");
        onClose?.();
      });
    return () => { active = false; };
  }, [leadId, onClose, onError]);

  // The Table Settings fields, so a custom field edited in the popup is written into
  // `customFields` rather than as a column the lead does not have.
  useEffect(() => {
    let active = true;
    void apiRequest("/api/sales/crm-leads/table-settings")
      .then((response) => { if (active) setCustomFieldsByBranch(groupCustomFieldsByBranch(response?.data)); })
      .catch(() => { if (active) setCustomFieldsByBranch({}); });
    return () => { active = false; };
  }, []);

  // The studio's WhatsApp switch, which decides whether the popup offers a WhatsApp Chat tab.
  // A failed read is not an answer, so the tab keeps whatever it last said.
  useEffect(() => {
    let cancelled = false;
    void getWhatsappSession()
      .then((response) => { if (!cancelled && response?.data) setChatEnabled(response.data.chatEnabled !== false); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /*
   * The four tabs behind the form, read together and re-read together.
   *
   * One effect rather than the board's four: they share a key, they are all "rows or nothing", and
   * a failure on any one of them is an empty tab rather than a message - exactly as on the board,
   * where a log that cannot be read is not a reason to refuse the lead.
   */
  const leadPhone = record ? (record.lead.contactNumber || record.lead.phone || "") : "";
  useEffect(() => {
    if (!leadId) return undefined;
    let cancelled = false;
    const read = async (path) => {
      try {
        const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}/${path}`);
        return Array.isArray(response?.data) ? response.data : [];
      } catch {
        return [];
      }
    };
    void (async () => {
      const [nextActivity, nextCallLogs, nextTranscripts, nextProjects] = await Promise.all([
        read("activity"), read("call-logs"), read("transcripts"), read("projects"),
      ]);
      if (cancelled) return;
      setActivity(nextActivity);
      setCallLogs(nextCallLogs);
      setTranscripts(nextTranscripts);
      setProjects(nextProjects);
    })();
    /*
     * Returning to this tab is the moment somebody comes back from having saved a converted
     * project in the second tab Convert opened, so that is the moment to re-read - the same
     * refresh the board does, for the same reason.
     */
    const onFocus = () => setRefreshKey((key) => key + 1);
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); };
  }, [leadId, refreshKey]);

  // How many times this number has enquired. Answered by the server, because the other enquiries
  // are separate leads that this screen has never loaded.
  useEffect(() => {
    if (!leadId || !leadPhone) return undefined;
    let cancelled = false;
    void getDuplicateEnquiries({ phone: leadPhone, excludeId: leadId })
      .then((response) => { if (!cancelled && response?.data) setDuplicateEnquiries({ leadId, ...response.data }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [leadId, leadPhone]);

  const details = { ...(record?.details || {}), ...draft.details };
  const displayLead = record ? { ...mergeLeadDisplayRecord(record.lead, details), ...draft.lead } : null;
  const vertical = record ? resolveLeadVertical(record.lead, details) : "Dum Dum";

  /*
   * Where Back and Proceed Next go.
   *
   * Wrapping the way the board's do - the last lead's Next is the first one - so a queue is walked
   * round rather than ending in a button that stops working. An empty or single-entry queue leaves
   * both empty, and the two handlers close instead.
   */
  const queueIds = queue.filter(Boolean);
  const position = queueIds.indexOf(leadId);
  const nextLeadId = position < 0 ? "" : queueIds[position + 1] || queueIds[0] || "";
  const previousLeadId = position < 0 ? "" : queueIds[position - 1] || queueIds[queueIds.length - 1] || "";
  const stepTo = (id) => {
    if (!id || id === leadId) { onClose?.(); return; }
    onOpenLead?.(id);
  };

  /*
   * Closing this popup with edits in it asks first, the way the settings rail does.
   *
   * The draft is the whole of what is at stake: every field on this form writes into it and nothing
   * reaches the server until Update, so the × and Escape - which are the same door, see
   * `useEscapeKey` in `LeadPopupModal` - threw away a half-filled lead without a word. On a form
   * this size that is a real loss, and the gesture that causes it is the one people reach for.
   *
   * `useUnsavedGuard` is the settings rail's own question, so the wording and the shape of the
   * answer are the ones this application already asks everywhere else: the choice that loses
   * nothing is the one that needs no decision, and dismissing the dialog keeps the work.
   *
   * Only the popup's own close is guarded. `save()` clears the draft and then closes, and a guard
   * reading state that has not settled yet would ask about edits it had just written; **Update and
   * Proceed Next** steps through `stepTo` for the same reason. Both call `onClose` directly, which
   * is why the guarded wrapper goes to the modal rather than around the prop itself.
   */
  const holdsUnsavedEdits = Object.keys(draft.lead).length > 0 || Object.keys(draft.details).length > 0;
  const { guard: guardClose, confirmProps: closeConfirmProps } = useUnsavedGuard(holdsUnsavedEdits, {
    message: "This lead has edits that have not been saved. Go back and press Update and Close to keep them.",
    confirmLabel: "Discard & Close",
  });

  function draftLead(key, value) {
    setDraft((current) => ({ ...current, lead: { ...current.lead, [key]: value } }));
  }

  function draftDetails(key, value) {
    setDraft((current) => {
      // Plus the occasion's own copy of the field, when this lead has one open - the panel reads an
      // occasion lead's status and follow-up off the occasion, so a draft written only under the
      // ordinary name would not appear. See `occasionEcho`.
      const nextDetails = {
        ...current.details,
        [key]: value,
        ...occasionEcho(displayLead || {}, key, value),
        // Turning a lead down drops the next call it was carrying - see `followUpClearedBy`.
        ...followUpClearedBy(displayLead || {}, key, value),
      };
      // A Table Settings field lives inside `customFields`, so editing one has to write there as
      // well - the same rule the saved path follows.
      if (isCustomFieldKey(key, customFieldsByVertical)) {
        nextDetails.customFields = { ...(current.details.customFields || record?.details?.customFields || {}), [key]: value };
      }
      return { ...current, details: nextDetails };
    });
  }

  /*
   * What every small write does when it lands.
   *
   * The record held here is patched rather than refetched, so the field the user is in does not
   * move under them, and the tabs are re-read because a write is an entry in the log. `onChanged`
   * is deliberately *not* rung here: these are a WhatsApp number and a remark, which no list that
   * opened this popup is showing. Update and CNA ring it themselves, because those can change a
   * name, a number or a status.
   */
  function saved(label) {
    setRefreshKey((key) => key + 1);
    onNotice?.(label ? `${label} saved.` : "Changes saved.");
  }

  /*
   * The one field the popup writes as it is typed. Only the field that changed is sent - the
   * server merges an update onto the stored lead, so nothing absent is written and a stale copy
   * here cannot overwrite what somebody else has since changed.
   */
  function commitLead(key, value) {
    setRecord((current) => (current ? { ...current, lead: { ...current.lead, [key]: value } } : current));
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}`, {
      method: "PUT",
      body: JSON.stringify({ lead: { [key]: value }, details: {} }),
    })
      .then(() => saved(fieldLabelFor(key, vertical, customFieldsByVertical)))
      .catch((error) => onError?.(error.message || "Unable to update CRM lead."));
  }

  /**
   * Remarks post the moment they are added rather than waiting for Update, exactly as on the
   * board - a note written down is not an edit somebody might want to abandon.
   *
   * `post: false` is the one exception, and the same one the board makes: a note committed by
   * pressing Update belongs to that update's write. Sent separately it would race it, carrying the
   * lead as it was last saved, and reverted the update whenever it landed second.
   */
  function updateRemarks(nextEntries, { post = true } = {}) {
    if (!record) return;
    const entries = normalizeRemarkEntries(nextEntries);
    const nextDetails = { ...details, remarkEntries: entries, remarks: remarkSummary(entries) };
    setRecord((current) => (current
      ? { ...current, details: { ...current.details, remarkEntries: entries, remarks: nextDetails.remarks } }
      : current));
    // The save about to run carries these entries, so there is nothing left to send.
    if (!post) return;
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}`, {
      method: "PUT",
      body: JSON.stringify({ lead: record.lead, details: nextDetails }),
    })
      .then(() => saved("Remarks"))
      .catch((error) => onError?.(error.message || "Unable to update CRM lead details."));
  }

  // Event Details rows, drafted rather than written: they are part of what Update saves.
  function updateShootRow(index, key, value) {
    const currentShoots = Array.isArray(details.shoots) && details.shoots.length ? details.shoots : [emptyShootRow()];
    if (key === "remove") {
      const nextShoots = currentShoots.filter((_, shootIndex) => shootIndex !== index);
      draftDetails("shoots", nextShoots.length ? nextShoots : [emptyShootRow()]);
      return;
    }
    if (key === "add") {
      draftDetails("shoots", [...currentShoots, emptyShootRow()]);
      return;
    }
    const nextShoots = [...currentShoots];
    nextShoots[index] = { ...(nextShoots[index] || emptyShootRow()), [key]: value };
    if (key === "shootType" && index === nextShoots.length - 1 && value && nextShoots.length < MAX_SHOOT_ROWS) {
      nextShoots.push(emptyShootRow());
    }
    draftDetails("shoots", nextShoots);
  }

  /**
   * Update, in all three of its forms - Close, Proceed Next, and CNA and Proceed Next.
   *
   * The same body the board's own save builds, including the CNA count and the give-up at the
   * limit, so a lead updated from Contacts and one updated from the CRM are written identically.
   */
  async function save(closeAfter = false, advanceAfter = false, forcedStatus = "", committedEntries = null) {
    if (!record || !displayLead) return false;
    // The same question the panel's own asterisks asked, so the refusal and the marking agree.
    const missing = missingRequiredLeadFields(leadAsSaved(displayLead, forcedStatus), { vertical: resolveLeadVertical(displayLead, details), popup: true });
    if (missing.length) {
      onError?.(markedFieldsMessage(missing.length));
      return false;
    }
    try {
      // The note Update just committed, if there was one - handed in, because the state that
      // carries it has not landed yet. See `attemptSave`.
      const latestRemarkEntries = normalizeRemarkEntries(committedEntries || details.remarkEntries || details.remarks);
      const requestedStatus = forcedStatus || details.leadStatus || displayLead.leadStatus || "Interested";
      const currentSequence = getLeadCnaSequence({ ...displayLead, ...details });
      // Chosen here, not merely already the case - the same rule the board's own popup applies, and
      // for the same reason: otherwise saving an unrelated edit on a lead that is already CNA counts
      // another unanswered call and walks it towards Rejected. See `savePopupLead`.
      const cnaChosenNow = forcedStatus === "CNA"
        || draft.details?.leadStatus === "CNA"
        || draft.lead?.leadStatus === "CNA";
      const isCnaSave = requestedStatus === "CNA" && cnaChosenNow;
      const nextSequence = isCnaSave ? currentSequence + 1 : currentSequence;
      const autoRejected = isCnaSave && nextSequence > MAX_CNA_ATTEMPTS;
      const nextStatus = autoRejected ? "Rejected" : requestedStatus;
      // The first Event Details row with a location sets the lead's City and State.
      const firstLocation = (Array.isArray(details.shoots) ? details.shoots : [])
        .map((shoot) => splitDistrictState(shoot?.districtState))
        .find(Boolean);
      const latestLead = {
        ...displayLead,
        ...leadStatusPatch(displayLead, nextStatus, nextSequence),
        ...(firstLocation ? { city: firstLocation.city, state: firstLocation.state } : {}),
      };
      const latestDetails = {
        ...details,
        ...leadStatusPatch(displayLead, nextStatus, nextSequence > 0 ? nextSequence : details.cnaSequence || currentSequence || undefined),
        remarkEntries: latestRemarkEntries,
        remarks: remarkSummary(latestRemarkEntries) || details.remarks || "",
        // Last, so it wins over whatever the lead arrived carrying - see `leadWorkedTodayPatch`.
        ...leadWorkedTodayPatch(),
      };
      await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}`, {
        method: "PUT",
        body: JSON.stringify({ lead: latestLead, details: latestDetails }),
      });
      setRecord({ lead: { ...latestLead, id: leadId }, details: latestDetails });
      setDraft({ lead: {}, details: {} });
      setRefreshKey((key) => key + 1);
      onChanged?.();
      // What actually happened, which since the pill stopped posting is not the same question as
      // which button was pressed: picking CNA and pressing Update records an attempt too, and saying
      // only "CRM lead updated" would leave the number on the pill looking like it moved by itself.
      onNotice?.(autoRejected
        ? `${MAX_CNA_ATTEMPTS} CNA attempts reached - this lead is now Rejected.`
        : isCnaSave
          ? `Lead marked CNA (attempt ${nextSequence} of ${MAX_CNA_ATTEMPTS}).`
          : "CRM lead updated.");
      if (advanceAfter) { stepTo(nextLeadId); return true; }
      if (closeAfter) onClose?.();
      return true;
    } catch (error) {
      onError?.(error.message || "Unable to update CRM lead.");
      // Reported rather than thrown - the error is already on screen - but answered, so a caller
      // that has something to do next can tell. `convert` uses it to stay on a lead whose
      // conversion was refused instead of opening Create Project for one that never converted.
      return false;
    }
  }

  /*
   * Convert hands the lead to Sales Manager in a second tab and writes nothing here - the lead is
   * marked Converted by that project's own save, so a tab closed without saving leaves it as it
   * was. The same confirmation the board asks for, because the same thing is about to happen.
   */
  /**
   * Converting: the lead is written here and now, and then Create Project is opened on it.
   *
   * It used to write nothing and open a second tab, leaving the project's own save to mark the
   * lead - so a tab closed without saving left it exactly as it was. The studio asked for the
   * opposite: the decision is made when the pill is pressed, so it is recorded then, and Create
   * Project opens **in this tab** rather than beside it.
   *
   * `save` does the writing, with the chosen status forced onto it - the same path Update takes, so
   * a conversion records its remark, its activity and its Last Follow-up Date exactly as any other
   * update does rather than through a second way of writing a lead.
   *
   * `goTo` is what happens afterwards: on to Create Project, or simply closed. Awaited, so a failed
   * save leaves the reader on the lead with the error rather than on a form for a project whose
   * lead was never converted.
   */
  async function convert({ openProject }) {
    const name = displayLead?.name || leadId;
    const status = confirmConvert || "Converted";
    setConfirmConvert("");
    const saved = await save(!openProject, false, status);
    // Refused - the reason is already on screen. Staying here is the point: opening Create Project
    // for a lead that never converted is how somebody books a project against the wrong record.
    if (!saved) return;
    if (openProject) {
      router.push(convertProjectUrl(leadId, status));
      return;
    }
    onNotice?.(`${name} is marked ${status}.`);
  }

  return <>
    <LeadPopupModal
      canWrite={canWrite}
      open={Boolean(record)}
      lead={displayLead}
      details={details}
      onOpenLead={onOpenLead}
      cnaSequence={getLeadCnaSequence(displayLead || {})}
      leadTab={leadTab}
      setLeadTab={setLeadTab}
      chatEnabled={chatEnabled}
      onChatEnabledChange={setChatEnabled}
      activity={activity || []}
      activityLoading={activity === null}
      callLogs={callLogs || []}
      callLogsLoading={callLogs === null}
      transcripts={transcripts || []}
      transcriptsLoading={transcripts === null}
      projects={projects}
      duplicateEnquiries={duplicateEnquiries?.leadId === leadId ? duplicateEnquiries : null}
      onClose={() => guardClose(() => onClose?.())}
      onSave={(closeAfter, advanceAfter, forcedStatus, committedEntries) => save(closeAfter, advanceAfter, forcedStatus, committedEntries)}
      onUpdateLead={draftLead}
      onCommitLead={commitLead}
      onUpdateDetails={draftDetails}
      onUpdateRemarks={updateRemarks}
      onUpdateShootRow={updateShootRow}
      onNotice={onNotice}
      onError={onError}
      onConvert={(status) => setConfirmConvert(status || "Converted")}
      onMoveVertical={canWrite ? async (target) => {
        const response = await moveCrmLeadVertical(leadId, target);
        onNotice?.(response?.message || `${leadId} moved to ${target}.`);
        onChanged?.();
        onClose?.();
      } : undefined}
      onBack={() => stepTo(previousLeadId)}
      onMoveNext={(action) => {
        // The calculator is a page now, opened in a tab of its own on the lead being read - see the
        // note where the dialog used to be defined.
        if (action === "quotation") window.open(`/sales/quotation-calculator?lead=${encodeURIComponent(leadId || "")}`, "_blank", "noopener,noreferrer");
        if (action === "meetings") setMeetingsOpen(true);
      }}
    />
    {/* The question itself. Rendered beside the popup rather than inside it, because it outlives the
        press that raised it and has to still be there while the popup is deciding whether to go.

        `dialogOverPanel` because the popup it is asking about covers the page at z-[120], and a
        dialog's own layer is z-[100] - so this drew *behind* the form, dimming it and showing
        nothing, which reads as a press that did nothing at all. That layer exists for exactly this:
        a confirmation over a form being filled in. */}
    <ConfirmDialog {...closeConfirmProps} layer="dialogOverPanel" />
    {meetingsOpen && <MeetingsDialog
      lead={displayLead || { id: leadId }}
      onClose={() => setMeetingsOpen(false)}
      onNotice={onNotice}
    />}
    {confirmConvert && (
      <div
        className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/55 p-4"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmConvert(""); }}
      >
        <section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="contacts-convert-title"
          className="w-full max-w-[440px] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
        >
          <div className="px-6 pb-5 pt-6">
            <h2 id="contacts-convert-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800">
              Do you want to convert this lead?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {displayLead?.name || "This lead"} · {leadId} is marked {confirmConvert || "Converted"} and saved either
              way. <strong className="font-semibold">Convert</strong> then opens Create Project on it with its details
              filled in; <strong className="font-semibold">Update and Close</strong> records the conversion and leaves
              you here, for a lead that is converted but not being booked yet.
            </p>
          </div>
          {/* Wrapping rather than shrinking: three buttons do not fit a 360px dialog in one row. */}
          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setConfirmConvert("")}>Cancel</Button>
            <Button type="button" variant="secondary" onClick={() => void convert({ openProject: false })}>Update and Close</Button>
            <Button type="button" variant="primary" onClick={() => void convert({ openProject: true })}>Convert</Button>
          </footer>
        </section>
      </div>
    )}
  </>;
}
/*
 * The **Quotation Calculator** was here - `QuotationCalculatorModal`, a portal over the lead popup,
 * with the money formatter and the discount list it used. It is a page of its own since
 * 2026-10-08: `components/sales/QuotationCalculatorPage.js`, at `/sales/quotation-calculator`,
 * reached from this popup's own button, which opens it in a tab of its own carrying the lead and
 * leaves the popup where it was. Pricing a quotation is a screen somebody sits on, not a question
 * they dismiss - and it is read against the lead, which stays open beside it.
 */

// How the leads are shown: the table, or the status board.
const VIEW_OPTIONS = [{ value: "table", label: "Table" }, { value: "board", label: "Board" }];

/**
 * The header's date range narrowed by a board column's own period: the later start and the earlier
 * end, so a column asked for its last 7 days inside "This month" reads only what is in both.
 */
function narrowedRange(dateFrom, dateTo, range) {
  const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const earlier = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  return { from: later(dateFrom, range?.dateFrom), to: earlier(dateTo, range?.dateTo) };
}

export default function CRMPage() {
  // SALES / CRM Leads. Reading the pipeline is one thing; adding leads, importing a file, editing
  // the module's settings and the bulk update on a selection all change it.
  const { canWrite } = useRouteAccess();
  /*
   * SALES / CRM Lead Deletion, which is a second permission on top of the board's own and is not
   * handed out with it - see the catalogue entry and `crm-leads/routes.js`.
   *
   * `useModuleAccess` rather than `useRouteAccess`, because this is not the permission the route
   * answers for: somebody can run the whole CRM without it, and then every Delete on this screen -
   * the row menu, the right-click menu, the button over a selection - is simply absent rather than
   * offered and refused. The guard on the two DELETE routes is what actually decides it.
   */
  const { canWrite: canDeleteLeads } = useModuleAccess("SALES", "CRM Lead Deletion");
  /*
   * Two more permissions read the same way and for the same reason - see `crm-leads/routes.js`.
   *
   * `canSelectLeads` is the whole column of tick boxes, header and rows alike. A role without it
   * works the board a lead at a time: the boxes are absent rather than present and refused, so
   * there is no selection to offer Update Details or a bulk delete over, and the three routes those
   * buttons post to are guarded by the same permission.
   *
   * `canImportLeads` is the CSV in the ⋮ menu and nothing else. Bulk Entry sits beside it on the
   * board's own Read / Write, so the menu is never empty for somebody who may add a lead at all.
   */
  const { canWrite: canSelectLeads } = useModuleAccess("SALES", "CRM Lead Select All");
  const { canWrite: canImportLeads } = useModuleAccess("SALES", "CRM Lead Import");
  const [leads, setLeads] = useState([]);
  /*
   * Who can be assigned a lead: the Sales department's active employees.
   *
   * Fetched rather than written down. A roster in the code is wrong the day somebody joins or
   * leaves, and wrong silently - the leads assigned to a name that is no longer listed stay
   * assigned to it while their replacement cannot be picked at all.
   */
  const [crmEmployees, setCrmEmployees] = useState([]);
  /*
   * ── A CRM is an active Sales employee, and nothing else ──────────────────────────────────────
   *
   * One list, used by every control that names a CRM: the column filter, Update Details, Add Lead's
   * Assign To and Import Leads' Assign To.
   *
   * It used to be the roster *plus* every name already sitting on a loaded lead, so that a lead
   * assigned to somebody who had since left stayed findable. That reads well and is wrong in
   * practice, because those names are not people: a CSV or a sheet writes whatever its CRM column
   * says, so the list filled with people who had left, people who were never employees, and
   * misspellings of people who are - and on the assignment side, picking one wrote it straight back
   * onto the leads. On a studio that has not added its Sales employees yet the roster is empty and
   * every name offered came from the leads, which is exactly what it looked like.
   *
   * The consequence is deliberate and worth knowing: **a lead whose CRM is not an active Sales
   * employee cannot be found from this filter.** Adding that person to the Employee repository is
   * what brings both the filter entry and the assignment option back - the roster is the one place
   * the answer is maintained.
   */
  const crmChoices = useMemo(() => crmOptionsFrom(crmEmployees), [crmEmployees]);
  /*
   * The branches the studio maintains, from Settings → Organization → Branches, narrowed by the
   * server to the ones this person reaches. Fetched for the same reason the roster is: a list
   * written into the application is wrong the day a branch is added, renamed or closed - and
   * the one that used to be written here named six branches the studio does not have.
   */
  const { branches: branchOptions } = useBranchOptions();
  /*
   * The filter also offers whatever is already on the rows, so a lead filed against a branch
   * that has since been renamed or closed can still be found - the same rule `crmChoices`
   * follows for a CRM who has left.
   */
  /*
   * What each filter dropdown offers, once its column has been asked about.
   *
   * Held as the answer *and the question it answers*: `key` is the board, the tab, the date range
   * and the other columns' filters rolled together, because "what this column holds" means nothing
   * without them. A held answer whose key is not the current one is simply not read - which is how
   * the list is forgotten when the board moves, with no effect watching for it and no cascade of
   * renders from clearing state that nothing has asked for yet.
   *
   * Lazy either way: the next menu somebody opens asks for itself, and the columns nobody opens cost
   * nothing.
   */
  const [columnValues, setColumnValues] = useState({ key: "", byColumn: {} });
  const [loadingColumnValues, setLoadingColumnValues] = useState("");
  const [detailsByLead, setDetailsByLead] = useState({});
  const [customFieldsByVertical, setCustomFieldsByBranch] = useState({});
  const [loading, setLoading] = useState(true);
  // The app's snackbar, and its tones: a failure leads with the red mark, a finished action
  // with the green tick, and anything else is said plainly.
  const { notice, showNotice, showSuccess, showError, clearNotice } = useNotice();
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  /*
   * The board this login was last reading, remembered across a reload.
   *
   * It was plain state opening on Dum Dum, so somebody who works Qua Qua was put back on the wedding
   * board every time they refreshed - and refreshing is exactly what you do on a board you are
   * working through. The same `useStickyTab` the tab strip below already uses, so the board is
   * remembered the same way, in the same place, and follows the person to another machine.
   *
   * `boardIds` is the guard that hook takes: a stored board the application no longer offers falls
   * back to Dum Dum rather than filtering the table by a vertical nothing matches, which would read
   * as an empty board with no explanation.
   */
  const [board, setBoard] = useStickyTab("crm-board", "Dum Dum", boardIds);
  /*
   * ── Whose leads the board is showing ────────────────────────────────────────────────────────
   *
   * On, which is how it opens, the board shows everything this reader may see - their own leads and
   * their team's, which is what the data scope has always answered. Off, it shows only theirs: a
   * lead assigned to them, or one they created.
   *
   * It narrows and can never widen. The server ANDs it with the same data scope it always applied,
   * so turning it off can only take rows away from what was already allowed - which is why it is
   * offered to everybody rather than only to managers. A Super Admin is narrowed by nothing and has
   * no other way to ask this at all.
   *
   * Remembered per person like the board and the tab beside it: somebody who works their own queue
   * should not have to turn it off every morning.
   */
  /*
   * The switch is **My Leads**: on, the board is the reader's own queue; off, it is everything they
   * may see. It reads the way the studio asks the question - "show me mine" is the thing somebody
   * reaches for, and a control is easier to aim at when its name is what turning it on does.
   *
   * ── Why a new preference key, and not the old one inverted ──
   *
   * `crm:all-leads` stored `true` for "showing everything", which is what almost every reader has
   * sitting in their browser. Keeping that key and flipping what it means would have read every one
   * of those as "My Leads on" - so the first person to open the board after this shipped would find
   * their team's leads gone and nothing to say why. A new key starts everybody at the default again,
   * which is the same board they were looking at yesterday.
   *
   * Default `false`, which is that same board: everything the reader may see, exactly as before.
   */
  const [mineOnly, setMineOnly] = usePreference("crm:my-leads", false);
  /*
   * Table or board, remembered per person like the board, the tab and My Leads beside it: somebody who
   * works in columns should not have to choose them every morning.
   *
   * Default "table", which is the screen everybody has now - a view switch is not a reason to move
   * anybody off the one they know.
   */
  const [view, setView] = usePreference("tab:crm-view", "table");
  /*
   * Bumped whenever the leads have changed under the board.
   *
   * The table re-reads itself after a write and on its own poller, and both now stand down while the
   * board is shown - so without this a lead whose status was just changed in the popup would sit in
   * its old column while the screen claimed to be current. The counter is part of `fetchLeadColumn`'s
   * identity, which is what every column's read already depends on, so bumping it re-reads all of them.
   */
  const [leadsChangedAt, setLeadsChangedAt] = useState(0);
  /*
   * Whether anybody reports to this reader, which is the only case the "My Leads" switch means
   * anything in - see `readerManagesAnyone` on the server.
   *
   * For everybody else the two states are the same board: they are named on their own leads and on
   * nobody else's, so both answers return the same rows. A switch that changes nothing invites
   * somebody to flip it, see no difference, and conclude the board is broken.
   *
   * Three states, not two: `null` until the first page has answered. Started at `false`, the board
   * read `showingAllLeads` as true on that first load, so a manager whose stored answer was "only
   * mine" got the whole team's leads fetched and drawn, then the answer arrived and it all refetched
   * narrowed - a flash of other people's leads and a doubled page-and-counts query on every load.
   * Unknown means "use what they chose", which is right either way: for somebody who turns out to
   * manage nobody, "only mine" returns exactly the leads their scope already limits them to.
   */
  const [managesAnyone, setManagesAnyone] = useState(null);
  /*
   * The statuses this tab's leads actually read as, on the board - the Status column's own
   * `column-values`, so it is narrowed by exactly the scope, tab, range, filters and My Leads the
   * columns are read with. `null` until it answers; `pipelineColumns` stands up a column for each.
   */
  const [boardStatuses, setBoardStatuses] = useState(null);
  /*
   * ── The board's columns ───────────────────────────────────────────────────────────────────────
   *
   * The vertical's statuses, led by **Yet to connect**.
   *
   * That one is not a status anybody chooses - `LEAD_STATUS_OPTIONS` is what the pills offer, and a
   * lead is at Yet to connect precisely by not having been chosen for anything. It is what the Status
   * cell *displays* for a lead with none (`unsetStatusSql` on the server, `resolveLeadStatus` here),
   * which is also why it filters like every other column without anything new on the server: the
   * filter matches the displayed status.
   *
   * Without it the board described almost nothing. Leads with no status match no status column, and on
   * this studio's register that is the overwhelming majority of them - so the board showed a handful of
   * Converted cards beside five empty lanes. It leads the board because that is what it is: the work
   * nobody has picked up yet, which is where a pipeline starts.
   */
  const pipelineColumns = useMemo(() => {
    const tones = new Map([
      /*
       * **Unassigned** leads them, and it is the one that decides whether this board is any use at all.
       *
       * The Status column checks `crm = ''` before it looks at the status, so a lead nobody has been
       * given reads "Unassigned" whatever its status - 543 of this studio's 556. Without a column they
       * matched nothing and the board was empty, worst of all for an administrator, who sees the whole
       * register including every unowned lead.
       *
       * Ahead of Yet to connect because it is further from being worked: that one is owned and not yet
       * rung, this one is not even somebody's.
       */
      /*
       * Shown **only to somebody who hands work out**.
       *
       * An individual gets the leads that are theirs; a lane of leads belonging to nobody is one they can
       * neither work nor clear, and on this register it would be the largest column on their board. The
       * CRM already draws this line - the server surfaces an unowned lead to a reader who sees everything,
       * because "they are the ones who hand leads out" - and `managesAnyone` is the page's own form of
       * that question, already answered for the My Leads switch.
       *
       * Or to anybody whose tab holds such a lead after all: the scope still shows a reader the unowned
       * leads they typed in themselves, and a branch admin their branch's, and a lead the table lists
       * on this tab has to stand in some column of it.
       */
      [UNASSIGNED_STATUS, "bg-[#7c3aed] text-white border-[#7c3aed]"],
      [YET_TO_CONNECT_STATUS, "bg-[#c3c7ce] text-slate-900 border-[#c3c7ce]"],
      /*
       * In the **pipeline's** order - see `BOARD_STATUS_ORDER` - and the board draws them as given.
       *
       * It used to draw them by how many each held, largest first, re-sorting as the counts arrived.
       * A pipeline read out of sequence says nothing about the pipeline, and the board would not keep
       * still: seven columns answer at seven moments, so it re-sorted itself as they landed and a
       * column could move out from under somebody reading it.
       */
      ...LEAD_STATUS_OPTIONS.map((option) => [option.value, option.className]),
      // Last, and nothing may be dropped into it: it is read from the project, not chosen.
      [PROJECT_DELETED_STATUS, "bg-[#92400e] text-white border-[#92400e]"],
    ]);
    /*
     * Plus a column for **any status this tab's leads actually hold** - see `crmBoardColumnStatuses`
     * and `boardStatuses` below. Every column is its own paged read of one status, so a lead whose
     * status had no column was in the table and on no lane: an imported "Inactive", Converted &
     * Followup outside Qua Qua, and an Unassigned lead shown to somebody who manages nobody (one they
     * typed in themselves, or their branch admin's). Nothing is widened by it: the statuses are read
     * from the very rows the columns then page through.
     */
    return crmBoardColumnStatuses({
      offered: boardStatusOptions(board).map((option) => option.value),
      occurring: boardStatuses,
      showUnassigned: Boolean(managesAnyone),
      unassigned: UNASSIGNED_STATUS,
      yetToConnect: YET_TO_CONNECT_STATUS,
      projectDeleted: PROJECT_DELETED_STATUS,
    // A status the module has no colour for is slate, the board's own neutral (`DEFAULT_TONE`), as
    // an exact colour like the rest so the dark tiers cannot repaint it.
    }).map((value) => ({ value, className: tones.get(value) || "bg-[#475569] text-white border-[#475569]" }));
  }, [board, managesAnyone, boardStatuses]);
  const markLeadsChanged = useCallback(() => setLeadsChangedAt((count) => count + 1), []);
  /*
   * Checked against the tabs the board on screen actually has.
   *
   * The default board's tabs were used here, to keep a remembered tab belonging only to Qua Qua
   * from being the tab this page opens on. Both are remembered now, which is what makes that
   * correct rather than lucky: the board is resolved first, from the same cache `PreferencesProvider`
   * has on the first client render, so this list is the *remembered* board's tabs from the outset and
   * a Qua Qua reader lands back on Qua Qua's Newborns rather than on Dum Dum's All.
   *
   * The list also gates every read afterwards, and `useStickyTab` hands back the fallback for a
   * value it does not recognise. So selecting a tab no other board shares stored the choice and
   * then returned "all": Incoming, Outgoing, Connected and Not Connected on Calls, and Newborns
   * and Birthdays on Qua Qua, could not be switched to at all - the strip stayed on All whatever
   * was clicked. A tab that cannot be selected is worse than a tab that is not offered.
   */
  const boardTabIds = useMemo(() => getTabsForBoard(board).map((tab) => tab.id), [board]);
  const [activeTab, setActiveTab] = useStickyTab("crm", "all", boardTabIds);

  /*
   * ── The date range the board is being read over ───────────────────────────────────────────────
   *
   * One question asked in the header rather than typed into the Date column's filter, which matches
   * text and so can say "August" but never "the last seven days".
   *
   * Held here and remembered across tabs rather than cleared when the switch is hidden. The three
   * dated tabs and the Call Box's four outcome tabs do not carry a range - see `showsDateRange` -
   * and dropping the reader's choice on the way through one of them would mean coming back to All
   * on a board silently widened to everything again.
   *
   * `appliedRange` is that choice crossed with where it is allowed to apply, which is what the
   * server is actually sent. Null on a tab that does not carry the switch, so a range chosen
   * elsewhere can never narrow a tab whose control is not on screen to say so.
   */
  /*
   * What the board on screen is *called*, for the handful of places its name is written into a
   * sentence rather than sent to a server.
   *
   * `board` is the value - it keys `CRM_TABLES` and `BOARD_TABS` and is the `board` parameter the
   * endpoint takes - and on the fourth board it reads `Calls`, which is not what the switch above it
   * says any more. Only the three sentences below use this; everything else must go on using the
   * value, and does.
   */
  const boardLabel = board === CALLS_BOARD ? CALLS_BOARD_LABEL : board;

  const [dateRange, setDateRange] = useState(ALL_TIME);
  const [customRange, setCustomRange] = useState({ from: "", to: "" });
  const rangeApplies = showsDateRange(board, activeTab);
  const appliedRange = useMemo(
    () => (rangeApplies ? resolveDateRange(dateRange, { custom: customRange }) : null),
    [rangeApplies, dateRange, customRange],
  );
  // The two ends as plain strings, so the fetch effect below can depend on the range without
  // depending on the identity of the object `resolveDateRange` builds fresh on every render.
  const dateFrom = appliedRange?.from || "";
  const dateTo = appliedRange?.to || "";

  /*
   * Told to the floating assistant, which lives outside this tree and cannot see the switch.
   *
   * Without it the assistant answers about all three verticals at once - on a Qua Qua board that
   * means reporting thirty-one thousand leads that are mostly somebody else's work.
   */
  useEffect(() => {
    setActiveVertical(board);
    // Cleared on the way out, so the assistant is not still scoped to a CRM board on the HRM page.
    return () => setActiveVertical("");
  }, [board]);
  const [filters, setFilters] = useState(NO_FILTERS);
  // Server-driven paging state. The table holds one page plus whatever scrolling has
  // appended, never the whole table.
  const [appliedFilters, setAppliedFilters] = useState(NO_FILTERS);
  const [totalRows, setTotalRows] = useState(0);
  const [serverCounts, setServerCounts] = useState(EMPTY_TAB_COUNTS);
  const [loadingMore, setLoadingMore] = useState(false);
  const leadsRef = useRef([]);
  const loadingRef = useRef(false);
  const [lastSync, setLastSync] = useState(null);
  const [showAddLead, setShowAddLead] = useState(false);
  /*
   * Add Lead's own "one press, one lead" guard. Adding is the act on this screen that cannot be
   * taken back cheaply - the server mints the enquiry id, so a second post is a second real lead -
   * which is why it is guarded here and an *update* elsewhere on the board is not: writing the same
   * values twice leaves the record saying what it already said.
   */
  const { busy: addingLead, run: runAddLead } = useSubmitOnce();
  /*
   * The call the Add Lead form is currently placing, by enquiry id, or "" when the form is being
   * used to add a lead from nothing.
   *
   * One dialog, two jobs, and the id is what tells them apart. A call already **is** a lead - the
   * webhook made one the moment Callyzer delivered it - so Confirm writes the vertical onto that
   * record rather than creating a second lead for a client the CRM already holds.
   */
  const [assigningCallId, setAssigningCallId] = useState("");
  /*
   * The **existing** lead this form is assigning, when that is what it is doing.
   *
   * The form has three jobs now: a new lead, placing a call, and giving an unassigned lead an owner.
   * The third is reached by dragging a card out of the board's Unassigned column, and it is the only
   * one that **updates** rather than writes - which is why it is held here rather than inferred, the
   * same reasoning as `assigningCallId` above it: everything that follows has to agree about which
   * job it is doing, and an id is the one thing that cannot be mistaken for another.
   */
  const [assigningLeadId, setAssigningLeadId] = useState("");
  // Import Leads: several clients typed at once, each with its own vertical. See
  // `BulkImportLeadsDialog`, and `@/lib/crmBulkImport.mjs` for what each vertical asks.
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showBulkUpdateDialog, setShowBulkUpdateDialog] = useState(false);
  const [bulkUpdateLeadStatus, setBulkUpdateLeadStatus] = useState("");
  // Another vertical to move the selection to; blank leaves it where it is. A move asks once more.
  const [bulkUpdateVertical, setBulkUpdateVertical] = useState("");
  const [confirmVerticalMove, setConfirmVerticalMove] = useState(false);
  // The lead popup's Change Vertical: `{ id, from }` while its dialog is open.
  const [bulkUpdateLastUpdatedDate, setBulkUpdateLastUpdatedDate] = useState("");
  // When the selection is to be called back, as opposed to when it was last worked. Its own
  // field because the two answer different questions and a bulk edit may set either or both.
  const [bulkUpdateNextFollowUpDate, setBulkUpdateNextFollowUpDate] = useState("");
  // A list, not a single name: ticking several CRMs shares the selected leads out between
  // them, which is what the removed Assign Leads dialog did.
  const [bulkUpdateCrms, setBulkUpdateCrms] = useState([]);
  const [successDialog, setSuccessDialog] = useState(null);
  // The lead whose meetings are open. Held by id so the panel keeps following the lead as
  // its record is refreshed underneath it.
  const [meetingsLeadId, setMeetingsLeadId] = useState("");
  // null means the server's own default order. Cycles asc -> desc -> unsorted, matching the
  // other modules' tables.
  const [sort, setSort] = useState(null);
  // The lead awaiting conversion confirmation. Confirming only opens Create Project, so there
  // is no in-flight state to hold alongside it.
  // Convert navigates in this tab now rather than opening a second one.
  const router = useRouter();
  const [convertLead, setConvertLead] = useState(null);
  /*
   * ── Converted, and whether to book it now ─────────────────────────────────────────────────────
   *
   * A lead saved as Converted or Converted & Followup is marked but not **booked**: those two statuses
   * stand for a project, and the project is a form of its own. The register has always allowed that
   * gap - the conversion dialog's "Update and Close" is exactly it, "converted but not being booked
   * yet" - so what was missing is only the offer to go on.
   *
   * Asked **after** the save, which is the point of asking here rather than when the status is chosen:
   * the reader fills the lead in, presses Update, and the write happens with the required fields, the
   * mandatory remark and the status's own rules all enforced. Only then is Create Project offered, and
   * declining costs nothing because the lead is already saved as converted. Offered first - as the
   * status pills do it - the dialog has to do the writing, and it writes what it can see rather than
   * what is held in the popup's draft.
   *
   * Reached by a status **drafted** into the popup, which today means a card dropped on one of those
   * two columns on the board. The pills still raise `convertLead` exactly as they always have.
   */
  const [convertedAsk, setConvertedAsk] = useState(null);
  const [duplicateEnquiries, setDuplicateEnquiries] = useState(null);
  // Deleting a lead cannot be undone, so it is confirmed first - the same guard the Employees
  // table puts in front of its own red Delete.
  const [pendingDeleteLead, setPendingDeleteLead] = useState(null);
  // The same confirmation for a selection. Kept apart from `pendingDeleteLead` rather than
  // overloading it: one names a lead, the other names however many the board, tab, filters and date
  // range currently match, and the two dialogs have to say different things.
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  /*
   * The right-click menu, and the lead it was opened on.
   *
   * One menu for the whole table rather than one per row: a table of five thousand rows would
   * otherwise mount five thousand menus to show at most one.
   */
  const [rowMenu, setRowMenu] = useState(null);
  // The page's own right-click menu, which offers Nebula for the module rather than for a row.
  const [pageMenu, setPageMenu] = useState(null);
  /*
   * Nebula, asked about one lead without opening it.
   *
   * The row menu's own answer to "what is going on with this one" - the same panel the button
   * inside the popup opens, so the two cannot drift.
   */
  const [askingAboutLead, setAskingAboutLead] = useState(null);
  const [deletingLead, setDeletingLead] = useState(false);
  // How many columns are pinned to the left edge, chosen from the header menu's Freeze
  /*
   * The info panel updates a lead on the same terms as the popup: not without a remark.
   *
   * The lead id is stored beside the flags rather than cleared by an effect, so moving to
   * another row simply stops matching and the button is locked again for that lead.
   */
  const [infoRemark, setInfoRemark] = useState({ leadId: "", added: false, pending: false });
  const infoRemarkCommitRef = useRef(null);
  // Add Lead's own handle on its notes box, so Confirm can post a typed-but-unsent remark
  // the way the popup's Update does.
  const addLeadRemarkCommitRef = useRef(null);
  const [infoUpdating, setInfoUpdating] = useState(false);
  /*
   * The lead whose Update and Next was turned away for want of a remark, or "".
   *
   * A lead id rather than a flag. The panel is one component that every row is shown through,
   * so a plain boolean would still be set when the next lead was clicked and that lead would
   * open already complaining - which is the thing this is meant to stop.
   */
  const [infoRemarkErrorLeadId, setInfoRemarkErrorLeadId] = useState("");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const searchParams = useSearchParams();
  const [showLeadPopupId, setShowLeadPopupId] = useState(null);
  /*
   * A lead opened from somewhere else in the application - the Contacts directory sends one here,
   * naming it in the query string.
   *
   * Fetched on its own rather than looked for in the table. The board is paged, filtered and scoped
   * to one vertical, so a linked lead is frequently not among the rows on screen - and a link that
   * works only when the lead happened to be loaded is not a link. It is kept beside the table
   * rather than pushed into it: injecting a Corp lead into the Dum Dum board would put a row there
   * that does not belong to it.
   */
  const [linkedLead, setLinkedLead] = useState(null);
  const [leadPopupTab, setLeadPopupTab] = useState("remarks");

  /*
   * Opening a lead always opens it on Remarks.
   *
   * The tab was state on the page rather than on the lead, so it stayed where it was left: reading
   * one lead's Transcripts and stepping to the next landed on that lead's Transcripts, and Update
   * and Proceed Next walked a whole queue of leads through whichever tab happened to be open.
   * Remarks is where the work starts, so that is where every lead starts.
   *
   * Reset here rather than in an effect on the id: an effect would set state during render and
   * the compiler rightly objects. The lead and the tab change together, in one place.
   *
   * A plain function, not a `useCallback`: the React Compiler memoises it, and a hand-written one
   * here is memoisation it cannot preserve - which it reports as an error rather than quietly
   * skipping the whole component.
   */
  function openLeadPopup(id) {
    setShowLeadPopupId(id || null);
    setLeadPopupTab("remarks");
  }

  /**
   * Opens a lead that is not among the rows on screen, wherever it actually lives.
   *
   * Two callers, and they need the same three things done: the Contacts directory, which names a
   * lead in the query string, and a double click on a Calls row whose caller has since been added -
   * that row is a call, drawn under a Call ID, and the lead it became is on one of the verticals.
   *
   * The lead is fetched on its own rather than looked for in the table, because the board is paged,
   * filtered and scoped to one vertical and the lead is usually in none of what is loaded. It is
   * held beside the table rather than pushed into it - injecting a Corp lead into the Dum Dum board
   * would put a row there that does not belong - and the board is moved to the lead's own vertical,
   * so closing the popup leaves the reader somewhere that makes sense.
   */
  /**
   * `onMissing` is what to do when the lead is not there.
   *
   * A call row names the lead it became, and the server only claims that when the lead really
   * exists - but the board is a live table and a lead can be deleted between the page arriving and
   * somebody double-clicking a row on it. Without this, that gap is a red "Lead not found." and no
   * way forward; with it, the row falls back to the Add Lead form, which is what a call whose lead
   * is gone actually is again.
   */
  function openLinkedLead(id, onMissing) {
    const leadId = String(id || "").trim();
    if (!leadId) {
      onMissing?.();
      return;
    }
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}`)
      .then((response) => {
        const record = response?.data;
        if (!record?.lead) {
          onMissing?.();
          return;
        }
        const details = record.details || {};
        /*
         * Held here rather than written into the board's own `detailsByLeadRef`.
         *
         * That ref is the table's, mutated by every edit the board makes; reaching into it from here
         * is both a side effect on somebody else's state and the thing the compiler's immutability
         * rule refuses. The popup reads this as its fallback instead, so a linked lead carries its
         * own details and the board's are left exactly as they were.
         */
        setLinkedLead({ id: leadId, lead: leadFromRecord(record), details });
        // The board the lead is actually on. `resolveLeadVertical` folds a blank vertical onto Dum
        // Dum, so a linked call still waiting to be placed would move the board to Dum Dum - where
        // it is not listed - and leave its popup open over a table it is not in.
        setBoard(isUnassignedCall(record.lead, details) ? CALLS_BOARD : resolveLeadVertical(record.lead, details));
        openLeadPopup(leadId);
      })
      .catch((error) => {
        // A caller that has somewhere else to go takes it rather than being shown a dead end.
        if (onMissing) {
          onMissing();
          return;
        }
        showError(error.message || "That lead could not be opened.");
      });
  }

  /*
   * Three refs that exist only so `openLead` below can keep one identity.
   *
   * It is `onOpen` on every memoised row, so it must not be rebuilt per render - but it needs the
   * current `openLeadPopup`, the current `openLinkedLead` and the current Table Settings fields.
   * Reading them through refs that are kept in step gives it all three without making it a
   * dependency of any of them.
   *
   * Assigned from an effect rather than during render, which the compiler refuses - a ref is not
   * something a render writes. The values are only ever read from an event handler, which runs long
   * after the effects of the render that produced them, so "one render behind" is a state this can
   * never actually be observed in.
   */
  const openLeadPopupRef = useRef(openLeadPopup);
  const openLinkedLeadRef = useRef(openLinkedLead);
  const openAssignLeadRef = useRef(openAssignLead);
  const customFieldsByVerticalRef = useRef(customFieldsByVertical);
  useEffect(() => { openLeadPopupRef.current = openLeadPopup; });
  useEffect(() => { openLinkedLeadRef.current = openLinkedLead; });
  useEffect(() => { openAssignLeadRef.current = openAssignLead; });
  useEffect(() => { customFieldsByVerticalRef.current = customFieldsByVertical; });

  /**
   * Opens Add Lead on a lead that has no owner, to give it one - what a card dragged out of the
   * board's Unassigned column does.
   *
   * The lead is **fetched** rather than looked for among the rows: the board pages a column at a
   * time and the table stands down behind it, so the row is usually in neither. Its details come
   * with it, which is what fills the form - the popup's own fields live in that row.
   *
   * `status` is the column it was dropped on. The form opens with it chosen, so Confirm both assigns
   * the lead and moves it; left unassigned, the board goes on reading it as unassigned whatever the
   * status says, which is the behaviour this relies on rather than works around.
   */
  function openAssignLead(id, status = "") {
    const leadId = String(id || "").trim();
    if (!leadId) return;
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadId)}`)
      .then((response) => {
        const record = response?.data;
        if (!record?.lead) {
          showError("That lead could not be opened.");
          return;
        }
        setAssigningCallId("");
        setAssigningLeadId(leadId);
        setAddLeadForm(leadFormFromLead(leadFromRecord(record), record.details || {}, status));
        addLeadMarks.clearAll();
        setShowAddLead(true);
      })
      .catch((error) => showError(error.message || "That lead could not be opened."));
  }

  /*
   * A lead named in the URL, opened however the board happens to be filtered.
   *
   * The board is paged and scoped to one vertical, so the linked lead is usually not among the rows
   * on screen - it is fetched on its own instead, with its details, and the board is moved to that
   * lead's vertical so closing the popup leaves the reader somewhere that makes sense rather than
   * on a board the lead is not on.
   *
   * Runs once per id. Re-running it would reopen a popup somebody has just closed, which is a popup
   * that cannot be dismissed.
   */
  const linkedLeadId = searchParams.get("lead") || "";
  const openedLinkRef = useRef("");
  useEffect(() => {
    if (!linkedLeadId || openedLinkRef.current === linkedLeadId) return;
    openedLinkRef.current = linkedLeadId;
    openLinkedLeadRef.current(linkedLeadId);
  }, [linkedLeadId]);
  /*
   * Whether the studio's WhatsApp switch is on, which decides whether the lead popup offers a
   * WhatsApp Chat tab at all.
   *
   * Held here rather than inside the popup so the answer outlives one popup being closed and
   * another opened. When the popup owned it, every open started from "assume on", showed the tab,
   * and took it away again a moment later once the first poll answered - which is the flicker.
   *
   * Starts on because that is the normal state, and a tab appearing late reads worse than one
   * that was simply always there.
   */
  const [whatsappChatEnabled, setWhatsappChatEnabled] = useState(true);

  // Asked once as the page loads, so the first popup opened already knows and nothing has to
  // change on screen after it is open.
  useEffect(() => {
    let cancelled = false;
    void getWhatsappSession()
      .then((response) => {
        if (!cancelled && response?.data) setWhatsappChatEnabled(response.data.chatEnabled !== false);
      })
      // A failed read is not an answer. The switch keeps whatever it last said rather than
      // flipping on a hiccup, which is the other half of the flicker.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  // Edits made in the lead popup, held until one of its Update buttons is pressed. Tagged with the
  // lead they belong to so moving to the next lead cannot carry the previous one's typing with it.
  const [popupDraft, setPopupDraft] = useState({ leadId: "", lead: {}, details: {} });
  const importInputRef = useRef(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFile, setImportFile] = useState(null);
  // Which CRM table the import targets. Seeded from the board on screen, but the
  // dialog can point the import at a different table.
  const [importTable, setImportTable] = useState("Dum Dum");
  // Result of matching the attached file's headings against the selected table. null while
  // no file is attached or the check has not finished, which keeps Import disabled.
  const [importValidation, setImportValidation] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
  // What the finished import did. Held rather than flashed as a notice, so the numbers stay
  // on screen until the user acknowledges them.
  const [importSummary, setImportSummary] = useState(null);
  const [importCancelled, setImportCancelled] = useState(false);
  const importAbortRef = useRef(null);
  const importBatchRef = useRef(null);
  // The scrolling table body, so a refresh can put the view back where it was.
  // Selection covers the whole board, not the pages that happen to be loaded; see
  // lib/leadSelection for how the two modes work.
  const [selection, setSelection] = useState(emptySelection);
  const clearSelection = useCallback(() => setSelection(emptySelection()), []);
  const [addLeadForm, setAddLeadForm] = useState(emptyLeadForm());
  // The suggestions behind the Relationship and Referred From combos and the Shoot Type rows - the
  // studio's lists, the shoots being those of the vertical the form is on. Declared here rather
  // than with the other hooks above because it reads the form, and refetched when its Vertical
  // radio moves: a Qua Qua lead is offered Qua Qua's shoots and none of Dum Dum's.
  const suggestions = useLeadSuggestionLists({ vertical: addLeadForm.vertical });
  // Nothing is marked until Confirm has been pressed, so a form being filled in is not red
  // from the moment it opens; a marked box clears as it is answered.
  const addLeadMarks = useFormErrors();
  const clearAddLeadMarks = addLeadMarks.clearAll;

  /*
   * ── One number, one enquiry ───────────────────────────────────────────────────────────────
   *
   * The enquiries this form's number is already on. `{ phone, leads }`, or null while nothing has
   * been asked or nothing was found.
   *
   * Held against the number it was asked about rather than as a bare list, because the number keeps
   * changing while somebody types: an answer that arrives after the field has moved on is an answer
   * about a different number, and comparing the two is what makes it safe to ignore.
   */
  const [addLeadDuplicates, setAddLeadDuplicates] = useState(null);
  // The number somebody has looked at the warning for and chosen to go ahead with anyway. Kept as
  // the number, so changing the field asks the question again rather than carrying a decision made
  // about somebody else's number.
  const [duplicateAckPhone, setDuplicateAckPhone] = useState("");
  // `{ phone, leads, intent }` while the warning is on screen.
  const [duplicateAlert, setDuplicateAlert] = useState(null);

  /**
   * Asks, as the number is typed, whether the CRM already holds it.
   *
   * Only once the number is whole - `isCompletePhoneNumber` is the same test the WhatsApp field
   * uses before it writes itself - so nothing is asked on the way to typing a number, and the
   * warning cannot appear against the first four digits of one.
   *
   * Debounced, and every answer is checked against the field as it stands when it arrives: a reply
   * about a number that has since been edited is thrown away rather than warning about a number
   * nobody is looking at any more.
   */
  useEffect(() => {
    const phone = String(addLeadForm.phone || "").trim();
    /*
     * Nothing is cleared here, deliberately.
     *
     * A half-typed number simply has no answer yet, and clearing state from an effect body is a
     * cascading render for a fact that is already known: `addLeadDuplicateWarning` below compares
     * the answer's number against the field as it stands, so an answer about a number that has been
     * edited since counts for nothing without having to be thrown away first.
     */
    if (!showAddLead || !isCompletePhoneNumber(phone)) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      /*
       * `excludeId` because a lead being **assigned** already holds the number in the box - itself.
       * Without it the form would open warning that this client is already an enquiry, naming the
       * very lead on screen, and the only way past it would be to acknowledge a clash with itself.
       */
      void getDuplicateEnquiries({ phone, excludeId: assigningLeadId || "" })
        .then((response) => {
          if (cancelled) return;
          const leads = response?.data?.leads || [];
          setAddLeadDuplicates(leads.length ? { phone, leads } : null);
        })
        // A check that cannot be made is not a duplicate. The form stays usable and Confirm is not
        // held up by a network that is having a moment.
        .catch(() => { if (!cancelled) setAddLeadDuplicates(null); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [showAddLead, addLeadForm.phone, assigningLeadId]);

  // The warning that is outstanding for the number currently in the form, or null. Null once
  // somebody has read it and chosen to go on with that same number.
  const addLeadDuplicateWarning = addLeadDuplicates
    && addLeadDuplicates.phone === String(addLeadForm.phone || "").trim()
    && addLeadDuplicates.phone !== duplicateAckPhone
    ? addLeadDuplicates
    : null;

  /**
   * Wraps a required Add Lead field so its own message can sit beneath it.
   *
   * The control's own `error`: a red border and the reason directly under the field rather than in
   * a list at the foot of the form.
   */
  function requiredField(key, node) {
    // Not required at all on a lead being turned down - see `requiredLeadFields`. Asked of the same
    // rule that refuses the save, so the red border and the refusal cannot disagree.
    const required = isRequiredLeadField(key, addLeadForm.leadStatus, addLeadForm.name);
    const missing = leadFieldMessage(key, addLeadMarks.errors[key], addLeadForm);
    /*
     * "This number is already an enquiry", under the Contact field it is about.
     *
     * Here rather than at the three call sites - one per vertical - so the notice cannot be on the
     * wedding form and missing from the corporate one. It is the same slot the required message
     * uses, for the same reason: the answer belongs under the field that raised it, not in a
     * summary at the foot of a form somebody has scrolled past.
     *
     * Amber, not red. A number the CRM already holds is worth stopping for and is not an error -
     * the form is perfectly valid, and the person filling it in may well go on to add it anyway.
     */
    const duplicate = key === "phone" ? addLeadDuplicateWarning : null;
    return (
      <div>
        {/* The asterisk comes from the same answer the refusal does, rather than from the call
            site: a field marked required that saves without it, or the reverse, is the form
            disagreeing with itself in front of the person filling it in. */}
        {cloneElement(node, { required, error: missing })}
        {!missing && duplicate && (
          <button
            type="button"
            onClick={() => setDuplicateAlert({ ...duplicate, intent: "add" })}
            className="mt-1 text-left text-xs font-normal text-amber-700 underline decoration-amber-300 underline-offset-2 hover:decoration-amber-600"
          >
            Already an enquiry: {duplicate.leads.map((entry) => entry.enquiryId).join(", ")}
          </button>
        )}
      </div>
    );
  }
  const [isImporting, setIsImporting] = useState(false);

  /*
   * ── Escape, on every overlay this board opens ─────────────────────────────────────────────
   *
   * Six of them, and not one responded to the key. They are hand-rolled rather than built on the
   * shared `Dialog` - each is a `fixed inset-0` of its own - so none of them inherited the
   * behaviour that component has always had.
   *
   * Registered in the order they stack, and the arbiter takes the last one on: Add Lead over the
   * board, the duplicate warning over Add Lead, a dropdown over that. One press closes one thing.
   *
   * Two are deliberately not dismissible while they are working. A delete being carried out and an
   * import halfway through a file are not cancellable by looking away, and a dialog that vanished
   * mid-write would leave somebody unsure whether it happened.
   */
  /*
   * The same save-or-discard question the lead popup asks, on the same hook and in the same words.
   *
   * Asked of the ×, Cancel, Escape and a press on the dim behind the form - every way out somebody
   * chooses. Not of the save path or of the duplicate dialog's "open the existing lead", which both
   * empty the form deliberately and would be asking about a decision already taken.
   *
   * `leadFormHasEntries` rather than a comparison against a blank form, because the form is never
   * blank: it opens carrying today's date, the current time, a vertical, a status and one empty
   * shoot row. Asking about those would put a dialog in front of somebody who opened Add Lead and
   * changed their mind, which is how a studio learns to click through warnings without reading them.
   */
  const { guard: guardAddLeadClose, confirmProps: addLeadCloseConfirmProps } = useUnsavedGuard(
    () => leadFormHasEntries(addLeadForm),
    {
      message: "This lead has not been saved. Go back and press Add Lead to keep it.",
      confirmLabel: "Discard & Close",
    },
  );
  const requestCloseAddLead = () => guardAddLeadClose(() => closeAddLead());
  useEscapeKey(requestCloseAddLead, showAddLead);
  // Not while its vertical move is being confirmed: Escape there answers the confirmation, and only that.
  useEscapeKey(() => setShowBulkUpdateDialog(false), showBulkUpdateDialog && !confirmVerticalMove);
  useEscapeKey(() => setAskingAboutLead(null), Boolean(askingAboutLead));
  useEscapeKey(() => setPendingDeleteLead(null), Boolean(pendingDeleteLead) && !deletingLead);
  useEscapeKey(() => setPendingBulkDelete(false), pendingBulkDelete && !bulkDeleting);
  useEscapeKey(() => setConvertLead(null), Boolean(convertLead));
  useEscapeKey(() => setShowImportDialog(false), showImportDialog && !isImporting);

  const [infoState, setInfoState] = useState("collapsed");
  const [infoPanelTab, setInfoPanelTab] = useState("info");
  /*
   * Nebula on the whole module, rather than on the lead under the cursor.
   *
   * The panel in the lead popup can only ever answer for that one lead - asked how the pipeline is
   * doing it has nothing to look at. This opens the same panel against the CRM's own totals.
   */
  /*
   * A status chosen in the info panel, held until Update and Next.
   *
   * The panel's pill used to write the moment it was pressed, so a status picked by mistake -
   * or picked on the way to the one actually meant - was in the CRM and in the lead's history
   * before the user had said they were finished. The popup has always held its edits back for
   * its own Update; this is the same rule, so the two agree on what pressing a pill means.
   *
   * Keyed by lead, like the popup's draft: a draft belonging to another row simply does not
   * match, so moving to the next lead drops it without an effect to clear it.
   */
  const [infoStatusDraft, setInfoStatusDraft] = useState({ leadId: "", leadStatus: "" });
  // Keyed by the lead it belongs to, so the previous lead's history is never shown against
  // the one just opened - and "still loading" is simply "the key does not match yet",
  // which needs no second state field.
  const [leadActivity, setLeadActivity] = useState({ leadId: "", rows: [] });
  const [leadCallLogs, setLeadCallLogs] = useState({ leadId: "", rows: [] });
  const [leadTranscripts, setLeadTranscripts] = useState({ leadId: "", rows: [] });
  // The Sales Manager projects this lead became, keyed by lead the same way the activity log
  // is, so one lead's projects are never shown against another.
  const [leadProjects, setLeadProjects] = useState({ leadId: "", rows: [] });
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const detailsByLeadRef = useRef({});
  const leadVersionRef = useRef(null);
  // Mirrors whether an editing surface is open, so the background refresh can hold off.
  const editingRef = useRef(false);

  // Every vertical's custom fields in one call. The table, the Info panel and Add Lead all
  // read from this, and switching vertical must not have to wait on a fetch.
  useEffect(() => {
    let active = true;
    void apiRequest("/api/sales/crm-leads/table-settings")
      .then((response) => {
        if (!active) return;
        setCustomFieldsByBranch(groupCustomFieldsByBranch(response?.data));
      })
      .catch(() => {
        if (!active) return;
        setCustomFieldsByBranch({});
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const applySavedTableSettings = (event) => {
      const { vertical: savedVertical, fields: savedFields } = event.detail || {};
      if (!savedVertical || !Array.isArray(savedFields)) return;
      setCustomFieldsByBranch((current) => ({ ...current, [savedVertical]: savedFields }));
    };
    window.addEventListener(TABLE_SETTINGS_SAVED_EVENT, applySavedTableSettings);
    return () => window.removeEventListener(TABLE_SETTINGS_SAVED_EVENT, applySavedTableSettings);
  }, []);

  /*
   * The Sales roster, once - and once means once. Two identical copies of this effect had
   * accumulated, so every mount of the board fetched the roster twice.
   *
   * A failure leaves the list empty rather than stopping the page, and an empty list is the honest
   * answer: without the roster there is nobody this page can say is an employee. Offering the names
   * written on the leads instead is what filled these controls with people who were never employees.
   * The board itself has nothing to do with this fetch.
   */
  useEffect(() => {
    let active = true;
    void getCrmEmployees()
      .then((response) => { if (active) setCrmEmployees(response?.data || []); })
      .catch(() => { if (active) setCrmEmployees([]); });
    return () => { active = false; };
  }, []);

  /*
   * `appending` tells the server this is a scroll append, so it returns the rows and skips the
   * total and the twelve tab counts. Neither can have changed - the reader is walking down a set
   * they already asked for - and both are a second pass over the whole board. Measured at 500,000
   * leads the counts alone were 6.3 seconds, paid again on every page appended.
   */
  /*
   * Whether the board is showing everything this reader may see, which is the switch **crossed with
   * whether the switch is theirs to make**.
   *
   * The preference outlives the person's place in the org chart. Somebody who turned it off while
   * they had a team, and no longer has one, would otherwise keep a board narrowed by a control that
   * is no longer on screen to turn back - a board quietly showing less than it should, with nothing
   * saying why. Read through this, a reader with nobody under them is always shown everything, and
   * the stored answer simply waits in case they manage somebody again.
   */
  /*
   * What the reads ask for, which is the switch turned back the other way round.
   *
   * Kept as "showing all" rather than renamed to match the control, because that is the question the
   * server is actually asked (`mine=false`) and the four reads below, the effect dependencies and
   * the select-all resolver all speak it. The control's sense is a fact about the header; this is a
   * fact about the query, and inverting once here is what keeps the two from being confused at
   * every call site.
   *
   * Somebody who manages nobody is always shown everything, because for them the two answers are
   * the same rows - see `managesAnyone`.
   */
  const showingAllLeads = managesAnyone === false ? true : !mineOnly;

  /**
   * The query both views are read with.
   *
   * One builder rather than two: the table's page and a board column ask the same question of the same
   * endpoint and differ only in `view`, the status filter and the paging. Written twice, a parameter
   * added for the table - a new filter, a new date - would quietly stop reaching the board, and the
   * two would describe different sets of leads while claiming to be the same board.
   */
  const leadPageQuery = useCallback(({ view: askedView, offset, limit, appending = false, leadStatus = "", range = null, search = "" } = {}) => { const { from, to } = narrowedRange(dateFrom, dateTo, range); const columnFilters = { ...(leadStatus ? { status: [leadStatus] } : {}), ...(search.trim() ? { _search: search.trim() } : {}) }; return new URLSearchParams({
    board: board || "Dum Dum",
    view: askedView,
    offset: String(offset),
    limit: String(limit),
    today: getLocalDateKey(),
    ...(sort ? { sortColumn: sort.id, sortDirection: sort.direction } : {}),
    /*
     * A column adds its own status to whatever the filter row already holds, so the board honours a
     * filtered board exactly as the table does.
     *
     * The key is **`status`**, the column's own id - not `leadStatus`, which is what the lead object
     * calls the field. The server filters by column id and maps `status` to `statusDisplaySql`, so the
     * filter matches the value the Status cell actually shows. Keyed on anything else it matches
     * nothing and is quietly ignored, which is how every column came back holding the whole page.
     */
    filters: JSON.stringify(Object.keys(columnFilters).length ? { ...(appliedFilters || {}), ...columnFilters } : (appliedFilters || {})),
    // Only when there is one. An empty `dateFrom` on the query string is a parameter the server would
    // have to know to ignore; leaving it off says the same thing and cannot be got wrong.
    ...(from ? { dateFrom: from } : {}),
    ...(to ? { dateTo: to } : {}),
    ...(appending ? { append: "true" } : {}),
    // "only mine" is what the board asks for when My Leads is on, which is what `showingAllLeads` has
    // already turned back the other way round. Sent as the word, because the server reads it as one.
    mine: showingAllLeads ? "false" : "true",
  }); }, [board, sort, appliedFilters, dateFrom, dateTo, showingAllLeads]);

  function fetchLeadPage(offset, limit, { appending = false } = {}) {
    const query = leadPageQuery({ view: activeTab, offset, limit, appending });
    return apiRequest(`/api/sales/crm-leads/page?${query.toString()}`);
  }

  /**
   * One board column's leads: the same query with that column's status added.
   *
   * It honours the **tab** as well, rather than forcing "all". The tab strip stays on screen in this
   * view, and a control that is visible and does nothing is worse than one that is not there: pressing
   * Today would have left the board unchanged. So a column answers "of this tab's leads, how many are
   * at this status" - which is the question the tab and the column each already ask, asked together.
   *
   * **Memoised on exactly the things the query is made of.** As a plain function it was re-created on
   * every render of this page - and this page re-renders constantly: a keystroke in the search box, the
   * sync timer, opening a lead. Each new identity re-ran every column's effect, so all seven refetched
   * from offset zero and every Load more somebody had pressed was thrown away.
   */
  // `range` and `search` are a board column's own period and search box (`CrmKanbanBoard`).
  const fetchLeadColumn = useCallback(async (leadStatus, offset, limit, range = null, search = "") => {
    const query = leadPageQuery({ view: activeTab, offset, limit, leadStatus, range, search });
    // A column's first page also asks what its leads are worth, for the ₹ in its heading; the
    // one-row reads the trend makes do not.
    if (offset === 0 && limit > 1) query.set("values", "true");
    const response = await apiRequest(`/api/sales/crm-leads/page?${query.toString()}`);
    /*
     * Learned here as well as from the table's own page, because on the board the table does not fetch.
     *
     * It decides whether the My Leads switch is offered and, while it is still `null`, what
     * `showingAllLeads` resolves to - so a board that never learned it left a reader whose stored My
     * Leads was on asking `mine=true` in every column, with the switch hidden and no way to undo it.
     * An administrator, rarely the named CRM on any lead, got an empty board and no way out of it.
     */
    if (response?.managesAnyone !== undefined) setManagesAnyone(Boolean(response.managesAnyone));
    /*
     * Flattened here, as the table flattens its own page.
     *
     * The endpoint answers **records** - `{ lead, details }` - not leads. Handed on untouched, every
     * card got a wrapper instead of a lead: `name`, `id` and the number were all undefined, so each
     * one read "Client_Name" with no enquiry id and no number, and they shared a React key of
     * `undefined`. `leadFromRecord` is the same mapping the table's rows go through, which is what
     * makes a card and a row show the same fields with the same values.
     */
    return { ...response, data: (Array.isArray(response?.data) ? response.data : []).map(leadFromRecord) };
  }, [leadPageQuery, activeTab]);



  /**
   * The values one column actually holds, on the tab being read - which is what its filter offers.
   *
   * The dropdowns used to offer the registers: every employee on the Sales roster under CRM, every
   * branch under Assigned Branch, the whole list of shoot types under the three that use it. Most of
   * a menu was therefore values no row in front of the reader held, and picking one emptied the
   * board. A spreadsheet's filter answers a different question - what is *in* this column - and that
   * is the question this asks.
   *
   * It has to be the server's answer, not the rows on screen: the board is paged, so the browser
   * holds the first hundred of a vertical that has thirty thousand, and a menu built from those
   * would be a different menu after every scroll.
   *
   * Asked with exactly what the page is being read with - board, tab, date range, the other columns'
   * filters - so the menu describes the rows underneath it. The server drops this column's own
   * filter, or choosing a value would leave a menu holding only that value.
   */
  function fetchColumnValues(column) {
    const query = new URLSearchParams({
      column,
      board: board || "Dum Dum",
      view: activeTab,
      today: getLocalDateKey(),
      filters: JSON.stringify(appliedFilters || {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      // With the rows, or the menu would offer values from leads the board is not showing.
      mine: showingAllLeads ? "false" : "true",
    });
    return apiRequest(`/api/sales/crm-leads/column-values?${query.toString()}`);
  }

  /*
   * Which statuses the board's leads hold, so `pipelineColumns` can give each one a column.
   *
   * Asked again whenever what the columns are read with changes - and on `leadsChangedAt`, which a
   * write bumps - and only while the board is the view: the table has a Status column and needs no
   * lanes. A failed read keeps the last answer, or the fixed columns when there is none.
   */
  useEffect(() => {
    if (view !== "board" || board === CALLS_BOARD) return undefined;
    let cancelled = false;
    fetchColumnValues("status")
      .then((response) => { if (!cancelled) setBoardStatuses(Array.isArray(response?.data) ? response.data : []); })
      .catch(() => {});
    return () => { cancelled = true; };
    // `fetchColumnValues` is re-created every render; these are what it is made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, board, activeTab, appliedFilters, dateFrom, dateTo, showingAllLeads, leadsChangedAt]);

  /** `append` adds the next page as the table is scrolled; anything else re-reads the first. */
  async function loadLeads({ silent = false, append = false } = {}) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (append) setLoadingMore(true);
    else if (!silent) setLoading(true);

    const container = tableScrollRef.current;
    const restoreTo = append ? null : container?.scrollTop ?? null;

    try {
      let response;
      let records;
      if (append) {
        response = await fetchLeadPage(leadsRef.current.length, LEAD_PAGE_SIZE, { appending: true });
        records = Array.isArray(response?.data) ? response.data : [];
      } else {
        /*
         * A refresh reads the first page, and only the first page.
         *
         * It used to read back every row already on screen, in 500-row chunks, one request after
         * the next - so a reader who had scrolled to 50,000 leads paid 100 sequential round trips
         * for a refresh, re-downloading roughly a hundred megabytes to show the same rows again.
         * The version poll below fires that every four seconds when anything changes, and editing
         * one cell changes something, so the board could spend minutes refreshing itself and never
         * settle. That is the "it loads for minutes" fault, and it was self-inflicted rather than
         * the database's doing.
         *
         * Reading one page instead means a refresh costs what opening the board costs. What it
         * gives up is the scroll position past the first hundred rows: rows below that are dropped
         * and re-appended by scrolling, which is the same thing that happens on any other filter
         * change and is what the sticky scroll restore below already handles.
         */
        response = await fetchLeadPage(0, LEAD_PAGE_SIZE);
        records = Array.isArray(response?.data) ? response.data : [];
      }

      const pageLeads = records.map(leadFromRecord);
      const pageDetails = Object.fromEntries(
        records.filter((record) => record.lead?.id).map((record) => [record.lead.id, record.details || {}]),
      );

      /*
       * An appended page leaves out the leads already on screen. Pages are cut by offset, so a lead
       * edited while somebody is scrolled - its status changed, say - moves between pages and comes
       * back on the next one; added twice, the board drew it twice and React warned of two rows with
       * one key. The server's order is fixed (`leadQueryService` breaks every tie on the enquiry id),
       * so this only catches what changed between the two reads.
       */
      const onScreen = append ? new Set(leadsRef.current.map(leadRowId)) : null;
      const nextLeads = append ? [...leadsRef.current, ...pageLeads.filter((lead) => !onScreen.has(leadRowId(lead)))] : pageLeads;
      leadsRef.current = nextLeads;
      setLeads(nextLeads);
      detailsByLeadRef.current = append ? { ...detailsByLeadRef.current, ...pageDetails } : pageDetails;
      setDetailsByLead(detailsByLeadRef.current);
      // An append is answered without them, so the board keeps the ones it already has rather
      // than blanking the tab labels and the footer count every time a page is scrolled in.
      if (response?.total !== undefined) setTotalRows(Number(response.total || 0));
      if (response?.counts) setServerCounts(response.counts);
      // Absent on a scroll append, which is the same board and cannot have changed it.
      if (response?.managesAnyone !== undefined) setManagesAnyone(Boolean(response.managesAnyone));
      setLastSync(new Date());
      /*
       * And the board with it. On the board this function runs only when something was written - its
       * effect, its poller and its reload listener all stand down there - so a bump here is exactly
       * "the leads have changed", which is what a column needs to hear to re-read itself. On the table
       * the columns are not mounted, so it costs nothing.
       */
      markLeadsChanged();
    } catch (error) {
      if (!silent) showError(error.message || "Unable to load CRM leads.");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
      if (!silent && !append) setLoading(false);
    }

    // Put the view back where it was, once the refreshed rows have been laid out.
    if (restoreTo && container) {
      window.requestAnimationFrame(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = restoreTo;
      });
    }
  }

  // The table has been scrolled near its end; fetch the next page unless a read is already running
  // or the set is exhausted. `DataTable` asks 400px from the bottom, this board's own trigger.
  function loadMoreLeads() {
    if (loadingRef.current || leadsRef.current.length >= totalRows) return;
    void loadLeads({ append: true, silent: true });
  }

  /*
   * The tab counts, on the board.
   *
   * On the table they arrive with its page (`loadLeads`), but that whole read stands down on the
   * board - see the effect below - so the strip kept whichever counts the table last read: switch
   * the vertical on the board and every column re-read itself while the tab labels went on showing
   * the vertical before. The columns' own answers cannot stand in: each adds its status to the
   * filters, and the open tab's count follows the filters, so it would be one column's number.
   *
   * So the board asks once for the counts, with the same query the columns use minus the status -
   * one row, since only the counts are wanted - whenever that query or the leads change.
   */
  useEffect(() => {
    if (view !== "board") return undefined;
    let cancelled = false;
    apiRequest(`/api/sales/crm-leads/page?${leadPageQuery({ view: activeTab, offset: 0, limit: 1 }).toString()}`)
      .then((response) => {
        if (cancelled) return;
        if (response?.counts) setServerCounts(response.counts);
        if (response?.managesAnyone !== undefined) setManagesAnyone(Boolean(response.managesAnyone));
      })
      // The columns say for themselves when the board cannot be read; a failed count read keeps the
      // last labels rather than raising a second error over the same fault.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [view, leadPageQuery, activeTab, leadsChangedAt]);

  useEffect(() => {
    /*
     * Nothing is read for a table nobody is looking at.
     *
     * This effect is the table's page, its reload listener and its change poller. On the board they are
     * a second set of queries against the same endpoint the columns are already asking, for rows that
     * are not on screen - so the board doubled the load on the server and on the connection.
     */
    if (view !== "table") return undefined;
    const timer = window.setTimeout(() => {
      void loadLeads();
    }, 0);
    const handleReload = () => {
      void loadLeads({ silent: true });
    };
    // Live updates without a page refresh: poll a cheap version signal and refetch the
    // current page only when it actually moves. Paused while an editor is open.
    const checkForChanges = async () => {
      if (document.visibilityState !== "visible") return;
      if (editingRef.current) return;
      try {
        const response = await apiRequest("/api/sales/crm-leads/version");
        const next = response?.data?.version || "";
        if (!next) return;
        if (leadVersionRef.current === null) {
          leadVersionRef.current = next;
          return;
        }
        if (next !== leadVersionRef.current) {
          leadVersionRef.current = next;
          await loadLeads({ silent: true });
        }
      } catch {
        // Transient failures are ignored; the next tick retries.
      }
    };
    const poll = window.setInterval(() => {
      void checkForChanges();
    }, LEAD_VERSION_POLL_MS);
    document.addEventListener("visibilitychange", checkForChanges);
    window.addEventListener("dbs:crm-leads-refresh", handleReload);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", checkForChanges);
      window.removeEventListener("dbs:crm-leads-refresh", handleReload);
    };
    // `sort` is listed because ordering is done by the server: changing it has to refetch the
    // first page, not reorder the rows already in the browser. The two ends of the date range are
    // there for the same reason - the range narrows the query, not the rows already fetched.
    // `showingAllLeads` is listed for the same reason: changing whose leads are shown changes the
    // rows and every tab count, so it has to refetch rather than filter what is already here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, board, activeTab, appliedFilters, sort, dateFrom, dateTo, showingAllLeads]);

  // Typing in a column filter should not fire a query per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedFilters(filters), 400);
    return () => window.clearTimeout(timer);
  }, [filters]);

  /*
   * The question every filter menu on screen is currently an answer to: this board, this tab, this
   * range, these other filters. A menu held against any other key describes rows nobody is looking
   * at any more, so it is ignored and asked again.
   */
  /*
   * What "the values this column holds" is a question *about* - and deliberately **not** the other
   * filters.
   *
   * It used to include `appliedFilters`, so the cached answer was thrown away the moment anybody
   * filtered anything. With a single-select that was invisible: picking a value closed the menu, and
   * the next open asked afresh. With a multi-select the reader is still **in** the menu - so ticking
   * the first value emptied the list under their hand, and after Select all the menu read "No
   * matches." over a filter of three.
   *
   * Dropping it costs the cascade - the list no longer narrows as other columns are filtered - and
   * buys a menu that does not move while it is being used, which is the one it is for. The board,
   * the tab, the date range and All-leads still change the question and still ask it again.
   */
  const columnValuesKey = useMemo(
    () => JSON.stringify([board, activeTab, dateFrom, dateTo, showingAllLeads]),
    [board, activeTab, dateFrom, dateTo, showingAllLeads],
  );

  /** What this column's menu should offer, or null where nothing current has been read for it. */
  const columnFilterValues = useCallback(
    (column) => (columnValues.key === columnValuesKey ? columnValues.byColumn[column] : null),
    [columnValues, columnValuesKey],
  );

  /**
   * Asks for one column's values, the first time its menu is opened against this question.
   *
   * Once per column: a menu opened, closed and opened again reads what it already has, and a column
   * that answered nothing is remembered as nothing - an empty menu is an answer, and asking again on
   * every press would be a query each time for a column that will keep saying the same. Moving the
   * board, the tab, the range or another filter changes the key, and the next open asks afresh.
   */
  const openColumnFilter = useCallback((column) => {
    if (!column) return;
    setColumnValues((current) => {
      const currentQuestion = current.key === columnValuesKey ? current : { key: columnValuesKey, byColumn: {} };
      if (currentQuestion.byColumn[column]) return currentQuestion;
      setLoadingColumnValues(column);
      void fetchColumnValues(column)
        .then((response) => {
          const values = Array.isArray(response?.data) ? response.data : [];
          // Against the key it was asked under: an answer that arrives after the reader has moved
          // the board belongs to the board they have left, and must not be shown against the new one.
          setColumnValues((held) => (held.key === columnValuesKey
            ? { key: held.key, byColumn: { ...held.byColumn, [column]: values } }
            : held));
        })
        // A menu that cannot be filled still takes typing, which is what the box under it is for.
        .catch(() => setColumnValues((held) => (held.key === columnValuesKey
          ? { key: held.key, byColumn: { ...held.byColumn, [column]: [] } }
          : held)))
        .finally(() => setLoadingColumnValues((busy) => (busy === column ? "" : busy)));
      return currentQuestion;
    });
    // `fetchColumnValues` reads the board, the tab, the filters and the range as they stand - the
    // same four `columnValuesKey` is built from, which is the dependency that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnValuesKey]);

  const rows = leads;

  const boardColumns = useMemo(() => getMergedColumns(board, customFieldsByVertical), [board, customFieldsByVertical]);
  /*
   * How this reader has arranged this board - the order its columns were dragged into, how wide
   * they were pulled, which are hidden and how many are frozen - is `DataTable`'s to keep, under
   * `table:crm-<board>` against the login. The key is the one the board's own arrangement hook used
   * to write, so an arrangement made before the board became a `DataTable` reads back unchanged.
   */
  const defaultColumnVisibility = useMemo(
    () => Object.fromEntries(boardColumns.map((column) => [column.id, true])),
    [boardColumns],
  );
  // The board's columns as the table reads them, and the row menu after them. Memoised on the
  // board's columns alone: a fresh array here would rebuild every column and redraw every row.
  const leadTableColumns = useMemo(
    () => [...boardColumns.map(leadTableColumn), { ...ACTIONS_COLUMN, label: "Actions" }],
    [boardColumns],
  );
  // The table's scroll container, for `loadLeads` to put the reader back where they were.
  const tableScrollRef = useRef(null);

  // Exports what is on screen: the visible columns, in their order, for the rows the current
  // board, tab and filters have produced. The table hands both over - it is the one that knows
  // which columns survived Manage Columns and the order they were dragged into.
  function exportLeadsCsv({ rows: exportRows = rows, columns: exportColumns = [] } = {}) {
    const done = exportToCsv({
      fileName: createExportFileName(`crm-${boardLabel}`),
      columns: exportColumns
        .filter((column) => column.id !== "actions" && column.exportable !== false)
        .map((column) => ({
          key: column.id,
          label: column.label,
          value: (row) => getLeadCellValue(row, column.id),
        })),
      rows: exportRows,
    });
    if (!done) showError("There are no rows to export.");
  }

  /*
   * Opens the row menu at the pointer. Called from a row's `onContextMenu`.
   *
   * `useCallback` with no dependencies, and that matters more than it looks. The table's rows are
   * `memo()`d and compare the handlers they are given, so a new identity re-renders every row at
   * once - and a plain function declaration is a new identity on every render of this component.
   * Typing one character in a filter box used to re-render all 50,000 rows for exactly that.
   *
   * The comments elsewhere in this file that justify plain declarations by saying "the React
   * Compiler memoises it" are wrong for this build: there is no `reactCompiler` flag in
   * next.config.mjs and no babel-plugin-react-compiler installed. Nothing was memoising them.
   */
  const openRowMenu = useCallback((event, lead) => {
    setRowMenu({ x: event.clientX, y: event.clientY, lead });
  }, []);

  async function confirmDeleteLead() {
    const lead = pendingDeleteLead;
    if (!lead || deletingLead) return;
    setDeletingLead(true);
    try {
      await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(lead.id)}`, { method: "DELETE" });
      showSuccess(`${lead.name || lead.id} deleted.`);
      setPendingDeleteLead(null);
      /*
       * A deleted lead must not stay ticked, or Update Details would run against a row that
       * is gone. Only a plain tick is dropped: under "all matching", the set holds the rows
       * left out rather than the ones in, and the server simply stops returning this lead.
       */
      setSelection((current) => {
        if (current.allMatching || !current.ids.has(lead.id)) return current;
        const ids = new Set(current.ids);
        ids.delete(lead.id);
        return { ...current, ids };
      });
      if (selectedLeadId === lead.id) selectLead(null);
      await loadLeads({ silent: true });
    } catch (error) {
      showError(error.message || "Unable to delete this lead.");
    } finally {
      setDeletingLead(false);
    }
  }

  const todayKey = getLocalDateKey();
  /*
   * Memoised, because this is a linear scan of every loaded lead and it ran on every render -
   * every keystroke in a filter box, every poll, every row patch. Twice, in fact: the popup does
   * the same lookup below. At 50,000 loaded rows that is 100,000 comparisons per keypress.
   */
  const selectedLeadRecord = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) || null,
    [leads, selectedLeadId],
  );
  const selectedLeadDetails = selectedLeadRecord ? (detailsByLead[selectedLeadRecord.id] || {}) : {};
  const selectedLead = selectedLeadRecord ? mergeLeadDisplayRecord(selectedLeadRecord, selectedLeadDetails) : null;
  /*
   * The panel's tabs, which are two on a lead and one on a call.
   *
   * Remarks & Status sets a status and posts a note against the row's id, and on the Calls board
   * that id is a Call ID - so every one of those writes would be aimed at a lead that does not
   * exist. It is not a matter of wiring either: a call has no status anybody sets. It connected or
   * it did not, which the Status column already says, and its note was typed on the employee's own
   * phone. The caller is worked by opening the row, which is the Add Lead form.
   */
  const showingCall = Boolean(selectedLead?.callRow);
  const infoPanelTabs = showingCall ? INFO_PANEL_TABS.filter((tab) => tab.id === "info") : INFO_PANEL_TABS;
  // Only counts for the lead it was recorded against, so the gate closes again on the next row.
  const infoRemarkReady = Boolean(selectedLeadId)
    && infoRemark.leadId === selectedLeadId
    && (infoRemark.added || infoRemark.pending);
  // Empty unless a status is being held for the lead on screen, which is what makes moving to
  // another row drop it rather than carry it across.
  const infoDraftStatus = infoStatusDraft.leadId === selectedLeadId ? infoStatusDraft.leadStatus : "";
  // The row from the board, or the one fetched for a link when the board does not hold it.
  const linkedPopupLead = linkedLead?.id === showLeadPopupId ? linkedLead : null;
  const leadPopupRecord = useMemo(
    () => leads.find((lead) => lead.id === showLeadPopupId) || linkedPopupLead?.lead || null,
    [leads, showLeadPopupId, linkedPopupLead],
  );
  /*
   * What the popup is showing, which is the lead plus whatever has been typed into it.
   *
   * The draft is held here and written by Update and Close or Update and Proceed Next, and by
   * nothing else. Editing a field used to save it there and then - the row changed, the activity
   * log recorded it, and the two Update buttons had nothing left to do - so a field touched by
   * accident, or a value half typed on the way to another, was already in the CRM. Closing the
   * popup drops the draft, which is what closing without updating should mean.
   */
  const popupEdits = popupDraft.leadId === showLeadPopupId ? popupDraft : { lead: {}, details: {} };
  /*
   * Closing the lead popup with edits in it asks first, the way the settings rail does.
   *
   * The board renders its own `LeadPopupModal` rather than going through `LeadPopupHost` - that
   * host is the Contacts directory's way in - so the same question has to be asked in both places.
   * It is the same hook and the same wording in each, rather than two dialogs that could drift.
   *
   * `popupEdits` is already keyed to the lead on screen, so a draft left over from a lead that has
   * since been closed reads as empty and nothing is asked about it.
   */
  const popupHoldsUnsavedEdits = Object.keys(popupEdits.lead).length > 0 || Object.keys(popupEdits.details).length > 0;
  const { guard: guardPopupClose, confirmProps: popupCloseConfirmProps } = useUnsavedGuard(popupHoldsUnsavedEdits, {
    message: "This lead has edits that have not been saved. Go back and press Update and Close to keep them.",
    confirmLabel: "Discard & Close",
  });
  const leadPopupDetails = leadPopupRecord
    // A linked lead's details come with it; the board has never loaded them.
    ? { ...(detailsByLead[leadPopupRecord.id] || linkedPopupLead?.details || {}), ...popupEdits.details }
    : {};
  const leadPopup = leadPopupRecord
    ? { ...mergeLeadDisplayRecord(leadPopupRecord, leadPopupDetails), ...popupEdits.lead }
    : null;

  function updateShootRow(index, key, value) {
    setAddLeadForm((current) => {
      const nextShoots = Array.isArray(current.shoots) ? [...current.shoots] : [];
      nextShoots[index] = { ...(nextShoots[index] || emptyShootRow()), [key]: value };
      if (key === "shootType" && index === nextShoots.length - 1 && value && nextShoots.length < MAX_SHOOT_ROWS) {
        nextShoots.push(emptyShootRow());
      }
      return { ...current, shoots: nextShoots };
    });
  }

  function removeShootRow(index) {
    setAddLeadForm((current) => {
      const nextShoots = (current.shoots || []).filter((_, shootIndex) => shootIndex !== index);
      return { ...current, shoots: nextShoots.length ? nextShoots : [emptyShootRow()] };
    });
  }

  // Answers to the Table Settings fields are kept in their own object rather than spread
  // across the form, so they can be handed to the server as one `customFields` payload and
  // can never be mistaken for one of the built-in lead columns.
  function updateCustomField(key, value) {
    addLeadMarks.clear(`custom:${key}`);
    setAddLeadForm((current) => ({ ...current, customFields: { ...(current.customFields || {}), [key]: value } }));
  }

  // Rendered as the last cells of whichever vertical's Client Details grid is showing, so a
  // custom field lines up with the built-in inputs instead of sitting in a block of its own.
  const addLeadCustomFields = (customFieldsByVertical[addLeadForm.vertical] || []).map((field) => (
    <CustomFieldInput
      key={field.key}
      field={field}
      value={addLeadForm.customFields?.[field.key] ?? ""}
      onChange={(value) => updateCustomField(field.key, value)}
      error={addLeadMarks.errors[`custom:${field.key}`]}
    />
  ));

  /*
   * The statuses Add Lead offers, which differ by where the form was opened from.
   *
   * A lead being written down for the first time is one somebody is going to work, so the three
   * outcomes that end a conversation before it starts - CNA, Invalid, Rejected - are not offered:
   * they would be a lead created and closed in the same breath.
   *
   * A call is the exception, and Rejected is the one it needs. The caller has already been spoken
   * to - that is what the call *was* - and "not interested" is a real and common outcome of it. So
   * the row can be turned down here, in the one place the studio is looking at what was said, and
   * the lead it writes lands in that vertical's Rejected tab rather than in its pipeline.
   *
   * CNA and Invalid stay hidden even on a call. Both are read off the call itself on this board -
   * a missed call is Never Attended and a number that will not connect is Not Connected - and
   * offering them here would be asking somebody to retype what the row already says.
   */
  const addLeadStatusOptions = useMemo(() => {
    /*
     * Nothing is hidden while **assigning** an unassigned lead: the card was dragged out of
     * Unassigned onto one of the board's columns, and the board offers every status - CNA, Invalid
     * and Rejected among them. Hiding the pill for the column it was dropped on would leave the form
     * holding a status it does not show, which is a value saved without having been seen.
     */
    const hidden = assigningLeadId ? [] : assigningCallId ? ["CNA", "Invalid"] : ["CNA", "Invalid", "Rejected"];
    const offered = leadStatusOptionsForVertical(addLeadForm.vertical).filter((option) => !hidden.includes(option.value));
    /*
     * Rejected goes last, after Converted.
     *
     * `LEAD_STATUS_OPTIONS` is ordered by colour and by how the lead popup has always read, which
     * puts Rejected up beside CNA and Invalid - the three that end a conversation. Hiding the other
     * two left Rejected sitting first on this form, so a row of pills that runs from "we are working
     * this" to "we sold it" opened on "we turned them down".
     *
     * Reordered here rather than in the list itself, because that list is the popup's too and the
     * popup shows all three together where the grouping is right.
     */
    return [...offered.filter((option) => option.value !== "Rejected"), ...offered.filter((option) => option.value === "Rejected")];
  }, [assigningCallId, assigningLeadId, addLeadForm.vertical]);

  function updateForm(key, value) {
    setAddLeadForm((current) => {
      const next = { ...current, [key]: value };
      /*
       * A lead being turned down has no next call to make, so it carries no date for one.
       *
       * The two fields are taken off the form when Rejected or Invalid is chosen, and without this
       * a date typed before that would be saved anyway - booked against a lead nobody is chasing,
       * and showing up in somebody's Pending Followups tomorrow morning.
       */
      if (key === "leadStatus" && dropsNextFollowUp(value, next.vertical)) {
        next.nextFollowUpDate = "";
        next.nextFollowUpTime = "";
      }
      // Added already converted: today is its last follow-up.
      if (key === "leadStatus" && value === "Converted") next.lastFollowUpDate = getLocalDateKey();
      // The status and the custom fields both follow the vertical; see `leadFormForVertical`, which
      // is also what the Add Lead button uses to open the form on the board being read.
      if (key === "vertical") return leadFormForVertical(next, value, customFieldsByVertical);
      return next;
    });
  }

  /**
   * `committedEntries` is the remark list as it stands after Confirm posted whatever was
   * still in the notes box. Passed in rather than read from the form, because the state
   * update that carries it has not landed by the time this runs.
   */
  async function saveLead(committedEntries) {
    // The call being placed, if this is that. Read once here so the whole of what follows agrees
    // about which of the form's two jobs it is doing.
    const placing = assigningCallId;
    // The unassigned lead being given an owner, if that is this form's job. Read once here for the
    // reason `placing` is: everything below has to agree about which of the three it is doing.
    const assigning = assigningLeadId;
    const missing = missingRequiredLeadFields(addLeadForm);
    if (missing.length) {
      showError(markedFieldsMessage(missing.length));
      return;
    }
    /*
     * The enquiry id is left to the server.
     *
     * It used to be worked out here, from the highest number among the leads the table happened to
     * be holding - which was only ever right while every lead shared one run of numbers and the
     * browser held them all. An enquiry id now names its vertical and its branch and counts within
     * that pair, and the browser holds a page at a time, so the only honest answer is the one the
     * counter gives. An id typed in by hand is still sent as it stands.
     */
    const lead = {
      ...addLeadForm,
      // Stamped now, at save, in India time - not when the form was opened, and not in this
      // computer's zone. A call being placed keeps the time the call came in, and a lead being
      // assigned keeps its own: it arrived when it arrived, and giving it an owner is not its
      // arrival.
      ...(placing || assigning ? {} : { addedTime: studioClockTime(), createdDate: studioDateKey() }),
      id: addLeadForm.id.trim(),
      name: addLeadForm.name.trim(),
      phone: addLeadForm.phone.trim(),
    };
    try {
      const details = {
        /*
         * Where the lead came from, which a call already has an answer to.
         *
         * A lead typed into this form is a manual entry. A call is not - it came from Callyzer,
         * and the Source column, the group menu and the reports all read that from these three
         * fields. Stamping "manual" over them while placing a call would lose the one fact that
         * says how the studio got this client.
         */
        ...(placing ? {} : { groupId: "manual", groupName: "Manual entry leads", groupType: "manual" }),
        leadStatus: addLeadForm.leadStatus,
        lastFollowUpDate: addLeadForm.lastFollowUpDate,
        nextFollowUpDate: addLeadForm.nextFollowUpDate,
        nextFollowUpTime: addLeadForm.nextFollowUpTime,
        remarkEntries: normalizeRemarkEntries(committedEntries || addLeadForm.remarkEntries || addLeadForm.remarks),
        remarks: remarkSummary(committedEntries || addLeadForm.remarkEntries || addLeadForm.remarks),
        attachments: addLeadForm.attachments || [],
        shoots: (addLeadForm.shoots || []).filter((shoot) => Object.values(shoot).some(Boolean)),
        // Only the fields the chosen vertical actually offers. Answers left behind by
        // switching vertical mid-entry belong to a form this lead is not on.
        customFields: pickCustomFieldValues(addLeadForm.customFields, customFieldsByVertical[addLeadForm.vertical]),
      };
      /*
       * A call is created, not written.
       *
       * It used to be the other way round: Callyzer's webhook made a lead for every delivered call,
       * so placing one was an update of a row that already existed - and every misdial and wrong
       * number had already taken an Enquiry ID out of the run the studio counts its enquiries in.
       * The webhook no longer creates anything, so this is the moment the enquiry begins, and the
       * server mints its Enquiry ID for the vertical chosen above and hands this caller's calls to
       * it.
       *
       * The Call ID is not sent. It is not a lead id, and the call keeps it either way - what links
       * the two is the number, which is how the Call Logs tab has always found a client's calls.
       */
      /*
       * An unassigned lead is **written over, not written**.
       *
       * It exists already and holds its own enquiry id, so a POST would mint a second one against
       * the same client - which is the whole reason this mode exists rather than the form simply
       * being opened with values in it. The update endpoint takes a patch, so the form's own fields
       * are what change and nothing it does not carry is touched.
       */
      const saved = assigning
        ? await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(assigning)}`, { method: "PUT", body: JSON.stringify({ lead, details }) })
        : await apiRequest("/api/sales/crm-leads", { method: "POST", body: JSON.stringify({ lead, details }) });
      const savedId = saved?.data?.lead?.id || lead.id;
      // Unguarded on purpose: this lead has just been written, so there is nothing to ask about.
      // `closeAddLead` empties the form, so the next Add Lead starts from nothing.
      closeAddLead();
      await loadLeads();
      /*
       * Said as what happened, and it names the new Enquiry ID.
       *
       * The call stays on the Calls board - it is a call, and it happened - but it now carries that
       * id in its Enquiry ID column, and the lead itself is on the vertical just chosen. Both facts
       * are worth saying: somebody who thinks the row has moved goes looking for it on a board it
       * was never going to leave.
       */
      /*
       * What happened, in the words of the job it was doing - and for an assignment that is who it
       * is with now, which is the answer somebody dragged the card to get. Where they left Assign To
       * empty, it says so rather than claiming an owner: the card is still in Unassigned and a
       * message reading "assigned" over a card that has not moved is the worse of the two.
       */
      showSuccess(placing
        ? `${lead.name || savedId} added to ${lead.vertical} as ${savedId}.`
        : assigning
          ? (String(lead.crm || "").trim()
            ? `${lead.name || savedId} is with ${String(lead.crm).trim()}${String(lead.leadStatus || "").trim() ? ` at ${String(lead.leadStatus).trim()}` : ""}.`
            : `${lead.name || savedId} saved. It stays unassigned until somebody is named on it.`)
          : `${lead.name || savedId} added.`);
    } catch (error) {
      showError(error.message || (placing
        ? "Unable to add this call as a lead."
        : assigning ? "Unable to assign this lead." : "Unable to add CRM lead."));
    }
  }

  /**
   * What opening a row means, which depends on what the row is.
   *
   * A lead opens its popup, where it is worked. A call still waiting for a vertical opens the Add
   * Lead form on what the call knows, because the one thing it needs is the thing the popup cannot
   * give it. Decided per row rather than per board so a lead that has since been placed - the board
   * refreshes underneath the reader every few seconds - opens its popup even while the Calls board
   * is still on screen.
   */
  /*
   * Held to one identity across renders, through the refs rather than the state they publish.
   *
   * This is what every row's double-click reaches, and the table's rows are `memo()`d - so a new
   * identity here re-renders all of them. As a plain declaration it was a new identity on every
   * render, which is why typing in a filter box re-rendered 50,000 rows. `leadsRef` and
   * `detailsByLeadRef` are kept in step with their state on every write, so reading them here is
   * not stale.
   *
   * `customFieldsByVertical` is read through a ref for the same reason - it is state that changes
   * when Table Settings are loaded, and depending on it would rebuild this on that change.
   */
  const openLead = useCallback((id) => {
    const record = leadsRef.current.find((entry) => entry.id === id);

    /** The Add Lead form, on what this call knows. What a call with no lead behind it opens. */
    const addLeadForCall = () => {
      if (!record) return;
      const form = leadFormFromCall(record, detailsByLeadRef.current[id] || {});
      // The opening vertical's Table Settings answers, seeded the same way the Add Lead button seeds
      // them. The form renders those fields straight away now, and without this they would open
      // blank rather than on their defaults; switching vertical re-seeds through `updateForm`.
      setAddLeadForm({ ...form, customFields: customFieldDefaults(customFieldsByVerticalRef.current[form.vertical]) });
      setAssigningCallId(id);
      clearAddLeadMarks();
      setShowAddLead(true);
    };

    /*
     * A lead opens its popup; a call opens the Add Lead form on what the call knows.
     *
     * There is no third case any more. The Calls board is the queue of callers nobody has added, so
     * a row on it is always a call with no lead behind it - and a row that has gone stale in a tab
     * left open while somebody else added the caller opens that form too, where the duplicate check
     * says whose enquiry they already are rather than writing a second one.
     */
    if (!record?.unassignedCall) {
      openLeadPopupRef.current(id);
      return;
    }
    addLeadForCall();
  }, [clearAddLeadMarks]);

  /**
   * Shuts the form and forgets which of its two jobs it was doing.
   *
   * The draft is cleared only when it was a call's. A half-typed blank form survives a close
   * exactly as it always has - somebody who shuts Add Lead to go and look something up gets their
   * typing back - but a caller's details left in the form would reopen under the header button
   * still carrying that call's enquiry id, and Confirm would then write over the call.
   */
  /*
   * Closing Add Lead throws the form away.
   *
   * It used to keep it - close, reopen, and the typing was still there - which meant a lead half
   * written on Monday was still sitting in the form on Tuesday, under whoever opened it next. The
   * form is emptied now and the question is asked first instead, the same way the lead popup asks
   * it, so leaving is a decision rather than a thing that quietly happens to somebody else's work.
   *
   * Every way out comes through here, including the save path - which empties a form whose lead has
   * just been written, and is the one caller that must not be asked anything.
   */
  function closeAddLead() {
    setShowAddLead(false);
    addLeadMarks.clearAll();
    setAddLeadForm(emptyLeadForm());
    setAssigningCallId("");
    setAssigningLeadId("");
    // A decision to go ahead with a number the CRM already holds belongs to the form that was open
    // when it was made. Carried across, the next lead added on that number would be written with no
    // warning at all - which is the one case this whole check exists for.
    setDuplicateAlert(null);
    setDuplicateAckPhone("");
    setAddLeadDuplicates(null);
  }


  // Streams the file and ships rows in fixed-size chunks. A 500k-row CSV is never held
  // in memory as one parsed array, and each chunk is a separate request so one slow or
  // failed batch cannot lose the rest of the file.
  //
  // Chunks overlap: the reader keeps parsing while earlier chunks are still being written,
  // and CSV_MAX_IN_FLIGHT of them are on the wire at once. The server allocates ids from an
  // atomic sequence, so concurrent chunks of the same import can never collide.
  async function importCsvFromFile(file, targetTable = board, abortSignal, batchId) {
    if (!file) return;
    // Falls back for the same reason it always has, and now also catches Calls: `targetTable`
    // defaults to the board being read, and a spreadsheet cannot be imported onto that one.
    const table = importTableFor(targetTable);

    const startedAt = Date.now();
    setIsImporting(true);
    setImportProgress({ rows: 0, imported: 0, failed: 0, skipped: 0, totalKnown: false, startedAt });

    let headers = null;
    let pending = [];
    let nextRowNumber = 2;
    let totalRows = 0;
    let totalKnown = false;
    let imported = 0;
    let failedRows = 0;
    let skippedRows = 0;
    let overwritten = 0;
    // Rows the server declined because their vertical already holds that number. Counted apart from
    // `skippedRows`, which is blank lines: one of the two means somebody should go and look.
    let duplicateRows = 0;
    let aborted = false;
    // Set when the server refuses the file outright, which ends the run for every chunk.
    let rejection = "";
    // Returned to the caller: present only when the import ran to completion.
    let summary = null;
    let bytesRead = 0;
    // Named for what it holds. The server answers `verticals` - which system table each row landed
    // in - and `importSummaryRows` reads `verticals`; this alone said "branch", and the summary it
    // built carried the count under a key nothing read.
    const verticalTally = {};
    const inFlight = new Set();

    // Until the last row is parsed the true row count is unknown, so it is projected from
    // the share of the file already consumed. Without this the dialog would sit on
    // "calculating…" for the whole of a large import.
    const estimatedTotalRows = () => {
      if (totalKnown || !bytesRead || !file.size) return totalRows;
      return Math.max(totalRows, Math.round(totalRows * (file.size / bytesRead)));
    };

    const publishProgress = () => {
      setImportProgress({
        rows: estimatedTotalRows(),
        imported,
        failed: failedRows,
        skipped: skippedRows,
        totalKnown,
        startedAt,
      });
    };

    // Never rejects: a failure is folded into the tally so one bad chunk cannot leave the
    // other in-flight promises unhandled.
    const postChunk = async (rows, startRow) => {
      try {
        const response = await apiRequest("/api/sales/crm-leads/import-csv", {
          method: "POST",
          signal: abortSignal,
          body: JSON.stringify({
            headers,
            rows,
            startRow,
            systemTableId: CRM_TABLES[table]?.systemTableId || "",
            vertical: table,
            batchId,
            fileName: file.name,
          }),
        });
        const data = response?.data || {};
        // The server rolled this chunk back because the import was cancelled; it
        // contributes nothing to the tally.
        if (data.cancelled) {
          aborted = true;
          return;
        }
        imported += data.imported || 0;
        skippedRows += data.skipped || 0;
        duplicateRows += data.duplicates || 0;
        overwritten += data.overwritten || 0;
        for (const [name, count] of Object.entries(data.verticals || {})) {
          verticalTally[name] = (verticalTally[name] || 0) + count;
        }
      } catch (error) {
        if (error?.name === "AbortError" || abortSignal?.aborted) aborted = true;
        // A 400 is the server refusing the file itself - wrong table, unreadable headings.
        // That verdict applies to every chunk, so stop rather than retry the same rejection
        // for the rest of the file and report it as N failed rows.
        else if (error?.status === 400) rejection = error.message;
        else failedRows += rows.length;
      }
      publishProgress();
    };

    const send = () => {
      if (!headers || pending.length === 0) return;
      const rows = pending;
      const startRow = nextRowNumber;
      pending = [];
      nextRowNumber += rows.length;
      const task = postChunk(rows, startRow).finally(() => inFlight.delete(task));
      inFlight.add(task);
    };

    const waitForSlot = async () => {
      while (inFlight.size >= CSV_MAX_IN_FLIGHT) await Promise.race(inFlight);
    };

    // A refusal ends the run the same way a cancel does, but keeps its own message. Nothing
    // needs rolling back: the headers are identical in every chunk, so a file the server
    // refuses is refused before any of its rows are written.
    const checkStopped = () => {
      if (rejection) throw new Error(rejection);
      if (aborted || abortSignal?.aborted) throw new DOMException("The import was cancelled.", "AbortError");
    };

    try {
      for await (const row of streamCsvRows(file, (bytes) => {
        bytesRead = bytes;
      })) {
        checkStopped();
        if (!headers) {
          headers = row.map((cell) => String(cell || "").trim());
          continue;
        }
        totalRows += 1;
        pending.push(row);
        if (pending.length >= CSV_CHUNK_ROWS) {
          send();
          await waitForSlot();
          checkStopped();
        }
      }
      // The whole file has been read, so the row count is final and the estimate can stop
      // guessing at a moving target.
      totalKnown = true;
      send();
      await Promise.all(inFlight);
      checkStopped();
      publishProgress();

      if (!headers) {
        showError("CSV import failed: the file is empty.");
        return;
      }
      if (!totalRows) {
        showError("CSV import failed: the file has no lead rows.");
        return;
      }

      await loadLeads({ silent: true });
      // Every row read is accounted for, so a shortfall can never pass unnoticed.
      summary = {
        fileName: file.name,
        table,
        rows: totalRows,
        imported,
        skipped: skippedRows,
        duplicates: duplicateRows,
        failed: failedRows,
        overwritten,
        verticals: { ...verticalTally },
      };
      setImportSummary(summary);
    } catch (error) {
      // Cancelling owns its own messaging and its own rollback, so nothing is reported here.
      if (error?.name !== "AbortError") {
        showError(error.message || "CSV import failed: unable to read the file.");
      }
    } finally {
      // Requests still on the wire are already aborted; this only stops their handlers
      // racing the next import.
      await Promise.allSettled(inFlight);
      setIsImporting(false);
      setImportProgress(null);
      importAbortRef.current = null;
    }
    return summary;
  }

  // Header row for the board currently shown, so the template always matches the
  // columns that board's table expects.
  function downloadCrmCsvTemplate() {
    const columns = getTableColumns(importTable);
    const header = columns.map((column) => `"${String(column.label).replace(/"/g, '""')}"`).join(",");
    const blob = new Blob([`${header}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchorEl = document.createElement("a");
    anchorEl.href = url;
    anchorEl.download = `crm-${String(importTable || "leads").toLowerCase().replace(/\s+/g, "-")}-template.csv`;
    anchorEl.click();
    URL.revokeObjectURL(url);
  }

  // Re-runs whenever the file or the target table changes, so switching the dropdown to the
  // right table clears the warning without re-attaching the file.
  useEffect(() => {
    if (!importFile) return undefined;
    let cancelled = false;
    (async () => {
      const result = await checkCsvAgainstTable(streamCsvRows, boardTableColumns, importFile, importTable);
      if (!cancelled) setImportValidation(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [importFile, importTable]);

  function openImportDialog() {
    setImportFile(null);
    setImportTable(importTableFor(board));
    setImportValidation(null);
    setImportProgress(null);
    setImportSummary(null);
    setImportCancelled(false);
    setShowImportDialog(true);
  }

  function closeImportDialog() {
    if (isImporting) return;
    setShowImportDialog(false);
    setImportFile(null);
    setImportSummary(null);
    setImportValidation(null);
  }

  async function runCsvImport() {
    // The button is disabled unless the headings matched, so this only catches a stale
    // click while the re-check for a newly picked table is still running.
    if (!importFile || !importValidation?.ok) return;
    const file = importFile;
    const targetTable = importTable;
    const controller = new AbortController();
    const batchId = `csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    importAbortRef.current = controller;
    importBatchRef.current = batchId;
    setImportCancelled(false);
    const summary = await importCsvFromFile(file, targetTable, controller.signal, batchId);
    importBatchRef.current = null;
    if (!summary) closeImportDialog();
  }

  // Cancel undoes the import rather than stopping it part-way: the reader and every
  // request on the wire are dropped immediately, then the server deletes the leads this
  // run had already written, so the table is left exactly as it was before Import.
  //
  // Nothing here is awaited. Everything the user can see - the dialog, the notice - is
  // settled synchronously, and the rollback runs behind it. Waiting on the delete would
  // buy nothing: the leads it removes are ones the table was never showing.
  function cancelCsvImport() {
    if (importCancelled) return;
    const batchId = importBatchRef.current;
    importBatchRef.current = null;

    setImportCancelled(true);
    importAbortRef.current?.abort();
    setIsImporting(false);
    setImportProgress(null);
    setImportSummary(null);
    setShowImportDialog(false);
    setImportFile(null);
    showNotice("Import cancelled.");

    if (!batchId) return;
    // A chunk can still be mid-insert on the server when this lands; that chunk sees the
    // cancelled batch once its own insert returns and takes its rows back out itself.
    void apiRequest(`/api/sales/crm-leads/import-csv/${encodeURIComponent(batchId)}/cancel`, { method: "POST" })
      .then(() => loadLeads({ silent: true }))
      .catch((error) => {
        showError(error.message || "Import cancelled, but the partly imported leads could not be removed.");
      });
  }

  // Selection acts on the rows currently on screen, so it composes with the tab,
  // board and column filters rather than fighting them.
  // "All matching" is defined by the filters in force, so changing one ends it. Hand-picked
  // rows are left alone.
  // asc -> desc -> back to the default order, the same cycle as the other modules' tables - and
  // the table's own, so a press is simply what it proposes: `sorting: { sort, onChange: setSort }`.

    /*
   * A column filter as the multi-select holds it: a list, whatever it was left as.
   *
   * A board saved with the old single-string filter, or a link carrying one, still reads - it is a
   * list of one - so nothing anybody had open stops working when this ships.
   */
  const asFilterList = (value) => {
    if (Array.isArray(value)) return value;
    const text = String(value ?? "").trim();
    return text ? [text] : [];
  };

  /*
   * The filter row as the table reports it - the whole row, `{ columnId: value }`, on every change.
   *
   * The pinning of the columns before the rows change under them - this board is laid out
   * automatically until somebody pulls a column, so each keystroke used to re-measure the whole
   * table - is the table's own now, under `layout: "auto"`.
   */
  const applyColumnFilters = useCallback((next) => {
    setSelection((current) => (current.allMatching ? emptySelection() : current));
    setFilters(next);
  }, []);

  /*
   * The filters as the boxes show them. A closed-set column's value is a list whatever it was left
   * as - see `asFilterList` - so a board saved with the old single-string filter still reads.
   */
  const tableFilters = useMemo(() => Object.fromEntries(Object.entries(filters).map(([columnId, value]) => {
    const kind = columnFilterKind(columnId);
    return [columnId, kind === "status" || kind === "choice" ? asFilterList(value) : value];
  })), [filters]);

  const selectedCount = countSelected(selection, totalRows);

  /**
   * How the selected leads will land on the ticked CRMs, previewed in Update Details.
   *
   * assignCrmLeads on the server walks the ids and gives each one to `crms[index % crms.length]`,
   * so the first `count % crms.length` CRMs take one extra lead. This repeats that arithmetic
   * rather than approximating it, or the preview would disagree with the result by a lead.
   */
  const bulkUpdateSplit = useMemo(() => {
    const size = bulkUpdateCrms.length;
    if (!size) return [];
    const base = Math.floor(selectedCount / size);
    const remainder = selectedCount % size;
    return bulkUpdateCrms.map((crm, index) => ({ crm, count: base + (index < remainder ? 1 : 0) }));
  }, [bulkUpdateCrms, selectedCount]);

  /*
   * What is ticked, as the table asks it - see `selectionModel` in `DataTable`.
   *
   * A model rather than a set, because the board is paged: "every lead the board, tab and filters
   * match" is a boolean plus exceptions, not a list the browser could hold. Select-all takes in the
   * pages still to be fetched; pressing it again with anything selected clears the lot.
   */
  const selectionModel = useMemo(() => ({
    isSelected: (id) => isSelected(selection, id),
    headerState: () => headerState(selection, totalRows),
    toggleAll: () => setSelection((current) => toggleAll(current, totalRows)),
    toggleRow: (id) => setSelection((current) => toggleOne(current, id)),
    count: () => countSelected(selection, totalRows),
    clear: () => setSelection(emptySelection()),
  }), [selection, totalRows]);
  // What the header box says it will do. Stable, or the table would rebuild its columns on every
  // render for a fresh arrow.
  const selectionHeaderLabel = useCallback(
    (checked) => (checked ? "Clear selection" : `Select all ${totalRows.toLocaleString()} leads in ${boardLabel}`),
    [totalRows, boardLabel],
  );

  /**
   * The concrete ids an action must run against. With `allMatching` the browser has only
   * seen part of the board, so the full list is resolved from the server and the user's
   * exceptions are removed from it.
   */
  const resolveSelectedIds = useCallback(async () => {
    if (!selection.allMatching) return Array.from(selection.ids);
    const query = new URLSearchParams({
      board: board || "Dum Dum",
      view: activeTab,
      today: getLocalDateKey(),
      filters: JSON.stringify(appliedFilters || {}),
      // The same range the board is being read over. "Select all" means the rows the reader can
      // see; resolved without it, it would hand a bulk action every lead the tab has ever held.
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      /*
       * And the same answer to "whose", for the same reason the date range is here: "select all"
       * means the rows the reader can see. Resolved without it, a bulk action taken on a board
       * narrowed to one person's leads would run against their whole team's.
       */
      mine: showingAllLeads ? "false" : "true",
    });
    const response = await apiRequest(`/api/sales/crm-leads/ids?${query.toString()}`);
    const matched = Array.isArray(response?.data) ? response.data : [];
    return matched.filter((id) => !selection.ids.has(id));
  }, [selection, board, activeTab, appliedFilters, dateFrom, dateTo, showingAllLeads]);

  /**
   * Moves the panel to a lead, dropping anything held for the one being left.
   *
   * Keying the held status by lead is not enough on its own: coming back to the lead it was
   * picked on would match it again, so a status chosen and walked away from reappeared on the
   * pill as though it had been saved. Leaving is the same answer as closing the popup - a
   * status picked but never confirmed is not a decision, and must not look like one.
   *
   * Every move goes through here rather than the setter, so there is one place that can be
   * true and no route back to a lead that skips it.
   */
  const selectLead = useCallback((id) => {
    setInfoStatusDraft({ leadId: "", leadStatus: "" });
    setSelectedLeadId(id);
  }, []);

  // The same two writes as `selectLead` rather than a call to it: naming it as a dependency
  // costs the whole component its compiler optimisation, and state setters need no dependency.
  const activateLead = useCallback((id) => {
    setInfoStatusDraft({ leadId: "", leadStatus: "" });
    setSelectedLeadId(id);
    setInfoState("expanded");
  }, []);

  /*
   * What a row answers to, as the table hands it the record. All four are `useCallback`, and that
   * matters more than it looks: the table's rows are memoised and compare these, so a fresh arrow on
   * every render would redraw every row on every render - typing one character in a filter box used
   * to re-render 50,000 rows for exactly this reason.
   */
  const activateLeadRow = useCallback((lead) => activateLead(lead.id), [activateLead]);
  const openLeadRow = useCallback((lead) => openLead(lead.id), [openLead]);
  /*
   * ── A card on the board opens its lead the way a link does ────────────────────────────────────
   *
   * `openLead` looks the lead up among the table's rows, and the table stands down while the board is
   * shown - so `leads` is **empty** and the popup, which resolves what it shows out of that array, had
   * nothing to show. A card opened nothing at all on a board reached directly, which a remembered view
   * means every morning; switching to the board from the table in the same session left the rows
   * loaded and it worked, which is why it looked unreliable rather than broken. And where a lead was
   * found, its *details* still were not - they come with the table's page too - so the status pills,
   * which read a lead's status off its details, came up empty on the one screen whose whole purpose is
   * to open a lead at a status.
   *
   * `openLinkedLead` is the path written for this: "a lead that is not among the rows on screen",
   * fetched with its details and handed to the popup as its own, leaving the table's state untouched.
   * Through the ref, so this keeps one identity and the cards are not redrawn on every render.
   */
  const openBoardLead = useCallback((lead) => {
    if (lead?.id) openLinkedLeadRef.current(lead.id);
  }, []);

  /*
   * ── Dropping a lead on a status ───────────────────────────────────────────────────────────────
   *
   * One column refuses: **Unassigned** is not a status anybody sets - it is what the Status column
   * prints when a lead has no CRM at all - so writing it as one would be a lie about the record.
   *
   * **Converted and Converted & Followup used to refuse too**, because they are not written either:
   * they book a project, and a drafted "Converted" would have sat in the popup looking like a status
   * while nothing had converted. But that made the two columns somebody most wants to drag a lead into
   * the two they could not - and on a Qua Qua board they are the far end of the rail as well, which is
   * where the refusal read as the board being broken rather than as a rule. They take the drop now and
   * it goes to the conversion dialog instead of to the draft; see the pending-drop effect.
   *
   * The column a card came from is refused by the board itself, since dropping a lead where it already
   * is is not a move.
   */
  /*
   * Nor does a column stood up only because a lead holds that status - an imported "Inactive", or
   * Converted & Followup outside Qua Qua: neither is one this vertical offers, so neither may be chosen.
   */
  const canDropAt = useCallback((status) => status !== UNASSIGNED_STATUS && status !== PROJECT_DELETED_STATUS
    && (status === YET_TO_CONNECT_STATUS || leadStatusOptionsForVertical(board).some((option) => option.value === status)), [board]);

  /**
   * A dropped card opens its lead with the target status **drafted** - it does not write it.
   *
   * So what follows is the ordinary save: the popup refuses without a remark, and the register can
   * still say why the lead moved. The drag reaches the editor with the answer filled in; it is not a
   * second way of changing a lead.
   *
   * The status is applied a tick later, through `draftPopupDetails` - the very path a press on the
   * status pill takes - so the occasion's own copy, the cleared follow-up date and the custom-field
   * write all happen exactly as they do when somebody chooses it by hand. Deferred because the popup
   * has to be the open one before its draft can be written.
   */
  const [pendingDropStatus, setPendingDropStatus] = useState(null);
  const openLeadAtStatus = useCallback((lead, status) => {
    if (!lead?.id) return;
    /*
     * A card dragged out of **Unassigned** opens Add Lead on that lead instead of the popup.
     *
     * What such a lead is missing is an owner, and the popup cannot give it one - the only Assign To
     * control in this module is on this form. So the form opens on the lead it already is, with the
     * dropped status chosen and Assign To waiting, and Confirm updates it. Leave Assign To empty and
     * the card stays in Unassigned, which needs no rule of its own: the board reads any lead with no
     * CRM as unassigned whatever its status.
     */
    if (resolveLeadStatus(lead) === UNASSIGNED_STATUS) {
      openAssignLeadRef.current(lead.id, status);
      return;
    }
    // The board's own way in - see `openBoardLead` for why the table's lookup cannot answer here.
    openLinkedLeadRef.current(lead.id);
    setPendingDropStatus({ id: lead.id, status });
  }, []);
  // Right-click opens the row's own menu instead of the browser's. The row is activated first, so
  // the menu is unmistakably acting on the row under the pointer.
  const openLeadRowMenu = useCallback((lead, event) => {
    event.preventDefault();
    // The page has a right-click menu of its own; a row's is the more specific of the two.
    event.stopPropagation();
    activateLead(lead.id);
    openRowMenu(event, lead);
  }, [activateLead, openRowMenu]);
  /*
   * One list for the row's ⋮ and the board card's ⋮. `open` is how the entry opens the lead: the
   * table's `openLead`, or on the board `openBoardLead`, since `openLead` reads the table's rows and
   * the table stands down while the board is shown.
   */
  const leadActionItems = useCallback((lead, open) => [
    // Edit and a red Delete are the pair every table in the OS offers. Meetings sits between
    // them because it is this module's own action, the way the Employees table adds Review and
    // Cancel Invite to the same two.
    // "Edit" opens the lead; without READ_WRITE the same panel is what reads it, so the entry
    // stays and the panel itself is what refuses to save. On a call it opens the Add Lead form,
    // or the lead the caller was added as - `openLead` decides which.
    { label: lead.callRow ? "Add Lead" : canWrite ? "Edit" : "View", onSelect: () => open(lead) },
    /*
     * Neither on a call. Both act on a lead named by the row's id, and a call's id is a Call ID
     * - so Meetings would book a meeting against a lead that does not exist and Delete would
     * delete nothing while saying it had. A call is not deletable in any case: it is a record
     * of something that happened, and the studio does not get to unhappen it.
     */
    ...(lead.callRow ? [] : [{ label: "Meetings", onSelect: () => setMeetingsLeadId(lead.id) }]),
    ...(canDeleteLeads && !lead.callRow ? [{ label: "Delete", tone: "danger", onSelect: () => setPendingDeleteLead(lead) }] : []),
  ], [canWrite, canDeleteLeads]);
  const renderLeadActions = useCallback((lead) => (
    <OptionsMenu
      ariaLabel={`Actions for ${lead.name || lead.id}`}
      zIndex={130}
      menuClassName="w-44"
      items={leadActionItems(lead, openLeadRow)}
    />
  ), [leadActionItems, openLeadRow]);
  const boardLeadActions = useCallback((lead) => leadActionItems(lead, openBoardLead), [leadActionItems, openBoardLead]);
  /*
   * The values a closed-set column offers, asked of the server when its menu opens - see
   * `openColumnFilter`. `has` is which columns are lists at all: Status and the choice columns, the
   * kinds the board has always drawn a menu for.
   */
  const leadFilterValues = useMemo(() => ({
    has: (columnId) => ["status", "choice"].includes(columnFilterKind(columnId)),
    get: columnFilterValues,
    onOpen: openColumnFilter,
    loading: loadingColumnValues,
  }), [columnFilterValues, openColumnFilter, loadingColumnValues]);

  /**
   * Shares leads out between the ticked CRMs, one at a time in turn.
   *
   * Acts on the current selection when there is one, and on everything the board, tab and
   * filters match when there is not - the same set the table is showing.
   */
  /**
   * The one bulk action on a selection: it writes Lead Status, Last Updated Date and Next
   * Follow-up Date, and hands the leads to the ticked CRMs.
   *
   * Any field left blank is left alone, so a status-only edit does not clear the CRM and an
   * assignment does not touch the status. Assignment goes last because the per-lead write
   * above it carries the lead's current CRM - running it first would be undone.
   */
  async function applyBulkUpdateDetails() {
    if (!selectedCount) return;
    if (!bulkUpdateLeadStatus && !bulkUpdateLastUpdatedDate && !bulkUpdateNextFollowUpDate && !bulkUpdateCrms.length && !bulkUpdateVertical) return;

    setBulkUpdating(true);
    let ids;
    try {
      ids = await resolveSelectedIds();
    } catch (error) {
      setBulkUpdating(false);
      showError(error.message || "Unable to resolve the selected leads.");
      return;
    }
    if (!ids.length) {
      setBulkUpdating(false);
      setShowBulkUpdateDialog(false);
      return;
    }

    try {
      // One call for the whole selection, the same as the assignment below. A PUT per lead
      // made the cost of this dialog grow with the number of rows ticked, and each of those
      // requests re-reads the lead, upserts it, checks the table's columns and posts a
      // webhook. That is unnoticeable against a handful of local leads and slow enough on the
      // server for the proxy to answer first - with an error carrying no CORS headers, which
      // the browser cannot read at all, so the app reports the API as unreachable.
      let statusMessage = "";
      if (bulkUpdateLeadStatus || bulkUpdateLastUpdatedDate || bulkUpdateNextFollowUpDate || bulkUpdateVertical) {
        const response = await apiRequest("/api/sales/crm-leads/bulk-status", {
          method: "POST",
          body: JSON.stringify({
            ids,
            // The vertical moves first on the server, then any status or date lands where the leads now are.
            ...(bulkUpdateVertical ? { vertical: bulkUpdateVertical } : {}),
            ...(bulkUpdateLeadStatus ? { status: bulkUpdateLeadStatus } : {}),
            ...(bulkUpdateLastUpdatedDate ? { lastFollowUpDate: bulkUpdateLastUpdatedDate } : {}),
            ...(bulkUpdateNextFollowUpDate ? { nextFollowUpDate: bulkUpdateNextFollowUpDate } : {}),
            // The browser's day, like every board request sends: a status set on a Qua Qua lead
            // with a newborn or birthday window open belongs to that occasion, and which occasion
            // that is depends on the day the user is looking at.
            today: getLocalDateKey(),
          }),
        });
        // A move names how many went and how many stayed behind for a number already there - worth reading.
        if (bulkUpdateVertical) statusMessage = response?.message || "";
      }

      // One ticked CRM gives every lead that CRM; several share the leads out between them
      // in turn. Both are the same server call, so there is no separate path for either.
      let assignMessage = "";
      if (bulkUpdateCrms.length) {
        const response = await apiRequest("/api/sales/crm-leads/bulk-assign", {
          method: "POST",
          body: JSON.stringify({ ids, crms: bulkUpdateCrms }),
        });
        assignMessage = response?.message || "";
      }

      const leadCount = `${ids.length.toLocaleString()} lead${ids.length === 1 ? "" : "s"}`;
      setShowBulkUpdateDialog(false);
      // The server's own wording is preferred when it assigned, because it names the split
      // per CRM; the plain count is only the fallback for a status or date edit.
      setSuccessDialog({ title: "Updated!", message: [statusMessage, assignMessage].filter(Boolean).join(" ") || `${leadCount} updated successfully.` });
      clearSelection();
      await loadLeads({ silent: true });
    } catch (error) {
      showError(error.message || "Unable to update the selected leads.");
    } finally {
      setBulkUpdating(false);
    }
  }

  /**
   * Deletes the whole selection, on `SALES / CRM Lead Deletion` and nowhere else.
   *
   * The ids are resolved the same way Update Details resolves them, so "select all" deletes exactly
   * the leads the board, tab, filters and date range match rather than only the pages that happen to
   * have been scrolled into view - and the server re-checks every one of them against the caller's
   * own data scope before it removes anything, so an id typed into the request buys nothing.
   *
   * One request for the lot. A DELETE per lead would be a request per row against an endpoint that
   * reads the lead, deletes its remarks, call logs and history, and answers - which is fine for the
   * row menu's one lead and is a proxy timeout over a vertical.
   */
  async function applyBulkDelete() {
    if (!canDeleteLeads || !selectedCount || bulkDeleting) return;

    setBulkDeleting(true);
    let ids;
    try {
      ids = await resolveSelectedIds();
    } catch (error) {
      setBulkDeleting(false);
      showError(error.message || "Unable to resolve the selected leads.");
      return;
    }
    // Nothing left to delete - the rows went while the dialog was open. Closing quietly is the
    // honest answer: the selection is already in the state the user asked for.
    if (!ids.length) {
      setBulkDeleting(false);
      setPendingBulkDelete(false);
      clearSelection();
      await loadLeads({ silent: true });
      return;
    }

    try {
      const response = await apiRequest("/api/sales/crm-leads/bulk", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
      // The server answers with the ids it actually removed, which is the set to close the panel
      // and the popup on - a lead outside the caller's scope is dropped from the request silently
      // and is still on the board.
      const deleted = new Set(response?.data?.deletedIds || ids);
      setPendingBulkDelete(false);
      if (selectedLeadId && deleted.has(selectedLeadId)) selectLead(null);
      if (showLeadPopupId && deleted.has(showLeadPopupId)) setShowLeadPopupId(null);
      clearSelection();
      // The server's own wording names the count it removed rather than the count that was ticked.
      setSuccessDialog({ title: "Deleted!", message: response?.message || `${deleted.size.toLocaleString()} lead${deleted.size === 1 ? "" : "s"} deleted successfully.` });
      await loadLeads({ silent: true });
    } catch (error) {
      showError(error.message || "Unable to delete the selected leads.");
    } finally {
      setBulkDeleting(false);
    }
  }

  /**
   * How many times this lead's number has enquired.
   *
   * Answered by the server: the same person enquiring again becomes a separate lead, and the
   * other one is very unlikely to be among the rows fetched so far.
   */
  useEffect(() => {
    const phone = leadPopup?.contactNumber || leadPopup?.phone || "";
    if (!showLeadPopupId || !phone) return undefined;
    let cancelled = false;
    void getDuplicateEnquiries({ phone, excludeId: showLeadPopupId })
      .then((response) => {
        if (!cancelled && response?.data) setDuplicateEnquiries({ leadId: showLeadPopupId, ...response.data });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showLeadPopupId, leadPopup?.phone, leadPopup?.contactNumber]);

  // Loads the log for whichever lead the popup has open. Keyed by lead id, so the previous
  // lead's history is never shown against the one just opened, and "still loading" is simply
  // "the key does not match yet".
  useEffect(() => {
    if (!showLeadPopupId) return undefined;
    let cancelled = false;
    (async () => {
      let rows = [];
      try {
        const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(showLeadPopupId)}/activity`);
        rows = Array.isArray(response?.data) ? response.data : [];
      } catch {
        rows = [];
      }
      if (!cancelled) setLeadActivity({ leadId: showLeadPopupId, rows });
    })();
    return () => {
      cancelled = true;
    };
  }, [showLeadPopupId, activityRefreshKey]);

  /*
   * The calls Callyzer has reported against this lead.
   *
   * Loaded the same way and on the same key as the activity log above, so Call Logs behaves like
   * the tab beside it: keyed by lead id, so one lead's calls are never shown under another, and
   * refreshed when the page regains focus - a call made on the phone during a follow-up appears
   * on the next delivery without reopening the popup.
   */
  useEffect(() => {
    if (!showLeadPopupId) return undefined;
    let cancelled = false;
    (async () => {
      let rows = [];
      try {
        const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(showLeadPopupId)}/call-logs`);
        rows = Array.isArray(response?.data) ? response.data : [];
      } catch {
        rows = [];
      }
      if (!cancelled) setLeadCallLogs({ leadId: showLeadPopupId, rows });
    })();
    return () => {
      cancelled = true;
    };
  }, [showLeadPopupId, activityRefreshKey]);

  /*
   * The transcripts of those calls.
   *
   * Loaded on the same key as the call logs above. A transcript arrives minutes after the call
   * does - it is queued, not made inline - so this also refreshes when the page regains focus,
   * which is when somebody comes back to see whether it is ready.
   */
  useEffect(() => {
    if (!showLeadPopupId) return undefined;
    let cancelled = false;
    (async () => {
      let rows = [];
      try {
        const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(showLeadPopupId)}/transcripts`);
        rows = Array.isArray(response?.data) ? response.data : [];
      } catch {
        rows = [];
      }
      if (!cancelled) setLeadTranscripts({ leadId: showLeadPopupId, rows });
    })();
    return () => {
      cancelled = true;
    };
  }, [showLeadPopupId, activityRefreshKey]);

  /**
   * What the lead became, read back from Sales Manager.
   *
   * Converting opens Create Project in a *second tab*, so the project is saved somewhere this
   * page never hears about. Refetching only on open would leave Converted History empty for
   * whoever came straight back to a popup that was already sitting there.
   *
   * So it also re-reads whenever this tab regains focus, which is exactly the moment the user
   * returns from having saved the project. Cheap enough to do plainly: one indexed read of one
   * lead's projects.
   */
  useEffect(() => {
    if (!showLeadPopupId) return undefined;
    let cancelled = false;

    const load = async () => {
      let rows = [];
      try {
        const response = await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(showLeadPopupId)}/projects`);
        rows = Array.isArray(response?.data) ? response.data : [];
      } catch {
        rows = [];
      }
      if (!cancelled) setLeadProjects({ leadId: showLeadPopupId, rows });
    };

    void load();
    /*
     * Returning to this tab is the moment the user comes back from having saved the project -
     * which is also when the lead was marked Converted, so the status log above the projects
     * has to be re-read with them. Bumping the shared key re-runs both this effect and the
     * activity one, rather than leaving half the tab showing what it showed before.
     */
    const onFocus = () => setActivityRefreshKey((key) => key + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [showLeadPopupId, activityRefreshKey]);

  /**
   * Says that an edit saved, once the edits stop.
   *
   * Every field writes as it is typed - one PUT per keystroke - so confirming each one would be
   * a snackbar per character. This waits for the writes to settle and then says it once, naming
   * the last field touched, which is the thing the user is waiting to be told: that what they
   * typed is on the server and not only on the screen.
   */
  const savedNoticeTimer = useRef(null);
  const confirmSaved = useCallback((label) => {
    if (savedNoticeTimer.current) window.clearTimeout(savedNoticeTimer.current);
    savedNoticeTimer.current = window.setTimeout(() => {
      savedNoticeTimer.current = null;
      showSuccess(label ? `${label} saved.` : "Changes saved.");
    }, SAVED_NOTICE_DELAY_MS);
  }, [showSuccess]);

  // A pending confirmation belongs to the screen that raised it; leaving it to fire into an
  // unmounted page would set state on it.
  useEffect(() => () => {
    if (savedNoticeTimer.current) window.clearTimeout(savedNoticeTimer.current);
  }, []);

  /**
   * Re-reads the log once a change has actually landed on the server. Every edit fires its
   * own PUT and returns immediately, so bumping the key up front would race the write.
   */
  /*
   * Re-reads the lead's tabs after suggestions are applied. Memoised rather than written inline in
   * the JSX: an arrow created on every render is a new prop every render, and the compiler cannot
   * keep the memoisation around it.
   */
  const refreshLeadTabs = useCallback(() => setActivityRefreshKey((key) => key + 1), []);

  const refreshActivityFor = useCallback((id) => {
    if (!id || id !== showLeadPopupId) return;
    setActivityRefreshKey((key) => key + 1);
  }, [showLeadPopupId]);

  /**
   * An edit in the lead popup, kept until it is saved.
   *
   * The same two functions are used by the info panel beside the table, which saves as it goes -
   * these are the popup's, and the difference is deliberate: the popup asks to be finished with an
   * Update, so nothing it holds should be in the CRM before that.
   */
  function draftPopupLead(key, value) {
    setPopupDraft((current) => ({
      leadId: showLeadPopupId,
      lead: { ...(current.leadId === showLeadPopupId ? current.lead : {}), [key]: value },
      details: current.leadId === showLeadPopupId ? current.details : {},
    }));
  }

  /*
   * The status a dropped card asked for, written once its popup is the open one.
   *
   * Deferred by a tick, the way every other first write on this page is: `draftPopupDetails` reads
   * `showLeadPopupId` and `leadPopup`, so it has to run after the open has settled rather than in the
   * same pass. Cleared as it fires, so re-opening the same lead later does not re-apply it.
   *
   * **Every status it can carry, including the two that book a project.** Converted and Converted &
   * Followup are drafted here like any other and answered by the footer: the lead is filled in and
   * saved, and Create Project is offered afterwards - see `convertedAsk`. Raising the conversion
   * dialog as the card landed was tried first and was wrong twice over - it asked before the reader
   * had seen the lead, and the dialog answering it wrote what it could see rather than the details
   * they had just filled in.
   */
  useEffect(() => {
    if (!pendingDropStatus || showLeadPopupId !== pendingDropStatus.id || !leadPopup) return undefined;
    const timer = window.setTimeout(() => {
      draftPopupDetails("leadStatus", pendingDropStatus.status);
      setPendingDropStatus(null);
    }, 0);
    return () => window.clearTimeout(timer);
  });

  function draftPopupDetails(key, value) {
    setPopupDraft((current) => {
      // Plus the occasion's own copy of the field - see `draftDetails` and `occasionEcho`.
      const details = {
        ...(current.leadId === showLeadPopupId ? current.details : {}),
        [key]: value,
        ...occasionEcho(leadPopup || {}, key, value),
        // Turning a lead down drops the next call it was carrying - see `followUpClearedBy`.
        ...followUpClearedBy(leadPopup || {}, key, value),
      };
      // A Table Settings field lives inside `customFields`, so editing one has to write there as
      // well - the same rule the saved path follows.
      if (isCustomFieldKey(key, customFieldsByVertical)) {
        const existing = (current.leadId === showLeadPopupId ? current.details.customFields : null)
          || detailsByLeadRef.current[showLeadPopupId]?.customFields
          || {};
        details.customFields = { ...existing, [key]: value };
      }
      return {
        leadId: showLeadPopupId,
        lead: current.leadId === showLeadPopupId ? current.lead : {},
        details,
      };
    });
  }

  function discardPopupDraft() {
    setPopupDraft({ leadId: "", lead: {}, details: {} });
  }

  // The info panel's equivalent, for the two pills that write for themselves and for a
  // finished update.
  function clearInfoStatusDraft() {
    setInfoStatusDraft({ leadId: "", leadStatus: "" });
  }

  function updateLead(id, key, value) {
    // Through the ref as well as the state: the other row patches re-publish `leadsRef.current`
    // wholesale, so an edit left only in state was dropped by the next one of those.
    leadsRef.current = leadsRef.current.map((lead) => (lead.id === id ? { ...lead, [key]: value } : lead));
    setLeads(leadsRef.current);
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(id)}`, {
      method: "PUT",
      /*
       * The field that changed, and nothing else.
       *
       * This sent `leads.find(...)` - the lead as the table row list holds it - with `|| {}` behind
       * it. The table is paged, so a lead being edited is not always in that array: a row reached
       * after the list refreshed, or on a page that has since been replaced, fell through to `{}`
       * and posted a lead with exactly one field on it. The server wrote that as the whole row, and
       * everything else on the lead - its vertical, its name, its phone, its status - was blanked.
       * A Corp lead with no vertical is read as a Dum Dum one, so it left the board it was on.
       *
       * The server merges an update onto the stored lead now, so the field alone is the correct and
       * the safest thing to send: nothing absent is written, and a stale row in the browser can no
       * longer overwrite a field somebody else has since changed.
       */
      body: JSON.stringify({ lead: { [key]: value }, details: {} }),
    })
      .then(() => {
        refreshActivityFor(id);
        confirmSaved(fieldLabelFor(key, board, customFieldsByVertical));
      })
      .catch((error) => showError(error.message || "Unable to update CRM lead."));
  }

  function updateLeadDetails(id, key, value) {
    const currentLead = leads.find((lead) => lead.id === id) || {};
    const existing = detailsByLeadRef.current[id] || detailsByLead[id] || {};
    /*
     * The same value on the occasion's own field, when this lead has one open.
     *
     * The request is unchanged - it names `leadStatus` or the follow-up field, and the server
     * decides where that belongs - but the row on screen is rebuilt from these details straight
     * away, and it reads an occasion lead's status and follow-up off the occasion. Without the echo
     * the edit would appear to be discarded until the next reload.
     */
    const nextDetails = { ...existing, [key]: value, ...occasionEcho(mergeLeadDisplayRecord(currentLead, existing), key, value) };
    // A Table Settings field is stored inside `customFields`, not as a column of its own, so
    // editing one has to write there as well. Without this the value would show on screen
    // and be dropped by the next reload.
    if (isCustomFieldKey(key, customFieldsByVertical)) {
      nextDetails.customFields = { ...(existing.customFields || {}), [key]: value };
    }
    // Written before setState so a burst of edits (typing a venue, then a district)
    // each build on the previous one rather than on the last rendered snapshot.
    detailsByLeadRef.current = { ...detailsByLeadRef.current, [id]: nextDetails };
    setDetailsByLead((current) => ({ ...current, [id]: nextDetails }));
    // The table row is a flat object built from the lead *and* its details: Shoot Type, Location,
    // City, State, the event date and the time all come off the details' shoot rows. Only
    // `leadStatus` used to be carried across, so deleting a shoot row emptied it from Event Details
    // and left the row's shoot-backed columns showing what had just been removed until a reload.
    // Re-derived through `leadFromRecord`, so every column fed by the details follows the one rule
    // that built it in the first place rather than a list of keys kept in step by hand.
    leadsRef.current = leadsRef.current.map((lead) => (lead.id === id ? leadFromRecord({ lead, details: nextDetails }) : lead));
    setLeads(leadsRef.current);

    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        lead: key === "leadStatus" ? { ...currentLead, leadStatus: value } : currentLead,
        details: nextDetails,
      }),
    })
      .then(() => {
        refreshActivityFor(id);
        confirmSaved(fieldLabelFor(key, board, customFieldsByVertical));
      })
      .catch((error) => showError(error.message || "Unable to update CRM lead details."));
  }

  /**
   * Records one unanswered attempt against a lead.
   *
   * This is the CNA button, wherever it is pressed - the pill on the info panel and the pill
   * in the lead popup both come here. It is deliberately one press, one attempt: the same
   * button can be pressed again for the same lead and the number goes up each time, which is
   * what a run of unanswered calls actually looks like.
   *
   * Six attempts are recorded and shown as "CNA (1)" through "CNA (6)". The seventh gives up
   * and moves the lead to Rejected, after which CNA is closed off for it.
   *
   * Unlike Update, this does not wait for a remark. There is nothing to write down when
   * nobody picked up, and demanding a note per attempt would make a six-press sequence
   * unusable - which is the thing being asked for here.
   */
  async function markLeadCna(target) {
    const id = target?.id;
    if (!id) return;

    const currentDetails = detailsByLeadRef.current[id] || detailsByLead[id] || {};
    const currentLead = leads.find((lead) => lead.id === id) || target;
    const merged = mergeLeadDisplayRecord(currentLead, currentDetails);

    if (cnaExhausted(merged)) {
      showError(`This lead already went unanswered ${MAX_CNA_ATTEMPTS} times and was Rejected.`);
      return;
    }

    const nextSequence = getLeadCnaSequence(merged) + 1;
    const autoRejected = nextSequence > MAX_CNA_ATTEMPTS;
    const nextStatus = autoRejected ? "Rejected" : "CNA";

    // The count goes on both halves. The table reads it off the lead and the popup off the
    // details, and leaving one behind would show two different numbers for the same lead.
    const nextLead = { ...currentLead, ...leadStatusPatch(merged, nextStatus, nextSequence) };
    const nextDetails = { ...currentDetails, ...leadStatusPatch(merged, nextStatus, nextSequence) };

    // Patched in place rather than refetched: the row is already on screen and the change is
    // known, so rebuilding the table would only risk moving the user off the lead they are
    // working. Written to the ref before setState so a quick run of presses each builds on
    // the last rather than on the last rendered snapshot.
    leadsRef.current = leadsRef.current.map((lead) => (lead.id === id ? { ...lead, ...nextLead, id } : lead));
    setLeads(leadsRef.current);
    detailsByLeadRef.current = { ...detailsByLeadRef.current, [id]: nextDetails };
    setDetailsByLead(detailsByLeadRef.current);

    try {
      await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ lead: nextLead, details: nextDetails }),
      });
      setLastSync(new Date());
      setActivityRefreshKey((key) => key + 1);
      // The auto-reject is said out loud. A lead quietly changing to a different status under
      // a button marked CNA is not something to leave unremarked.
      showNotice(
        autoRejected
          ? `${MAX_CNA_ATTEMPTS} CNA attempts reached - this lead is now Rejected.`
          : `Lead marked CNA (attempt ${nextSequence} of ${MAX_CNA_ATTEMPTS}).`,
      );
    } catch (error) {
      showError(error.message || "Unable to record this CNA attempt.");
    }
  }

  /**
   * A remark posted from the popup or the info panel.
   *
   * `post: false` means the caller is about to save this lead itself and only wants the entries in
   * state - see `attemptSave`. The write below sends the lead **as it was last saved**, because that
   * is all this function can see; racing it against an update meant whichever landed second won, and
   * when it was this one the update was silently reverted. So a note committed by an Update is
   * written once, by that update.
   */
  function updateRemarksEntries(id, nextEntries, { post = true } = {}) {
    const normalizedEntries = normalizeRemarkEntries(nextEntries);
    const currentDetails = detailsByLeadRef.current[id] || detailsByLead[id] || {};
    const nextDetails = {
      ...currentDetails,
      remarkEntries: normalizedEntries,
      remarks: remarkSummary(normalizedEntries),
    };
    // Written before setState, the way updateLeadDetails does it. Inside the updater the
    // assignment only lands at the next render, and pressing Update posts the note and saves
    // in the same breath - the save would have read the details as they were a note ago.
    detailsByLeadRef.current = { ...detailsByLeadRef.current, [id]: nextDetails };
    setDetailsByLead((current) => ({ ...current, [id]: nextDetails }));
    // The save about to run carries these entries, so there is nothing left to send.
    if (!post) return;
    const currentLead = leads.find((lead) => lead.id === id) || {};
    void apiRequest(`/api/sales/crm-leads/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        lead: currentLead,
        details: nextDetails,
      }),
    })
      .then(() => {
        refreshActivityFor(id);
        confirmSaved("Remarks");
      })
      .catch((error) => showError(error.message || "Unable to update CRM lead details."));
  }

  /**
   * The info panel's Update and Next.
   *
   * This is the only thing that writes a status chosen here - the pill holds it until now, so
   * a lead is not moved on by a press that was never confirmed. A posted remark still saves
   * itself, being a record of what was said rather than a change to the lead. Then the next
   * row in the table is handed over, so a list can be worked straight down without going back
   * to the table between leads.
   */
  async function updateSelectedLeadAndAdvance() {
    const lead = selectedLeadRecord;
    if (!lead || infoUpdating) return;
    // Same rule as the popup: the update records what happened on this call, so it waits for
    // a remark - but only says so once it has actually been asked to save without one.
    if (!infoRemarkReady) {
      setInfoRemarkErrorLeadId(lead.id);
      return;
    }
    setInfoRemarkErrorLeadId("");
    setInfoUpdating(true);
    try {
      // A note still in the box is posted first, so pressing the button is enough.
      infoRemarkCommitRef.current?.();
      const latestDetails = detailsByLeadRef.current[lead.id] || detailsByLead[lead.id] || {};
      const latestEntries = normalizeRemarkEntries(latestDetails.remarkEntries || latestDetails.remarks);
      // Read before the write rather than from `infoDraftStatus`, which is the render's copy -
      // by the time this runs the pill may have been pressed again.
      const draftStatus = infoStatusDraft.leadId === lead.id ? infoStatusDraft.leadStatus : "";
      const nextStatus = draftStatus || latestDetails.leadStatus || lead.leadStatus || lead.status || "";
      const nextDetails = {
        ...latestDetails,
        remarkEntries: latestEntries,
        remarks: remarkSummary(latestEntries) || latestDetails.remarks || "",
        ...(draftStatus ? leadStatusPatch(lead, draftStatus) : {}),
      };
      await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(lead.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          lead: { ...lead, ...leadStatusPatch(lead, nextStatus) },
          details: nextDetails,
        }),
      });
      detailsByLeadRef.current = { ...detailsByLeadRef.current, [lead.id]: nextDetails };
      setDetailsByLead(detailsByLeadRef.current);
      // The row carried the status the moment the pill was pressed, because pressing it wrote
      // it. Now that the write waits for this button, the table is caught up here instead -
      // through `leadFromRecord`, so every column the details feed follows the one rule that
      // built it rather than a list of keys kept in step by hand.
      leadsRef.current = leadsRef.current.map((row) => (row.id === lead.id
        ? leadFromRecord({ lead: { ...row, ...leadStatusPatch(row, nextStatus) }, details: nextDetails })
        : row));
      setLeads(leadsRef.current);
      clearInfoStatusDraft();
      setLastSync(new Date());
      setActivityRefreshKey((key) => key + 1);

      // The row after this one, wrapping to the first at the end of the list - the same step
      // the popup's Update and Proceed Next takes.
      const visibleIndex = rows.findIndex((row) => row.id === lead.id);
      const nextLead = rows[visibleIndex + 1] || rows[0] || null;
      if (nextLead) selectLead(nextLead.id);
      showSuccess(nextLead && nextLead.id !== lead.id ? "CRM lead updated. Showing the next lead." : "CRM lead updated.");
    } catch (error) {
      showError(error.message || "Unable to update CRM lead.");
    } finally {
      setInfoUpdating(false);
    }
  }

  async function savePopupLead(closeAfter = false, advanceAfter = false, forcedStatus = "", committedEntries = null) {
    if (!leadPopup) return false;
    const missing = missingRequiredLeadFields(leadAsSaved(leadPopup, forcedStatus), { vertical: resolveLeadVertical(leadPopup, leadPopupDetails), popup: true });
    if (missing.length) {
      showError(markedFieldsMessage(missing.length));
      return false;
    }
    try {
      // The saved details with the popup's unsaved edits on top - this is the moment those edits
      // become real, and the only one.
      const latestDetails = { ...(detailsByLeadRef.current[leadPopup.id] || {}), ...popupEdits.details };
      // The note Update just committed, if there was one - handed in rather than read back, for
      // the reason `attemptSave` gives.
      const latestRemarkEntries = normalizeRemarkEntries(committedEntries || latestDetails.remarkEntries || latestDetails.remarks);
      // "CNA and Proceed Next" saves the lead as CNA rather than leaving the status as-is.
      const requestedStatus = forcedStatus || latestDetails.leadStatus || leadPopup.leadStatus || "Interested";
      const currentSequence = getLeadCnaSequence({ ...leadPopup, ...latestDetails });

      /**
       * CNA counts this lead's own unanswered attempts, and the lead gives up at the limit.
       *
       * The number used to be a rank across the CNA leads on screen - the first was 1, the
       * next 2 - which never moved for a lead marked CNA twice, so there was nothing for a
       * "stop after six" rule to count. It is now incremented on the lead itself each time
       * CNA is saved against it, which is also what the "CNA (n)" on its row now means.
       *
       * **Chosen, not merely current.** The pill no longer posts as it is pressed, so this save is
       * the only thing that can count an attempt - and it must, when somebody picks CNA and presses
       * **CNA and Proceed Next**. But `requestedStatus` is CNA for a lead that was *already* CNA and
       * is being saved for some unrelated reason too - a phone number corrected, a remark added -
       * and counting there would raise a lead's attempts every time anybody opened and updated it,
       * walking it to Rejected without a call being made. So the count follows the *decision*: the
       * button that says CNA, or the pill pressed in this popup. `popupEdits` holds only what
       * somebody actually edited here, which is exactly that question.
       */
      const cnaChosenNow = forcedStatus === "CNA"
        || popupEdits.details?.leadStatus === "CNA"
        || popupEdits.lead?.leadStatus === "CNA";
      const isCnaSave = requestedStatus === "CNA" && cnaChosenNow;
      const nextSequence = isCnaSave ? currentSequence + 1 : currentSequence;
      // Strictly greater, so the sixth attempt is recorded and shown as "CNA (6)" and it is
      // the seventh that gives up. `>=` rejected the lead on its sixth press, which meant the
      // sixth count could never appear on a row.
      const autoRejected = isCnaSave && nextSequence > MAX_CNA_ATTEMPTS;
      const nextStatus = autoRejected ? "Rejected" : requestedStatus;
      // The first Event Details row with a location sets the lead's City and State, so
      // the table columns reflect what was entered in the popup.
      const firstLocation = (Array.isArray(latestDetails.shoots) ? latestDetails.shoots : [])
        .map((shoot) => splitDistrictState(shoot?.districtState))
        .find(Boolean);
      const latestLead = {
        ...leadPopup,
        // On both halves, so the table's number and the popup's cannot disagree - and onto the
        // occasion's own fields when the lead has one open.
        ...leadStatusPatch(leadPopup, nextStatus, nextSequence),
        ...(firstLocation ? { city: firstLocation.city, state: firstLocation.state } : {}),
      };
      const latestDetailsPayload = {
        ...latestDetails,
        // The count is kept on a lead rejected at the limit, so its row still says how many
        // attempts it took rather than losing that history the moment it flips.
        ...leadStatusPatch(leadPopup, nextStatus, nextSequence > 0 ? nextSequence : latestDetails.cnaSequence || currentSequence || undefined),
        remarkEntries: latestRemarkEntries,
        remarks: remarkSummary(latestRemarkEntries) || latestDetails.remarks || "",
        // Last, so it wins over whatever the lead arrived carrying - see `leadWorkedTodayPatch`.
        ...leadWorkedTodayPatch(),
      };
      await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(leadPopup.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          lead: latestLead,
          details: latestDetailsPayload,
        }),
      });
      // Patched in place rather than refetched. The row is already on screen and the edit
      // is known, so rebuilding the table would only risk moving the user away from it.
      leadsRef.current = leadsRef.current.map((lead) =>
        lead.id === leadPopup.id ? { ...lead, ...latestLead, id: leadPopup.id } : lead,
      );
      setLeads(leadsRef.current);
      detailsByLeadRef.current = { ...detailsByLeadRef.current, [leadPopup.id]: latestDetailsPayload };
      setDetailsByLead(detailsByLeadRef.current);
      setLastSync(new Date());
      setActivityRefreshKey((key) => key + 1);
      discardPopupDraft();
      if (advanceAfter) {
        const visibleIndex = rows.findIndex((row) => row.id === leadPopup.id);
        const nextLead = rows[visibleIndex + 1] || rows[0] || null;
        openLeadPopup(nextLead?.id || null);
        if (nextLead) selectLead(nextLead.id);
      }
      if (closeAfter || !advanceAfter) {
        setShowLeadPopupId(null);
      }
      // The auto-reject is said out loud. Pressing CNA and being handed the next lead while
      // this one quietly changed to a different status is not something to leave unremarked.
      // What actually happened, rather than which button was pressed: since the pill stopped
      // posting, picking CNA and pressing Update records an attempt too, and saying only "CRM lead
      // updated" would leave the number on the pill looking like it moved by itself.
      showNotice(
        autoRejected
          ? `${MAX_CNA_ATTEMPTS} CNA attempts reached - this lead is now Rejected.`
          : isCnaSave
            ? `Lead marked CNA (attempt ${nextSequence} of ${MAX_CNA_ATTEMPTS}).`
            : "CRM lead updated.",
      );
      /*
       * Marked as converted and written down. Whether it is booked now is the next question, and
       * either answer leaves the lead saying what it was just saved as - see `convertedAsk`.
       *
       * On the status this save **chose**, not on the one the lead happens to hold: read off
       * `requestedStatus` it would have asked again every time somebody saved a remark against a lead
       * that converted weeks ago, which is a dialog in the way of ordinary work. A drafted status is a
       * status somebody picked in this popup - today, a card dropped on one of those two columns - and
       * `forcedStatus` is a button that names one.
       */
      if (opensProjectFor(forcedStatus || popupEdits.details.leadStatus || "")) {
        setConvertedAsk({ id: leadPopup.id, name: leadPopup.name || leadPopup.id, status: requestedStatus });
      }
      return true;
    } catch (error) {
      showError(error.message || "Unable to update CRM lead.");
      // Answered rather than thrown, for the reason the Contacts panel's `save` gives.
      return false;
    }
  }

  /**
   * Hands the lead to Sales Manager to become a project.
   *
   * Nothing about the lead is written here. The status used to be set on this click, which
   * meant a Create Project tab closed without saving left a lead reading Converted with
   * nothing behind it - in the converted counts, and with a Converted row in its own history,
   * for a project that was never created. The lead is now marked Converted by the project
   * save itself, so the two can no longer say different things.
   *
   * Only the id travels in the URL - Sales Manager loads the lead itself, so a copied or
   * reopened link fills the form from current data rather than from whatever was in memory.
   * The CRM stays where it was, so the next lead can be worked on straight away.
   */
  /**
   * Converting from the board: the lead is written here and now, then Create Project opens on it.
   *
   * The same change the Contacts panel's `convert` describes - the decision is recorded when the
   * pill is pressed rather than left to the project's own save, and Create Project opens **in this
   * tab** instead of beside it.
   *
   * Written through `savePopupLead` with the status forced onto it, so a conversion is an update
   * like any other: it carries the remark, the activity entry and the Last Follow-up Date, and
   * there is no second way of writing a converted lead to keep in step with the first.
   */
  async function confirmConvertLead({ openProject }) {
    if (!convertLead?.lead) return;
    const { lead, status } = convertLead;
    const id = lead.id;
    const name = lead.name || id;
    setConvertLead(null);

    /*
     * ── Written to the lead the dialog names, and to no other ───────────────────────────────────
     *
     * This is reached from two places: the lead popup's own status pills, and the info panel beside
     * the table - where the popup is very often **closed**, or open on a different lead entirely.
     *
     * It went through `savePopupLead` at first, which writes whatever `leadPopup` holds. From the
     * info panel that was either nothing at all - the save refused on its own `if (!leadPopup)`
     * guard, so the press did nothing and said nothing - or, with the popup open on another lead,
     * it converted *that* lead while navigating to this one. Neither failure had anything on screen
     * to say it had happened.
     *
     * So the write is done by id, the way `markLeadCna` does it for the same reason: the board can
     * change a lead's status without the popup being involved, and the lead it changes has to be
     * the one that was pressed.
     */
    const currentDetails = detailsByLeadRef.current[id] || detailsByLead[id] || {};
    const currentLead = leads.find((row) => row.id === id) || lead;
    const merged = mergeLeadDisplayRecord(currentLead, currentDetails);
    // The status, and the next follow-up it clears when it is plain Converted - which the server
    // clears as well; this keeps the screen saying the same until the next read.
    const patch = { ...leadStatusPatch(merged, status), ...followUpClearedBy(merged, "leadStatus", status) };
    // Both halves, as every other status write here does: the table reads the status off the lead
    // and the popup off the details, and leaving one behind shows the same lead two ways.
    const nextLead = { ...currentLead, ...patch };
    const nextDetails = { ...currentDetails, ...patch, ...leadWorkedTodayPatch() };

    try {
      await apiRequest(`/api/sales/crm-leads/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ lead: nextLead, details: nextDetails }),
      });
    } catch (error) {
      // Refused: the lead is not converted, so Create Project is not opened for it. Staying put is
      // the point - booking a project against a lead that never converted is the worse outcome.
      showError(error.message || "Unable to convert this lead.");
      return;
    }

    // Patched in place rather than refetched, the way `markLeadCna` does it: the row is on screen
    // and the change is known, and rebuilding the table would move the reader off it.
    leadsRef.current = leadsRef.current.map((row) => (row.id === id ? { ...row, ...nextLead, id } : row));
    setLeads(leadsRef.current);
    detailsByLeadRef.current = { ...detailsByLeadRef.current, [id]: nextDetails };
    setDetailsByLead(detailsByLeadRef.current);
    setLastSync(new Date());
    setActivityRefreshKey((key) => key + 1);
    // The popup is closed only if it was open on this lead - from the info panel there is nothing
    // to close, and closing a popup showing a different lead would be a second surprise.
    if (showLeadPopupId === id) { discardPopupDraft(); setShowLeadPopupId(null); }

    if (openProject) {
      router.push(convertProjectUrl(id, status));
      return;
    }
    showNotice(`${name} is marked ${status}.`);
  }

  function updatePopupShootRow(index, key, value) {
    // Read from what the popup is showing, which already includes anything drafted, so a second
    // edit to the same row builds on the first rather than on what was last saved.
    const liveDetails = leadPopupDetails || {};
    const currentShoots = Array.isArray(liveDetails.shoots) && liveDetails.shoots.length ? liveDetails.shoots : [emptyShootRow()];
    if (key === "remove") {
      const nextShoots = currentShoots.filter((_, shootIndex) => shootIndex !== index);
      draftPopupDetails("shoots", nextShoots.length ? nextShoots : [emptyShootRow()]);
      return;
    }
    if (key === "add") {
      draftPopupDetails("shoots", [...currentShoots, emptyShootRow()]);
      return;
    }
    const nextShoots = [...currentShoots];
    nextShoots[index] = { ...(nextShoots[index] || emptyShootRow()), [key]: value };
    if (key === "shootType" && index === nextShoots.length - 1 && value && nextShoots.length < MAX_SHOOT_ROWS) {
      nextShoots.push(emptyShootRow());
    }
    draftPopupDetails("shoots", nextShoots);
  }

  const headerTabs = getTabsForBoard(board).map((tab) => ({
    ...tab,
    label: `${tab.label} (${Number(serverCounts[tab.id] || 0).toLocaleString()})`,
  }));

  return (
    // `relative` anchors the toast to the foot of the module rather than the viewport.
    <section
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-white text-slate-700"
      /*
       * Right-clicking the page, rather than a row, offers the one thing that applies to the page:
       * Ask Nebula about the module.
       *
       * A row's own menu calls `stopPropagation`, so this never fires for a row - the two menus do
       * not compete. It is also skipped over anything a right click already means something on:
       * a text box has the browser's own cut/copy/paste, and taking that away to offer one item
       * would be a bad trade.
       */
      onContextMenu={(event) => {
        if (event.target.closest?.("input, textarea, select, [contenteditable=\"true\"], [role=\"menu\"], [role=\"dialog\"]")) return;
        event.preventDefault();
        setPageMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <ModulePageHeader
        // The name the sidebar already gives this module. The board called itself "Leads" while the
        // nav that reached it said "Leads & Followups" - one module under two names.
        title="Leads & Followups"
        tabs={headerTabs}
        tabValue={activeTab}
        /*
         * The column filters are cleared with the tab, which is what makes the counts beside the
         * tab labels true.
         *
         * A filter is typed while reading one tab and says nothing about the others, so the strip
         * counts every other tab unfiltered - see `crmLeadTabCounts`. Carried across, a filter
         * would make each of those numbers a promise the tab could not keep: Converted would read
         * 800, and open on the four of them the filter still standing happened to match. Clearing
         * is also what every other tabbed table in the app does, by remounting on `key={activeTab}`
         * - this board keeps its filters server-side and so has to say it out loud.
         */
        onTabChange={(tabId) => {
          setActiveTab(tabId);
          setFilters(NO_FILTERS);
          setAppliedFilters(NO_FILTERS);
          clearSelection();
        }}
        tabsAriaLabel="CRM lead filters"
        titleAddon={(
          <div className="flex items-center gap-3">
            <Dropdown
              mode="switch"
              // "Board" rather than "branch": three of the four are verticals and the fourth is
              // the queue of calls that belong to none of them yet.
              ariaLabel="CRM board"
              value={board}
              onChange={(value) => {
                setBoard(value);
                clearSelection();
                /*
                 * Newborns has no meaning on Corp, Yesterday Pending none on Qua Qua, and none of
                 * the lead tabs mean anything on Calls - so a tab the new board does not have falls
                 * back to the first tab that board opens with, which on all four is All.
                 */
                const nextTabs = getTabsForBoard(value);
                /*
                 * Written every time rather than only when the tab has to move, because the
                 * remembered tab is now read against the board on screen: leaving a tab the old
                 * board had standing in storage would have it reappear the moment a board that
                 * shares its id came up. Switching from Dum Dum on All to Calls would land on
                 * Incoming - a tab nobody chose on the board they were leaving.
                 */
                setActiveTab(nextTabs.some((tab) => tab.id === activeTab) ? activeTab : (nextTabs[0]?.id || "all"));
                /*
                 * And every column filter goes with the board.
                 *
                 * It used to keep any filter whose column the new board also had, on the argument
                 * that only a *stale* filter is dangerous - the two boards share column ids on
                 * purpose, so an Enquiry ID typed on Calls would go on narrowing Dum Dum. That
                 * argument was right about the danger and wrong about the remedy: a filter carried
                 * onto a board nobody set it on is a board that opens already narrowed, by a value
                 * chosen against different rows, and the reader has to notice the box to explain the
                 * count. Clearing is what changing the tab already does, and a board is the larger
                 * move of the two.
                 *
                 * `appliedFilters` as well as `filters`: the applied set is what the load reads, and
                 * clearing only the boxes would leave the board narrowed by a filter now shown
                 * nowhere - which is the silent half of the very fault this used to guard against.
                 */
                setFilters(NO_FILTERS);
                setAppliedFilters(NO_FILTERS);
              }}
              options={boardOptions}
              /*
               * In the order `boardOptions` holds them - Dum Dum, Qua Qua, Corp, Call Box - rather
               * than alphabetised, which is this component's default and was wrong here.
               *
               * Sorted, the switch read Call Box, Corp, Dum Dum, Qua Qua: the queue that feeds the
               * three verticals sat above all of them, and the vertical most of the studio works
               * every day was third. The studio's own order is the list's meaning, which is exactly
               * the case `sorted={false}` exists for.
               */
              sorted={false}
              placeholder="Select"
              // Fixed width so switching to a shorter board name does not resize the
              // control and shift everything beside it in the header.
              className="w-[8.5rem] shrink-0 border-l border-slate-200 pl-3"
            />
          </div>
        )}
        /*
         * The date range, immediately left of the Nebula icon.
         *
         * Ahead of Nebula rather than among the actions after it, because everything from Nebula
         * rightwards *does* something - asks a question, imports a file, adds a lead - and this
         * only changes what is being looked at. It is drawn only where it means something: on the
         * Call Box that is the All tab alone, and on the three verticals every tab but the three
         * that are already a date. See `showsDateRange`.
         */
        leadingActions={(
          <div className="flex items-center gap-3">
            {rangeApplies && (
              <DateRangeSwitch
                ariaLabel="Date range"
                value={dateRange}
                onChange={setDateRange}
                custom={customRange}
                onCustomChange={setCustomRange}
              />
            )}
            {/*
              * Whose leads, in the same run as the date range and for the same reason: everything
              * from Nebula rightwards *does* something, and these two only change what is being
              * looked at. After the range and immediately left of the Nebula logo, which is where
              * the studio asked for it.
              *
              * On, the board is only the leads assigned to this reader or created by them; off, it
              * is everything they may see. A narrowing and never a widening - the server ANDs it
              * with the data scope that already decided what they may see at all - so it is offered
              * to everybody, and it is the only way somebody who sees the whole studio can ask for
              * their own queue.
              *
              * On screen rather than in the ⋮ menu beside Compact view: this changes what data is
              * on the board and what every tab count says, and a filter doing that from inside a
              * menu is a board that reads as wrong for no stated reason.
              */}
            {/* Not on the Call Box: that board is answered from the call log by `callBoardService`,
                which takes no `mine` at all, so the switch would be a control that changes nothing -
                the exact thing drawing it only for managers is meant to avoid. */}
            {/*
              Table or Board, beside My Leads because both answer "what am I looking at" rather than
              doing something to it.

              Not on the Calls board: that one is answered from the call log by `callBoardService` and
              its rows are calls, which have three outcomes rather than a lead's statuses - there are no
              columns to stand them in.
            */}
            {/* A dropdown like the board switch beside it, rather than a pair of tabs. */}
            {board !== CALLS_BOARD && <Dropdown
              mode="switch"
              ariaLabel="How the leads are shown"
              value={view}
              onChange={(next) => {
                setView(next);
                // The rows on screen are about to be a different set, so a selection made against the
                // old one is dropped - the same thing switching board and tab already do.
                clearSelection();
              }}
              options={VIEW_OPTIONS}
              searchable={false}
              sorted={false}
              placeholder="Select"
              // Fixed width, so switching between the two does not shift the header beside it.
              className="w-[6.5rem] shrink-0"
            />}
            {managesAnyone && board !== CALLS_BOARD && <ToggleSwitch
              label="My Leads"
              ariaLabel="Show only my own leads, or all of them"
              title={mineOnly
                ? "Showing only leads assigned to you or created by you. Turn off to see everything you have access to."
                : "Showing every lead you have access to. Turn on to see only leads assigned to you or created by you."}
              checked={mineOnly}
              onCheckedChange={(next) => {
                setMineOnly(next);
                // The rows are about to be a different set, so a selection made against the old one
                // is dropped - the same thing switching board and tab already do.
                clearSelection();
              }}
            />}
          </div>
        )}
        actions={(
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                // Cleared first so the previous file's verdict cannot be shown against the
                // new one for the moment the header check takes.
                setImportValidation(null);
                setImportFile(event.target.files?.[0] || null);
                event.target.value = "";
              }}
              className="sr-only"
            />
            {/* One action on a selection. Status, follow-up date and CRM assignment are all
                fields of Update Details, so a selection never offers two competing buttons.

                Not on Calls, where a selection is a set of calls. Every field Update Details writes
                belongs to a lead - a status, a follow-up date, the CRM it is assigned to - and a
                call has none of them; the ids there are Call IDs, which name no lead to write to.
                A call is worked by opening it, which is what the Add Lead button below is. */}
            {/* `canSelectLeads` as well as the count, though a role without it can hold no
                selection to begin with: the two buttons below are the only way to reach the bulk
                routes, and both are guarded by that same permission on the server. */}
            {!canWrite ? null : canSelectLeads && selectedCount > 0 && board !== CALLS_BOARD ? (
              <>
                {/* Left of Update Details, and only for a role holding SALES / CRM Lead Deletion.
                    Absent rather than disabled for everybody else - a control a role may not use is
                    not shown at all, and the DELETE route is what actually refuses it.

                    Kept beside Update Details rather than in the ⋮: both act on the same selection,
                    and an action on the ticked rows hidden behind a menu is one a reader has to go
                    looking for. Red and second, so the destructive one is never the button the eye
                    lands on first. It is not offered on the Calls board for the same reason Update
                    Details is not - those ids are Call IDs and name no lead. */}
                {canDeleteLeads && (
                  <Button variant="danger" onClick={() => setPendingBulkDelete(true)}>
                    Delete ({selectedCount.toLocaleString()})
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => {
                    setBulkUpdateLeadStatus("");
                    setBulkUpdateVertical("");
                    setBulkUpdateLastUpdatedDate("");
                    setBulkUpdateNextFollowUpDate("");
                    setBulkUpdateCrms([]);
                    setShowBulkUpdateDialog(true);
                  }}
                >
                  Update Details ({selectedCount.toLocaleString()})
                </Button>
              </>
            ) : (
              /*
               * Add Lead opens on the board being read.
               *
               * Somebody working Qua Qua who presses this is adding a Qua Qua lead; the form used to
               * open on Dum Dum whatever board it was opened from, so every lead added from the other
               * two verticals needed the radio moved first - and one nobody moved was filed in the
               * wrong vertical, under the wrong enquiry id, on a board its owner never looks at.
               *
               * Not on the Call Box, which has no vertical to lend: that board is the queue of
               * callers nobody has placed, and which of the three they belong to is the one question
               * it exists to ask. `normalizeVertical` answers "" for anything that is not one of the
               * three, so the form keeps the Dum Dum it opens with there.
               *
               * Through `leadFormForVertical`, the same rule the Vertical radio uses, so the status
               * and that vertical's own Table Settings fields come with it. The line here used to
               * read `customFieldsByVertical[current.board]` - `current` is the form, which has a
               * `vertical` and has never had a `board` - so it was seeding the defaults of a vertical
               * named `undefined`, which is to say seeding nothing at all.
               */
              <Button variant="primary" onClick={() => {
                setAssigningCallId("");
                setAddLeadForm((current) => {
                  const next = leadFormForVertical(current, normalizeVertical(board) || current.vertical, customFieldsByVertical);
                  /*
                   * Today's date, if this form is not already carrying one.
                   *
                   * `emptyLeadForm` stamps it, but that is read when the *page* is built - a board
                   * left open overnight would offer yesterday. Filled rather than overwritten, so a
                   * date cleared by marking the lead Rejected stays cleared: that is an answer
                   * somebody gave in this sitting, not a blank for the button to fill in. Closing
                   * empties the form now, so there is no older sitting for it to inherit from.
                   */
                  const dated = next.nextFollowUpDate ? next : { ...next, nextFollowUpDate: getLocalDateKey() };
                  /*
                   * The Enquiry Date, on the other hand, is overwritten every time the form opens.
                   *
                   * It is not a field any more - the studio does not want to be asked for it - so
                   * nothing on screen can correct a stale one, and the two ways it goes stale are
                   * both ordinary: `emptyLeadForm` stamps it when the *page* is built, so a board
                   * left open overnight would file this morning's lead under yesterday, and a draft
                   * kept from a previous Add Lead carries whatever day that was. A lead typed in
                   * now is today's enquiry, and Today New Leads reads exactly this.
                   */
                  return { ...dated, createdDate: getLocalDateKey() };
                });
                setShowAddLead(true);
              }}>Add Lead</Button>
            )}
          </>
        )}
        /* The ⋮ ends the row, in the header's own trailing slot, so every page's header ends the
           same way: the page's buttons, then Nebula, then this. */
        menu={<>
          {canWrite && <OptionsMenu
            ariaLabel="More CRM actions"
            // The component's own quiet trigger: no border, so the icon reads as an icon rather
            // than as a second button competing with Add Lead beside it.
            menuClassName="w-44"
            /*
             * The two ways in that are not Add Lead, and nothing else.
             *
             * **Import** is a CSV, and it is the right answer for a file somebody already has -
             * an export from an ad platform, a list a planner sent over. It takes the vertical's
             * whole template, one table at a time. It asks for `SALES / CRM Lead Import` on top of
             * the board's own Read / Write and is absent without it, because a file lands as many
             * leads as it has rows, from a source the studio did not type and cannot proof-read.
             *
             * **Bulk Entry** is the other half of that: names being typed, several at a sitting -
             * a day off one event, one campaign, one call with a planner. It asks the few fields
             * that make a lead findable and assignable rather than the template's thirty. Between
             * them there is no batch that has to be added one lead at a time through Add Lead. It
             * needs no permission beyond the board's: typing five leads is adding five leads, and
             * it is what is left for a role that may not import a file.
             *
             * Settings used to sit here as a shortcut into the application's own Settings. It is
             * gone from every module's ⋮ now: Settings is one screen reached from the header, and
             * a per-module doorway into it made the same rail look like it belonged to whichever
             * board it was opened from.
             */
            items={[
              ...(canImportLeads ? [{ label: "Import", onSelect: openImportDialog }] : []),
              { label: "Bulk Entry", onSelect: () => setShowBulkImport(true) },
            ]}
          />}
        </>}
      />

      {/* The same snackbar Sales Manager and the rest of the app use - one dark bar at the foot
          of the window, portalled, so it neither pushes the table down nor looks like a message
          of a different kind depending on which CRM screen said it. */}
      <FloatingNotice notice={notice} onClose={clearNotice} />

      <div className="min-h-0 flex-1 px-0">
        <DataTableShell className="h-full min-h-[30rem]" footer={<TableFooter contentClassName="w-full !justify-between">{/* "Last sync", and to the minute. The board is re-read on a timer and after every write, so
              this is the answer to "is what I am looking at current?" - and a date alone answered it
              with "today", which is true of every sync the reader will ever see. `formatDateTime`
              renders its own em dash before the first load lands. */}
          {/*
            The footer describes the **table**, so on the board it says nothing rather than something
            untrue. "Showing 100 of 4,312" counts rows the board is not drawing, and "Last sync" is the
            table's own read - the board's columns fetch themselves and each says its own total in its
            heading, which is the honest place for a count here.
          */}
          <span>{view === "table" ? `Last sync: ${formatDateTime(lastSync)}` : ""}</span><span>{view !== "table" ? "" : loadingMore ? "Loading more..." : `Showing ${rows.length.toLocaleString()} of ${totalRows.toLocaleString()}`}</span></TableFooter>}>
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/*
              The board, in the table's place.

              Inside the same shell so the header, the tabs, the filters and the footer are the one set
              of controls whichever view is on - switching view changes how the leads are drawn and
              nothing about which leads they are.
            */}
            {view === "board" ? <CrmKanbanBoard
              /* The board **is** the vertical here - "Dum Dum", "Qua Qua" - so Converted & Followup is a
                 column on the one vertical that has it and nowhere else, exactly as it is on the pills
                 inside the lead popup. See `boardColumns` for why Yet to connect leads them. */
              columns={pipelineColumns}
              fetchColumn={fetchLeadColumn}
              /* Bumped by any write - see `markLeadsChanged`. Said as a prop rather than smuggled into
                 the fetcher's dependency list, where it would be a value the callback never reads. */
              refreshKey={leadsChangedAt}
              /* So an empty column can say whether a filter emptied it. */
              filtered={Object.values(appliedFilters || {}).some(Boolean)}
              onOpenLead={openBoardLead}
              /* The card's ⋮ is the row's ⋮. */
              leadActions={boardLeadActions}
              /* A drop opens the lead with the status drafted - see `openLeadAtStatus`. The board asks
                 which columns will take one, because the answer is the page's to give. */
              canDropAt={canDropAt}
              onDropLead={openLeadAtStatus}
            /> : <DataTable
              tableId={getCrmTableId(board)}
              ariaLabel={`CRM ${boardLabel} table`}
              // The key the board's own arrangement was always kept under, so nothing anybody
              // arranged is lost by the move.
              columnOrderKey={`CRM ${board}`}
              columns={leadTableColumns}
              data={rows}
              getRowId={leadRowId}
              loading={loading}
              loadingMessage="Loading CRM leads..."
              emptyMessage={Object.values(appliedFilters).some(Boolean) ? "No CRM leads matched the selected filters." : "CRM leads will appear here."}
              selectedRowId={selectedLeadId}
              onRowClick={activateLeadRow}
              onRowDoubleClick={openLeadRow}
              onRowContextMenu={openLeadRowMenu}
              // The tint this board's rows have always taken under the pointer.
              rowHoverClassName="hover:bg-blue-50"
              renderActions={renderLeadActions}
              scrollerRef={tableScrollRef}
              defaultColumnVisibility={defaultColumnVisibility}
              features={{
                // Columns sized to their contents until one is pulled, which is how this board
                // has always been drawn - see `autoLayout` in `DataTable`.
                layout: "auto",
                filtering: true,
                // The page holds the filters and asks its server; the table draws the boxes.
                filters: tableFilters,
                onColumnFilters: applyColumnFilters,
                filterValues: leadFilterValues,
                // The server's own sort, reported in the board's shape.
                sorting: { sort, onChange: setSort },
                /*
                 * The whole column - this box, the blank below it in the filter row, and every
                 * row's own - belongs to `SALES / CRM Lead Select All`. Absent rather than disabled
                 * for a role without it: a tick box that cannot be ticked says the board is broken,
                 * where no column says this reader works a lead at a time.
                 *
                 * `publish: false`: the board draws its own actions over a selection - Update
                 * Details - in the header, and the header would replace those with the table's
                 * Export / Clear the moment a row was ticked.
                 */
                selection: canSelectLeads ? {
                  model: selectionModel,
                  width: SELECT_COLUMN_WIDTH,
                  rowLabel: leadRowLabel,
                  headerLabel: selectionHeaderLabel,
                  publish: false,
                } : undefined,
                infiniteScroll: { onEndReached: loadMoreLeads },
                csvExport: { enabled: true, onExport: exportLeadsCsv },
              }}
            />}
            <DataTableInfoPanel
              title="Info"
              entity={selectedLead}
              state={infoState}
              onToggle={() => setInfoState((current) => current === "expanded" ? "collapsed" : "expanded")}
              emptyText="Select a CRM lead row to view details."
              /* The tabs are the panel's header band. A heading above them would only say
                 "Info" over a tab already called Info, and it cost the panel a row of
                 height. The strip pads to px-3 with the buttons themselves unpadded, so the
                 first tab starts on the same left edge as the field labels below it and the
                 active underline sits under the label rather than a wider button box. */
              header={selectedLead ? (
                <div className="flex shrink-0 items-center gap-5 border-b border-slate-200 px-3">
                  {infoPanelTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setInfoPanelTab(tab.id)}
                      className={`shrink-0 border-b-2 py-2.5 text-[15px] font-medium transition ${
                        infoPanelTab === tab.id
                          ? "border-blue-600 text-blue-700"
                          : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              ) : null}
            >
              {selectedLead && (
                <div className="flex h-full min-h-0 flex-1 flex-col text-sm">
                  {/* `showingCall` as well as the tab: the tab is state on the page rather than on
                      the row, so a lead read on Remarks & Status and then a call clicked would open
                      that call on a tab it does not have. */}
                  {infoPanelTab === "remarks" && !showingCall ? (
                    <div className="space-y-4">
                    <div>
                      <span className="block text-xs font-semibold text-slate-600">Lead Status<HelpTip text="Pick where this lead stands after the latest follow-up." /></span>
                      <LeadStatusPills
                        // The held status wins while there is one, so the pill shows what
                        // Update and Next is about to write rather than what the row still says.
                        value={infoDraftStatus || selectedLead.leadStatus || selectedLead.status || ""}
                        // Converting is the same act wherever it is started from: it asks
                        // first, then hands the lead to Sales Manager. Only the popup was
                        // wired for it, so the same pill here just set a status and stopped.
                        //
                        // CNA is the same story: it counts an attempt rather than setting a
                        // status, so pressing it here goes to the same place the popup's does
                        // and the number goes up each press.
                        //
                        // Both keep saving as they are pressed, and both drop anything held:
                        // they have just decided this lead's status themselves, and writing a
                        // held one over it at Update and Next would undo what they did.
                        onChange={(value) => {
                          if (opensProjectFor(value)) {
                            clearInfoStatusDraft();
                            setConvertLead({ lead: selectedLead, status: value });
                            return;
                          }
                          if (value === "CNA") {
                            clearInfoStatusDraft();
                            void markLeadCna(selectedLead);
                            return;
                          }
                          setInfoStatusDraft({ leadId: selectedLead.id, leadStatus: value });
                        }}
                        options={leadStatusOptionsForVertical(resolveLeadVertical(selectedLead))}
                        className="mt-1.5"
                        counts={{ CNA: getLeadCnaSequence(selectedLead) }}
                        // The whole row locks, as it does in the popup.
                        disabledValues={cnaExhausted(selectedLead) ? leadStatusOptionsForVertical(resolveLeadVertical(selectedLead)).map((option) => option.value) : []}
                        disabledTitle={`This lead went unanswered ${MAX_CNA_ATTEMPTS} times and was Rejected.`}
                      />
                    </div>
                      {/* The same composer the lead popup uses, so remarks written in either
                          place look and behave identically - minus its send button, which
                          Update and Next below stands in for. */}
                      <NotesComposer
                      onUploadAttachment={uploadRemarkAttachment}
                      onFetchAttachment={fetchRemarkAttachment}
                        key={selectedLead.id}
                        entries={leadRemarkEntries(selectedLead.remarkEntries, selectedLead.remarks)}
                        showSendButton={false}
                        commitRef={infoRemarkCommitRef}
                        onPendingChange={(pending) => setInfoRemark((current) => ({ ...current, leadId: selectedLead.id, pending }))}
                        onEntriesChange={(nextEntries) => {
                          const before = leadRemarkEntries(selectedLead.remarkEntries, selectedLead.remarks).length;
                          if (nextEntries.length > before) {
                            setInfoRemark((current) => ({ ...current, leadId: selectedLead.id, added: true }));
                          }
                          updateRemarksEntries(selectedLead.id, nextEntries);
                        }}
                        attachments={selectedLead.attachments || []}
                        onAttachmentsChange={(value) => updateLeadDetails(selectedLead.id, "attachments", value)}
                        enquiryId={selectedLead.id}
                        className="w-full"
                      />
                      {/* Under the notes, where the thing being asked for is, and only after
                          an update has been turned away for want of one. */}
                      {infoRemarkErrorLeadId === selectedLead.id && !infoRemarkReady && (
                        <p role="alert" className="mt-2 text-xs font-medium text-rose-600">
                          Add a remark before updating this lead.
                        </p>
                      )}
                      {/* The panel's own update, in the module's primary button. It stays
                          live and answers when pressed, rather than sitting greyed out with
                          no way to find out why. */}
                      <div className="flex flex-col items-end gap-2">
                        <Button
                          variant="primary"
                          onClick={() => void updateSelectedLeadAndAdvance()}
                          disabled={infoUpdating}
                        >
                          {infoUpdating ? "Updating..." : "Update and Next"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                        {/* Label over value with nothing between rows - the same shape the
                            Employee Repository panel uses. The rules and the padding they
                            needed turned a list of short values into a very long scroll. */}
                        <dl className="space-y-2.5 pb-2">
                          {/* A call reads with the Calls board's fields. `selectedLead.vertical` has
                              already answered Dum Dum for it, and the wedding board's groom and
                              bride are not questions anybody has asked of this caller.

                              Asked of `callRow` rather than `unassignedCall`: a call whose caller
                              has since been added is still a call, and reading it under Dum Dum's
                              columns is what put "Enquiry ID" over its row key and "Verticals: Dum
                              Dum" over a row that has no vertical at all. */}
                          {getInfoFieldsForBoard(selectedLead.callRow ? CALLS_BOARD : selectedLead.vertical, customFieldsByVertical).map((field) => (
                            <div key={field.key}>
                              <dt className="flex items-center text-sm font-semibold text-slate-700">{field.label}<HelpTip text={detailHelpFor(selectedLead.callRow ? "Call" : "Lead", field.key)} /></dt>
                              <dd className="mt-0.5 break-words text-sm leading-6 text-slate-600">
                                {getLeadCellValue(selectedLead, field.key)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                  )}

                </div>
              )}
            </DataTableInfoPanel>
          </div>
        </DataTableShell>
      </div>
      {/*
        * Import Leads: several clients at once, each on its own vertical.
        *
        * The roster it offers under Assign To is the board's own `crmChoices` - the Sales
        * department's active employees, and only those - so a lead can be assigned here to exactly
        * who it could be assigned to anywhere else.
        *
        * One request writes the batch, and the board is re-read from it rather than from a guess:
        * the server mints each Enquiry ID from that record's own vertical and branch, so what was
        * created is only knowable by asking.
        */}
      {showBulkImport && <BulkImportLeadsDialog
        /*
         * Opened on the board being read, exactly as Add Lead is: standing on Qua Qua and typing a
         * batch gives Qua Qua leads without a press. `normalizeVertical` answers "" for the Call Box,
         * which has no vertical to lend, and the dialog falls back to Dum Dum there.
         */
        defaultVertical={normalizeVertical(board) || "Dum Dum"}
        crmOptions={crmChoices}
        onClose={() => setShowBulkImport(false)}
        onImport={async (records) => {
          try {
            const saved = await apiRequest("/api/sales/crm-leads/bulk", { method: "POST", body: JSON.stringify({ records }) });
            const created = Array.isArray(saved?.data) ? saved.data : [];
            setShowBulkImport(false);
            await loadLeads();
            /*
             * Named by vertical rather than as one number. A batch typed from one conversation is
             * usually of more than one kind, and each lands on a board the reader is not looking at
             * - "6 clients added" says nothing about where any of them went.
             */
            const byVertical = created.reduce((counts, record) => {
              const vertical = record?.lead?.vertical || "Dum Dum";
              return { ...counts, [vertical]: (counts[vertical] || 0) + 1 };
            }, {});
            const summary = Object.entries(byVertical).map(([vertical, count]) => `${count} to ${vertical}`).join(", ");
            showSuccess(created.length
              ? `${created.length} client${created.length === 1 ? "" : "s"} added — ${summary}.`
              : "Nothing to add.");
          } catch (error) {
            /*
             * A refused batch names its rows here and, through the rethrow below, on the rows
             * themselves. The message alone leaves somebody counting down a grid to find which of
             * twenty lines was the problem, which is the whole of the work.
             */
            const clashes = Array.isArray(error?.data?.errors) ? error.data.errors : [];
            const rows = clashes.map((entry) => entry?.row).filter(Boolean);
            showError(rows.length
              ? `${error.message} Row${rows.length === 1 ? "" : "s"} ${rows.join(", ")}.`
              : error.message || "Unable to add these clients.");
            // Rethrown so the dialog - which stays open precisely so the batch can be corrected -
            // can mark the offending rows. It reports nothing itself; this line is the message.
            throw error;
          }
        }}
      />}
      {/* Stepped aside while its vertical move is confirmed: this dialog sits above every confirm layer,
          and its values live in this page's state, so Go back finds it exactly as it was left. */}
      {showBulkUpdateDialog && !confirmVerticalMove && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowBulkUpdateDialog(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-update-title"
            className="w-full max-w-[640px] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
          >
            <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
              <h2 id="crm-update-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800 sm:text-[20px]">
                Update Details
              </h2>
              <CloseButton onClick={() => setShowBulkUpdateDialog(false)} ariaLabel="Close update details dialog" />
            </header>

            {/* Every field is a shared module control at its own default size, so the three
                sit on one baseline with matching label, height and corner radius rather than
                each carrying its own overrides. */}
            <div className="px-5 py-5 sm:px-6 sm:py-6">
              <p className="text-sm text-slate-600">
                Update {selectedCount.toLocaleString()} selected lead{selectedCount === 1 ? "" : "s"}. Fields left blank are left unchanged.
              </p>
              {/* Two per row rather than three: the fourth field would otherwise sit alone on a
                  second row, and four controls across a 640px dialog leave no date readable. */}
              <div className="mt-5 grid items-start gap-4 sm:grid-cols-2">
                {/* Moving the selection to another vertical. Its statuses then follow the vertical
                    chosen, and a status that vertical does not have is let go. */}
                <Dropdown
                  mode="input"
                  ariaLabel="Bulk vertical"
                  label="Vertical"
                  helperText="Moves every selected lead to this vertical; blank keeps them here."
                  placeholder={`Keep on ${board}`}
                  clearable
                  clearLabel={`Keep on ${board}`}
                  value={bulkUpdateVertical}
                  onChange={(value) => {
                    const next = value || "";
                    setBulkUpdateVertical(next);
                    const offered = leadStatusOptionsForVertical(next || board).map((option) => option.value);
                    if (bulkUpdateLeadStatus && !offered.includes(bulkUpdateLeadStatus)) setBulkUpdateLeadStatus("");
                  }}
                  options={MOVE_TARGETS.filter((target) => target !== board).map((target) => ({ label: target, value: target }))}
                />
                <Dropdown
                  mode="input"
                  ariaLabel="Bulk lead status"
                  label="Lead Status"
                  helperText="The status every selected lead is set to; blank leaves it."
                  placeholder="Select status"
                  value={bulkUpdateLeadStatus}
                  onChange={(value) => {
                    setBulkUpdateLeadStatus(value);
                    // Invalid and Rejected end the conversation, so neither date applies - and a
                    // date typed before the status was chosen must not be left behind to be sent.
                    if (STATUSES_WITHOUT_FOLLOW_UP.includes(value)) {
                      setBulkUpdateLastUpdatedDate("");
                      setBulkUpdateNextFollowUpDate("");
                    }
                    // Converted has no next call, and today is its last follow-up unless changed.
                    if (value === "Converted") {
                      setBulkUpdateLastUpdatedDate((current) => current || getLocalDateKey());
                      if (dropsNextFollowUp(value, bulkUpdateVertical || board)) setBulkUpdateNextFollowUpDate("");
                    }
                  }}
                  options={leadStatusOptionsForVertical(bulkUpdateVertical || board).map((option) => ({ label: option.value, value: option.value }))}
                />
                <DateField
                  label="Last Updated Date"
                  helperText="The day these leads were last followed up."
                  value={bulkUpdateLastUpdatedDate}
                  disabled={STATUSES_WITHOUT_FOLLOW_UP.includes(bulkUpdateLeadStatus)}
                  onChange={(value) => setBulkUpdateLastUpdatedDate(value)}
                />
                <DateField
                  label="Next Follow-up Date"
                  helperText="The day these leads are next due a call."
                  value={bulkUpdateNextFollowUpDate}
                  disabled={dropsNextFollowUp(bulkUpdateLeadStatus, bulkUpdateVertical || board)}
                  onChange={(value) => setBulkUpdateNextFollowUpDate(value)}
                />
                {/* The same multi-select every other several-answer field uses - Manage Users on a
                    role included - with its search, Select all and Clear. Ticking more than one
                    CRM shares the leads out between them in turn; the table below previews it. */}
                <MultiSelectField
                  label="CRM"
                  helperText="Pick several to share the selected leads out between them in turn."
                  searchable
                  placeholder="Select CRMs"
                  options={crmChoices}
                  values={bulkUpdateCrms}
                  onChange={setBulkUpdateCrms}
                />
              </div>
              {/* One note for both dates rather than the same sentence under each of two fields
                  standing side by side: what disables them is the status, not either field. */}
              {STATUSES_WITHOUT_FOLLOW_UP.includes(bulkUpdateLeadStatus) && (
                <p className="mt-2 text-xs font-normal text-slate-500">
                  Follow-up dates are not set for {bulkUpdateLeadStatus} leads.
                </p>
              )}
              {bulkUpdateLeadStatus === "Converted" && (
                <p className="mt-2 text-xs font-normal text-slate-500">
                  {dropsNextFollowUp(bulkUpdateLeadStatus, bulkUpdateVertical || board) ? "Converted leads have no next follow-up. " : ""}Last Updated Date is set to today unless you change it.
                </p>
              )}
              {/* Said before the press, and asked again after it: what a move clears cannot be got back. */}
              {bulkUpdateVertical && (
                // The dialog's own note, as its follow-up notes above are - in amber, being a warning.
                <p role="alert" className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-normal text-amber-800 sm:text-sm">
                  Moving to {bulkUpdateVertical} permanently clears what only {board} asks - {VERTICAL_MOVE_CLEARS[board]} - and {board}&apos;s custom fields. A lead whose number is already an enquiry in {bulkUpdateVertical} stays on {board}.
                </p>
              )}
              {/* The split is shown before it is committed, not reported after: sharing
                  leads out is not reversible from this screen, so the exact number each CRM
                  is about to receive has to be readable while there is still a Cancel. */}
              {bulkUpdateCrms.length > 0 && (
                <SimpleTable
                  variant="card"
                  classNames={{ wrapper: "mt-5 !overflow-hidden !rounded-lg", table: "text-sm", th: "!whitespace-normal", body: "!divide-y-0", row: "border-t border-slate-200 text-slate-700", td: "!px-4 !py-2.5 !text-sm" }}
                  columns={[
                    { key: "crm", label: "Leads Assigned to Employee", render: (row) => row.crm },
                    { key: "count", label: "No of Lead(s)", headerClassName: "w-32 border-l", cellClassName: "border-l border-slate-200 tabular-nums", render: (row) => row.count.toLocaleString() },
                  ]}
                  rows={bulkUpdateSplit}
                  rowKey={(row) => row.crm}
                />
              )}
            </div>

            {/* Module buttons at their own size. The 14px radius and 13px semibold text they
                carried are not used by any other button in the CRM. */}
            <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4 sm:px-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowBulkUpdateDialog(false)}
                disabled={bulkUpdating}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                // A move asks once more before it runs; anything else saves straight away.
                onClick={() => (bulkUpdateVertical ? setConfirmVerticalMove(true) : void applyBulkUpdateDetails())}
                disabled={bulkUpdating
                  || (!bulkUpdateLeadStatus && !bulkUpdateLastUpdatedDate && !bulkUpdateNextFollowUpDate && !bulkUpdateCrms.length && !bulkUpdateVertical)}
              >
                {bulkUpdating ? "Updating..." : "Update"}
              </Button>
            </footer>
          </section>
        </div>
      )}
      <ConfirmDialog
        open={confirmVerticalMove}
        title={`Move ${selectedCount.toLocaleString()} lead${selectedCount === 1 ? "" : "s"} to ${bulkUpdateVertical}?`}
        message={`Data may be lost. Moving from ${board} permanently clears ${VERTICAL_MOVE_CLEARS[board] || "what only that vertical asks"}, and ${board}'s custom fields - it cannot be undone by moving them back. Leads whose number is already an enquiry in ${bulkUpdateVertical} stay where they are.`}
        confirmLabel={`Move to ${bulkUpdateVertical}`}
        cancelLabel="Go back"
        tone="danger"
        onCancel={() => setConfirmVerticalMove(false)}
        onConfirm={() => { setConfirmVerticalMove(false); void applyBulkUpdateDetails(); }}
      />
      {meetingsLeadId && (
        <MeetingsDialog
          lead={leads.find((item) => item.id === meetingsLeadId) || { id: meetingsLeadId }}
          onClose={() => setMeetingsLeadId("")}
          onNotice={showNotice}
        />
      )}
      {/*
        * The row's right-click menu, at the pointer.
        *
        * The same three actions as the row's ⋮ menu, in the same order, plus the one thing a right
        * click is well placed to offer: asking about the lead under the pointer without opening it.
        * Ask Nebula is separated from the rest because it is the only item that changes nothing.
        */}
      {rowMenu && (
        <ContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          ariaLabel={`Actions for ${rowMenu.lead.name || rowMenu.lead.id}`}
          onClose={() => setRowMenu(null)}
          /*
           * A call offers the one thing a call can do: be opened.
           *
           * It goes through `openLead` rather than straight to the popup, because on this board that
           * is the Add Lead form - or the lead the caller has since been added as. The other three
           * all read or write a lead named by the row's id, and a call's id is a Call ID: Meetings
           * would book against a lead that is not there, Delete would delete nothing while saying it
           * had, and Ask Nebula builds its answer from a lead's own history and would have none.
           */
          items={rowMenu.lead.callRow ? [
            { label: "Add Lead", onSelect: () => openLead(rowMenu.lead.id) },
          ] : [
            { label: "Edit", onSelect: () => openLeadPopup(rowMenu.lead.id) },
            { label: "Meetings", onSelect: () => setMeetingsLeadId(rowMenu.lead.id) },
            { separator: true },
            { label: "Ask Nebula", onSelect: () => setAskingAboutLead(rowMenu.lead) },
            // On the deletion permission, like the row menu's own Delete. This menu used to offer it
            // to anybody who could open the board at all - not even to `canWrite` - so a read-only
            // reader was one right-click away from a request the server had to be the one to refuse.
            ...(canDeleteLeads ? [
              { separator: true },
              { label: "Delete", tone: "danger", onSelect: () => setPendingDeleteLead(rowMenu.lead) },
            ] : []),
          ]}
        />
      )}

      {/*
        * The page's right-click menu: one item, because there is one thing that applies to a page
        * rather than to a row. It opens the module assistant in the header - the same panel, the
        * same session - rather than a second one of its own.
        */}
      {pageMenu && (
        <ContextMenu
          x={pageMenu.x}
          y={pageMenu.y}
          ariaLabel="Page actions"
          className="w-44"
          onClose={() => setPageMenu(null)}
          items={[{ label: "Ask Nebula", onSelect: openNebula }]}
        />
      )}

      {/* Nebula about that one lead, opened from the row rather than from inside the popup. */}
      {askingAboutLead && (
        <LeadNebulaPanel
          leadId={askingAboutLead.id}
          lead={askingAboutLead}
          onClose={() => setAskingAboutLead(null)}
          onError={showError}
        />
      )}

      {pendingDeleteLead && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingLead) setPendingDeleteLead(null);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="crm-delete-title"
            className="w-full max-w-[440px] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
          >
            <div className="px-6 pb-5 pt-6">
              <h2 id="crm-delete-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800">
                Delete this lead?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {pendingDeleteLead.name || "This lead"} · {pendingDeleteLead.id} will be removed from {boardLabel},
                along with its remarks, call logs and follow-up history. This cannot be undone.
              </p>
            </div>
            <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button type="button" variant="secondary" onClick={() => setPendingDeleteLead(null)} disabled={deletingLead}>
                Cancel
              </Button>
              <Button type="button" variant="danger" onClick={() => void confirmDeleteLead()} disabled={deletingLead}>
                {deletingLead ? "Deleting..." : "Delete"}
              </Button>
            </footer>
          </section>
        </div>
      )}

      {/* The same confirmation over a selection. It names the count rather than a lead, because
          "select all" reaches every lead the board, tab, filters and date range match - including the
          pages that were never scrolled into view - and somebody who ticked the header once is owed
          the number before it happens. */}
      {pendingBulkDelete && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !bulkDeleting) setPendingBulkDelete(false);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="crm-bulk-delete-title"
            className="w-full max-w-[440px] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
          >
            <div className="px-6 pb-5 pt-6">
              <h2 id="crm-bulk-delete-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800">
                Delete {selectedCount.toLocaleString()} selected lead{selectedCount === 1 ? "" : "s"}?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {selectedCount === 1 ? "It" : "They"} will be removed from {boardLabel}, along with
                {selectedCount === 1 ? " its" : " their"} remarks, call logs and follow-up history. This cannot be undone.
              </p>
            </div>
            <footer className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button type="button" variant="secondary" onClick={() => setPendingBulkDelete(false)} disabled={bulkDeleting}>
                Cancel
              </Button>
              <Button type="button" variant="danger" onClick={() => void applyBulkDelete()} disabled={bulkDeleting}>
                {bulkDeleting ? "Deleting..." : "Delete"}
              </Button>
            </footer>
          </section>
        </div>
      )}
      {/* Two answers, because there are only two: book it now, or leave it marked and come back to it
          from Bookings & Converted. The lead is already saved either way, so neither is a refusal. */}
      <ConfirmDialog
        open={Boolean(convertedAsk)}
        title="Open Create Project on this lead?"
        message={`${convertedAsk?.name || "This lead"} is marked ${convertedAsk?.status || "Converted"} and saved. Create Project opens on it with its details filled in; it can also be booked later from Bookings & Converted.`}
        confirmLabel="Open Create Project"
        cancelLabel="Not now"
        tone="primary"
        onCancel={() => setConvertedAsk(null)}
        onConfirm={() => {
          const ask = convertedAsk;
          setConvertedAsk(null);
          if (ask?.id) router.push(convertProjectUrl(ask.id, ask.status));
        }}
      />

      {convertLead?.lead && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConvertLead(null);
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="crm-convert-title"
            className="w-full max-w-[440px] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)]"
          >
            <div className="px-6 pb-5 pt-6">
              <h2 id="crm-convert-title" className="text-[18px] font-medium tracking-[-0.02em] text-slate-800">
                Do you want to convert this lead?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {convertLead.lead.name || "This lead"} · {convertLead.lead.id} is marked{" "}
                {convertLead.status} and saved either way. <strong className="font-semibold">Convert</strong> then opens
                Create Project on it with its details filled in; <strong className="font-semibold">Update and Close</strong>{" "}
                records the conversion and leaves you on the board, for a lead that is converted but not being booked yet.
              </p>
            </div>
            {/* `flex-wrap` and `justify-end`: three buttons do not fit a 360px dialog in one row,
                and wrapping keeps them in their own order rather than shrinking the words. */}
            <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <Button type="button" variant="secondary" onClick={() => setConvertLead(null)}>
                Cancel
              </Button>
              {/* The quieter of the two, because it is the one that stops here. */}
              <Button type="button" variant="secondary" onClick={() => void confirmConvertLead({ openProject: false })}>
                Update and Close
              </Button>
              <Button type="button" variant="primary" onClick={() => void confirmConvertLead({ openProject: true })}>
                Convert
              </Button>
            </footer>
          </section>
        </div>
      )}
      <CrmSuccessDialog
        open={Boolean(successDialog)}
        title={successDialog?.title}
        message={successDialog?.message}
        onClose={() => setSuccessDialog(null)}
      />
      {showImportDialog && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isImporting) closeImportDialog();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-import-title"
            /* Progress and result are compact status cards on the module's own 14px radius;
               only the form keeps the full-size Import panel's shape. */
            className={`w-full overflow-hidden bg-white shadow-[0_20px_60px_rgba(15,23,42,0.22)] ${
              isImporting || importSummary ? "max-w-[440px] rounded-[14px]" : "max-w-[620px] rounded-[24px]"
            }`}
          >
            <header className={isImporting || importSummary ? "px-5 pt-4" : "px-8 pt-7 pb-0"}>
              <h2
                id="crm-import-title"
                className={
                  isImporting || importSummary
                    ? "text-[16px] font-semibold tracking-[-0.01em] text-[#3f3f46]"
                    : "text-[20px] font-semibold tracking-[-0.03em] text-[#4b5563]"
                }
              >
                {isImporting ? "Importing Sheet" : importSummary ? "Import Complete" : "Import CRM Leads"}
              </h2>
            </header>

            <div className={isImporting || importSummary ? "px-5 pb-2.5 pt-2" : "px-8 pb-6 pt-5"}>
              {importSummary ? (
                <div>
                  <div className="flex items-center gap-1.5">
                    <InsertDriveFileOutlinedIcon className="shrink-0 text-[#6b7280]" style={{ fontSize: 17 }} />
                    <p className="truncate text-[15px] font-normal leading-tight text-[#3f3f46]">{importSummary.fileName}</p>
                  </div>
                  {/* Label/value rows on one grid, so the figures line up in a column. */}
                  <dl className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-[12px] leading-none text-[#52525b]">
                    {importSummaryRows(importSummary).map((row) => (
                      <Fragment key={row.label}>
                        <dt className={row.tone === "warn" ? "text-rose-600" : ""}>{row.label}</dt>
                        <dd className={`text-right tabular-nums ${row.tone === "warn" ? "font-medium text-rose-600" : "font-medium text-[#3f3f46]"}`}>
                          {row.value}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                  <div className="-mx-5 mt-3 flex justify-end border-t border-[#e5e7eb] px-5 pt-2.5">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={closeImportDialog}
                    >
                      OK
                    </Button>
                  </div>
                </div>
              ) : isImporting ? (
                <div>
                  <div className="flex items-center gap-1.5">
                    <InsertDriveFileOutlinedIcon className="shrink-0 text-[#6b7280]" style={{ fontSize: 17 }} />
                    <p className="truncate text-[15px] font-normal leading-tight text-[#3f3f46]">{importFile?.name || "CSV import"}</p>
                  </div>
                  <div className="mt-2.5 grid gap-1.5">
                    <div className="flex items-end justify-between text-[12px] leading-none text-[#52525b]">
                      <span>{`${importPercentComplete(importProgress)}% Complete`}</span>
                      <span>{importProgress ? `${importProgress.imported.toLocaleString()} of ${importProgress.rows.toLocaleString()} leads` : "0 of 0 leads"}</span>
                    </div>
                    <div className="h-[5px] overflow-hidden rounded-full bg-[#e8eefb]">
                      <div
                        className="h-full rounded-full bg-[#0b63ff] transition-all duration-200"
                        style={{ width: `${importPercentComplete(importProgress)}%` }}
                      />
                    </div>
                    <div className="text-[12px] leading-none text-[#52525b]">
                      Estimated time remaining: {importTimeRemaining(importProgress)}
                    </div>
                  </div>
                  {/* Full-bleed rule, so the divider spans the card the way it does in the
                      other CRM dialogs rather than stopping at the text column. */}
                  <div className="-mx-5 mt-3 flex justify-end border-t border-[#e5e7eb] px-5 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-md px-1.5 py-0.5 text-[15px] font-normal leading-none text-[#0b63ff] hover:bg-transparent"
                      /* Button's size preset carries a min-height that is most of the empty
                         space around this control; an inline value beats the utility class. */
                      style={{ minHeight: 0 }}
                      onClick={cancelCsvImport}
                      disabled={importCancelled}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                // Both rows share one grid, so the field column and the action column line
                // up down the dialog instead of each row setting its own widths and gaps.
                // The fields are the module's own controls at their default size, rather
                // than 48px boxes on a 14px radius that match nothing else in the CRM.
                <div className="space-y-4">
                  <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Dropdown
                      mode="input"
                      ariaLabel="Select System Table"
                      label="Select System Table"
                      helperText="The board the CSV's leads are imported into."
                      placeholder="Select a table"
                      value={importTable}
                      onChange={(value) => setImportTable(value)}
                      options={IMPORT_TABLE_NAMES.map((name) => ({ label: name, value: name }))}
                    />
                    {/* A link rather than a button: downloading the template is a side
                        errand, not the action this dialog is for, and a second solid button
                        beside Import made the two compete. */}
                    <button
                      type="button"
                      onClick={downloadCrmCsvTemplate}
                      className="min-h-9 pb-0.5 text-left text-sm font-medium text-blue-600 underline underline-offset-2 transition hover:text-blue-700 sm:pb-2"
                    >
                      Download CSV Template
                    </button>
                  </div>

                  <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="block text-xs font-semibold text-slate-600">
                      <span>CSV File<HelpTip text="The filled-in CSV template of leads to bring into the CRM." /></span>
                      <span className="mt-1.5 flex min-h-9 w-full min-w-0 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-700">
                        <span className={`truncate ${importFile ? "" : "text-slate-400"}`}>
                          {importFile ? importFile.name : "No file selected"}
                        </span>
                      </span>
                    </label>
                    <Button type="button" variant="secondary" onClick={() => importInputRef.current?.click()}>
                      Choose File
                    </Button>
                  </div>

                  {importValidation && !importValidation.ok ? (
                    <p role="alert" className="rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                      {importValidation.message}
                    </p>
                  ) : importValidation?.notice ? (
                    /* A file that will import, with columns it does not carry. Said in amber and
                       not in red, and Import stays enabled: those columns arrive empty, which is
                       worth knowing before pressing it rather than after, and is not a fault. */
                    <p className="rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                      {importValidation.notice}
                    </p>
                  ) : (
                    <p className="text-[12px] text-slate-500">
                      {importFile && importValidation?.ok
                        ? `Columns match the ${importTable} table.`
                        : `Download the template first so the columns match the ${importTable} table.`}
                    </p>
                  )}

                  {/* Full-bleed rule, matching the progress state of this same dialog. */}
                  <div className="-mx-8 flex items-center justify-end gap-3 border-t border-slate-200 px-8 pt-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={closeImportDialog}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      onClick={() => void runCsvImport()}
                      disabled={!importFile || !importValidation?.ok || isImporting}
                    >
                      Import
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <LeadPopupModal
        canWrite={canWrite}
        key={leadPopup?.id || "no-lead"}
        open={Boolean(showLeadPopupId && leadPopup)}
        lead={leadPopup}
        /*
         * Another lead, opened over this one. The linked-lead path rather than `openLeadPopup`,
         * because the enquiry being opened is on whichever vertical it belongs to and is very
         * unlikely to be among the rows this board has loaded - the same reason the Contacts
         * directory reaches a lead that way.
         */
        onOpenLead={(enquiryId) => { discardPopupDraft(); setShowLeadPopupId(null); openLinkedLead(enquiryId); }}
        details={leadPopupDetails}
        cnaSequence={getLeadCnaSequence(leadPopup)}
        leadTab={leadPopupTab}
        activity={leadActivity.leadId === showLeadPopupId ? leadActivity.rows : []}
        callLogs={leadCallLogs.leadId === showLeadPopupId ? leadCallLogs.rows : []}
        callLogsLoading={leadCallLogs.leadId !== showLeadPopupId}
        transcripts={leadTranscripts.leadId === showLeadPopupId ? leadTranscripts.rows : []}
        transcriptsLoading={leadTranscripts.leadId !== showLeadPopupId}
        projects={leadProjects.leadId === showLeadPopupId ? leadProjects.rows : []}
        activityLoading={leadActivity.leadId !== showLeadPopupId}
        setLeadTab={setLeadPopupTab}
        chatEnabled={whatsappChatEnabled}
        onChatEnabledChange={setWhatsappChatEnabled}
        onClose={() => guardPopupClose(() => { discardPopupDraft(); setShowLeadPopupId(null); })}
        // Returned rather than `void`ed: the popup needs to know whether the save went through, so a
        // note it committed for the screen can still be written if the save was refused.
        onSave={(closeAfter, advanceAfter, forcedStatus, committedEntries) => savePopupLead(closeAfter, advanceAfter, forcedStatus, committedEntries)}
        onUpdateLead={(key, value) => draftPopupLead(key, value)}
        // The one field that writes as it is typed; see the comment at the call site.
        onCommitLead={(key, value) => updateLead(showLeadPopupId, key, value)}
        onUpdateDetails={(key, value) => draftPopupDetails(key, value)}
        onUpdateRemarks={(nextEntries, options) => updateRemarksEntries(leadPopup.id, nextEntries, options)}
        onUpdateShootRow={(index, key, value) => updatePopupShootRow(index, key, value)}
        onNotice={showSuccess}
        onError={showError}
        onConvert={(status) => setConvertLead({ lead: leadPopup, status: status || "Converted" })}
        onMoveVertical={canWrite ? async (target) => {
          const response = await moveCrmLeadVertical(leadPopup.id, target);
          // It has left this board: the popup closes, and the board reads itself again.
          discardPopupDraft();
          setShowLeadPopupId(null);
          showSuccess(response?.message || `${leadPopup.id} moved to ${target}.`);
          markLeadsChanged();
          await loadLeads({ silent: true });
        } : undefined}
        onBack={() => {
          const visibleIndex = rows.findIndex((row) => row.id === leadPopup?.id);
          // Wraps to the last lead from the first, the way Proceed Next wraps to the first
          // from the last.
          const previousLead = rows[visibleIndex - 1] || rows[rows.length - 1] || null;
          if (!previousLead) return;
          discardPopupDraft();
          openLeadPopup(previousLead.id);
          selectLead(previousLead.id);
        }}
        duplicateEnquiries={duplicateEnquiries?.leadId === showLeadPopupId ? duplicateEnquiries : null}
        onMoveNext={(action) => {
          if (action === "quotation") {
            /*
             * A tab of its own, with the lead left open behind it.
             *
             * Pricing a quotation is read off the lead - the dates, the shoots, what was discussed -
             * so taking this tab to the calculator meant going back and opening the lead again to
             * check anything. `noopener,noreferrer` as everywhere else: the new tab gets no handle
             * on this one.
             */
            window.open(`/sales/quotation-calculator?lead=${encodeURIComponent(leadPopup?.id || "")}`, "_blank", "noopener,noreferrer");
            return;
          }
          if (action === "meetings") {
            setMeetingsLeadId(leadPopup?.id || "");
            return;
          }
        }}
      />
      {/* Save-or-discard, asked before the popup above goes. Beside it rather than inside, because
          it outlives the press that raised it, and above it - see the note on the Contacts copy. */}
      <ConfirmDialog {...popupCloseConfirmProps} layer="dialogOverPanel" />
      {/*
        * "This number is already an enquiry", raised over whichever form is asking.
        *
        * One dialog for both, because it is one question - Add Lead raises it with `intent: "add"`
        * and the lead popup with `intent: "edit"`, and only the wording of the quiet button differs.
        */}
      {duplicateAlert && (
        <DuplicateEnquiryDialog
          phone={duplicateAlert.phone}
          leads={duplicateAlert.leads}
          /*
           * The vertical the form is writing into, which is what turns this from a note into a
           * refusal. A repeat inside one vertical is the same client entered twice; the same number
           * on a Corp enquiry and a Dum Dum one is a wedding client who later booked a shoot.
           */
          vertical={duplicateAlert.vertical || addLeadForm.vertical}
          intent={duplicateAlert.intent}
          onClose={() => setDuplicateAlert(null)}
          onOpenEnquiry={(enquiryId) => {
            /*
             * The existing enquiry, on the board, with the form put away.
             *
             * Leaving Add Lead open behind the lead just opened would stack two records of the same
             * client on screen at once, which is the confusion this warning exists to end. The
             * half-typed form is discarded deliberately: what it holds is a second copy of a client
             * the CRM already has.
             */
            setDuplicateAlert(null);
            // Unguarded, and empty afterwards: choosing to open the lead the CRM already holds is
            // the decision, and what the form held was a second copy of it.
            closeAddLead();
            openLinkedLead(enquiryId);
          }}
          /*
           * Going ahead is remembered against the number, so nothing asks again about this lead - and
           * the warning does reappear the moment the number is edited to a different one that is
           * also already held.
           */
          onContinue={duplicateAlert.confirming ? () => {
            setDuplicateAckPhone(duplicateAlert.phone);
            setDuplicateAlert(null);
            // Confirm's own work, finished: the note still in the box is posted and the posted list
            // handed straight to the save, exactly as pressing Confirm does.
            const committed = addLeadRemarkCommitRef.current?.();
            // The same guard as Confirm's own: this is the other way into the identical save.
            void runAddLead(() => saveLead(committed));
          } : undefined}
        />
      )}
      {showAddLead && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={requestCloseAddLead}>
          <div className="flex max-h-[92vh] w-full max-w-[1540px] flex-col overflow-hidden rounded-[2rem] bg-[#f3f3f3] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <h2 className="text-lg font-medium text-slate-800">Add Lead</h2>
              <button type="button" onClick={requestCloseAddLead} aria-label="Close add lead" className="text-slate-700"><CloseIcon className="h-6 w-6" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-6">
              {/*
                One line naming the call being placed, and only then.

                The form is otherwise identical to adding a lead from nothing, and Confirm does
                something different in the two cases - it writes this caller's existing lead rather
                than creating one - so without this there is nothing on screen to say which is
                happening or whose call it is. The caller's own details are in the fields below,
                filled in and editable; this says where the record came from, which they cannot.
              */}
              {assigningCallId && (
                <p className="mb-3 text-sm text-slate-600">
                  Adding <span className="font-medium text-slate-800">{addLeadForm.name || assigningCallId}</span>
                  {addLeadForm.phone ? ` (${addLeadForm.phone})` : ""} from the Calls board.
                </p>
              )}
              {/* Which lead this is, named, because the form is about to write over it rather than
                  add one - and because a form that opens filled in reads as a new lead somebody has
                  half typed unless it says whose details these are. The enquiry id is the part that
                  makes it unmistakable. */}
              {assigningLeadId && (
                <p className="mb-3 text-sm text-slate-600">
                  Assigning <span className="font-medium text-slate-800">{addLeadForm.name || assigningLeadId}</span>
                  {addLeadForm.phone ? ` (${addLeadForm.phone})` : ""} · {assigningLeadId}. Choose who it is with below;
                  left empty it stays unassigned.
                </p>
              )}
              {/* No Enquiry Date field. The form stamps today - `emptyLeadForm` sets `createdDate`,
                  and `leadFormForVertical` carries it across a change of vertical - which is what a
                  lead typed in as it comes in is, and the studio does not want to be asked. A lead
                  that needs a different date is backdated from the lead popup after it is saved.

                  It is still the date the board files the lead by: Today New Leads and the Status
                  pill both read it, so a manual entry made today lands on today and nowhere else. */}
              <RadioGroupField label="Vertical" helperText="The board the lead goes on; it decides the questions below." value={addLeadForm.vertical} onChange={(value) => updateForm("vertical", value)} options={["Dum Dum", "Qua Qua", "Corp"]} className="mb-3 max-w-2xl" />
              <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <section className="overflow-hidden rounded-2xl bg-white">
                  <h3 className="border-b border-slate-200 px-5 py-3 text-lg font-medium text-slate-700">Client Details</h3>
                  {/* Rows match the lead popup's Client Details exactly: the same groups in
                      the same order, so a field is in the same place whichever form it is
                      being filled in. */}
                  {addLeadForm.vertical === "Dum Dum" && (
                    <div className="space-y-5 p-5">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        {requiredField("name", <TextField helperText={LEAD_FIELD_HELP.name} label="Enquire Name" required value={addLeadForm.name} onChange={(event) => updateForm("name", event.target.value)} />)}
                        {requiredField("phone", <PhoneField helperText={LEAD_FIELD_HELP.phone} label="Contact" required value={addLeadForm.phone} onChange={(_field, phone) => updateForm("phone", phone)} />)}
                        {requiredField("assignedBranch", <Dropdown helperText={LEAD_FIELD_HELP.assignedBranch} mode="input" searchable ariaLabel="Assigned Branch" label="Assigned Branch" required value={addLeadForm.assignedBranch} onChange={(value) => updateForm("assignedBranch", value)} options={branchOptions} />)}
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <ComboBoxField helperText={LEAD_FIELD_HELP.relationship} label="Relationship" value={addLeadForm.relationship} onChange={(value) => updateForm("relationship", value)} options={suggestions.relationship} />
                        <ComboBoxField helperText={LEAD_FIELD_HELP.referredFrom} label="Referred From" value={addLeadForm.referredFrom} onChange={(value) => updateForm("referredFrom", value)} options={suggestions.referredFrom} />
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.groomName} label="Groom Name" value={addLeadForm.groomName} onChange={(event) => updateForm("groomName", event.target.value)} />
                        <PhoneField helperText={LEAD_FIELD_HELP.groomContact} label="Groom Contact" value={addLeadForm.groomContact} onChange={(_field, phone) => updateForm("groomContact", phone)} />
                        <TextField helperText={LEAD_FIELD_HELP.groomLocation} label="Groom Location" value={addLeadForm.groomLocation} onChange={(event) => updateForm("groomLocation", event.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.brideName} label="Bride Name" value={addLeadForm.brideName} onChange={(event) => updateForm("brideName", event.target.value)} />
                        <PhoneField helperText={LEAD_FIELD_HELP.brideContact} label="Bride Contact" value={addLeadForm.brideContact} onChange={(_field, phone) => updateForm("brideContact", phone)} />
                        <TextField helperText={LEAD_FIELD_HELP.brideLocation} label="Bride Location" value={addLeadForm.brideLocation} onChange={(event) => updateForm("brideLocation", event.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.referenceName} label="Referenced Person Name" value={addLeadForm.referenceName} onChange={(event) => updateForm("referenceName", event.target.value)} />
                        <PhoneField helperText={LEAD_FIELD_HELP.referenceContact} label="Reference Contact" value={addLeadForm.referenceContact} onChange={(_field, phone) => updateForm("referenceContact", phone)} />
                        {requiredField("estimatedValue", <TextField helperText={LEAD_FIELD_HELP.estimatedValue} label="Estimated Value" required inputMode="decimal" value={addLeadForm.estimatedValue} onChange={(event) => updateForm("estimatedValue", event.target.value)} />)}
                      </div>
                      {addLeadCustomFields.length > 0 && (
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">{addLeadCustomFields}</div>
                      )}
                    </div>
                  )}
                  {addLeadForm.vertical === "Qua Qua" && (
                    <div className="space-y-5 p-5">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        {requiredField("name", <TextField helperText={LEAD_FIELD_HELP.name} label="Enquire Name" required value={addLeadForm.name} onChange={(event) => updateForm("name", event.target.value)} />)}
                        {requiredField("phone", <PhoneField helperText={LEAD_FIELD_HELP.phone} label="Contact" required value={addLeadForm.phone} onChange={(_field, phone) => updateForm("phone", phone)} />)}
                        {requiredField("assignedBranch", <Dropdown helperText={LEAD_FIELD_HELP.assignedBranch} mode="input" searchable ariaLabel="Assigned Branch" label="Assigned Branch" required value={addLeadForm.assignedBranch} onChange={(value) => updateForm("assignedBranch", value)} options={branchOptions} />)}
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <ComboBoxField helperText={LEAD_FIELD_HELP.relationship} label="Relationship" value={addLeadForm.relationship} onChange={(value) => updateForm("relationship", value)} options={suggestions.relationship} />
                        <ComboBoxField helperText={LEAD_FIELD_HELP.referredFrom} label="Referred From" value={addLeadForm.referredFrom} onChange={(value) => updateForm("referredFrom", value)} options={suggestions.referredFrom} />
                        <Dropdown helperText={LEAD_FIELD_HELP.offerType} mode="input" ariaLabel="Offer Type" label="Offer Type" value={addLeadForm.offerType} onChange={(value) => updateForm("offerType", value)} options={suggestions.offerType} />
                      </div>
                      {/* The baby's own three fields, together. */}
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.babyOrMotherName} label="Baby (or) Mother Name" value={addLeadForm.babyOrMotherName} onChange={(event) => updateForm("babyOrMotherName", event.target.value)} />
                        {requiredField("dateOfBirthOrEdod", <DateField helperText={LEAD_FIELD_HELP.dateOfBirthOrEdod} label="Date of Birth (or) EDOD" required value={addLeadForm.dateOfBirthOrEdod} onChange={(value) => updateForm("dateOfBirthOrEdod", value)} />)}
                        <PhoneField helperText={LEAD_FIELD_HELP.contactNumber} label="Contact" value={addLeadForm.contactNumber} onChange={(_field, phone) => updateForm("contactNumber", phone)} />
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.location} label="Location" value={addLeadForm.location} onChange={(event) => updateForm("location", event.target.value)} />
                        <DateField helperText={LEAD_FIELD_HELP.lastConvertedDate} label="Last Converted Date" value={addLeadForm.lastConvertedDate} onChange={(value) => updateForm("lastConvertedDate", value)} />
                        {requiredField("estimatedValue", <TextField helperText={LEAD_FIELD_HELP.estimatedValue} label="Estimated Value" required inputMode="decimal" value={addLeadForm.estimatedValue} onChange={(event) => updateForm("estimatedValue", event.target.value)} />)}
                      </div>
                      {addLeadCustomFields.length > 0 && (
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">{addLeadCustomFields}</div>
                      )}
                    </div>
                  )}
                  {addLeadForm.vertical === "Corp" && (
                    <div className="space-y-5 p-5">
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        {requiredField("name", <TextField helperText={LEAD_FIELD_HELP.name} label="Enquire Name" required value={addLeadForm.name} onChange={(event) => updateForm("name", event.target.value)} />)}
                        {requiredField("phone", <PhoneField helperText={LEAD_FIELD_HELP.phone} label="Contact" required value={addLeadForm.phone} onChange={(_field, phone) => updateForm("phone", phone)} />)}
                        {requiredField("assignedBranch", <Dropdown helperText={LEAD_FIELD_HELP.assignedBranch} mode="input" searchable ariaLabel="Assigned Branch" label="Assigned Branch" required value={addLeadForm.assignedBranch} onChange={(value) => updateForm("assignedBranch", value)} options={branchOptions} />)}
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.companyName} label="Company Name (or) Client organisation" value={addLeadForm.companyName} onChange={(event) => updateForm("companyName", event.target.value)} />
                        <PhoneField helperText={LEAD_FIELD_HELP.primaryDecisionMaker} label="Primary decision maker - Contact" value={addLeadForm.primaryDecisionMaker} onChange={(_field, phone) => updateForm("primaryDecisionMaker", phone)} />
                        <TextField helperText={LEAD_FIELD_HELP.designation} label="Designation" value={addLeadForm.designation} onChange={(event) => updateForm("designation", event.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.companyWebsite} label="Company Website" value={addLeadForm.companyWebsite} onChange={(event) => updateForm("companyWebsite", event.target.value)} />
                        <TextField helperText={LEAD_FIELD_HELP.companyType} label="Company Type" value={addLeadForm.companyType} onChange={(event) => updateForm("companyType", event.target.value)} />
                        <TextField helperText={LEAD_FIELD_HELP.location} label="Location" value={addLeadForm.location} onChange={(event) => updateForm("location", event.target.value)} placeholder="Office / Factory / Hotel...etc" />
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        <TextField helperText={LEAD_FIELD_HELP.officialEmailId} label="Official Email ID" value={addLeadForm.officialEmailId} onChange={(event) => updateForm("officialEmailId", event.target.value)} />
                        <ComboBoxField helperText={LEAD_FIELD_HELP.referredFrom} label="Referred From" value={addLeadForm.referredFrom} onChange={(value) => updateForm("referredFrom", value)} options={suggestions.referredFrom} />
                        <TextField helperText={LEAD_FIELD_HELP.expectedBudget} label="Budget Expected" value={addLeadForm.expectedBudget} onChange={(event) => updateForm("expectedBudget", event.target.value)} />
                      </div>
                      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                        {requiredField("estimatedValue", <TextField helperText={LEAD_FIELD_HELP.estimatedValue} label="Estimated Value" required inputMode="decimal" value={addLeadForm.estimatedValue} onChange={(event) => updateForm("estimatedValue", event.target.value)} />)}
                      </div>
                      {addLeadCustomFields.length > 0 && (
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">{addLeadCustomFields}</div>
                      )}
                    </div>
                  )}
                  <div className="px-5 pb-5">
                    <h4 className="mb-3 text-sm font-semibold text-slate-600">Shoot Details</h4>
                    <ShootDetailsTable
                      shoots={addLeadForm.shoots}
                      shootTypeOptions={suggestions.shootType}
                      shootTypeStatus={suggestions.status?.shootType}
                      onRetryShootTypes={suggestions.reload}
                      onChangeRow={updateShootRow}
                      onRemoveRow={removeShootRow}
                      onAddRow={() => setAddLeadForm((current) => ({ ...current, shoots: [...(current.shoots || []), emptyShootRow()] }))}
                    />
                  </div>
                </section>
                <section className="overflow-hidden rounded-2xl bg-white">
                  <h3 className="border-b border-slate-200 px-5 py-3 text-lg font-medium text-slate-700">Follow-up Details</h3>
                  <div className="space-y-5 p-5">
                    <fieldset>
                      <legend className="mb-2 text-sm font-semibold text-slate-600">Lead Status<HelpTip text="Pick where this new lead stands right now." /></legend>
                      <LeadStatusPills
                        value={addLeadForm.leadStatus}
                        onChange={(value) => updateForm("leadStatus", value)}
                        options={addLeadStatusOptions}
                      />
                    </fieldset>
                    {/* No Last Follow-up Date here either: a lead being added has not been
                        followed up yet, and the one date worth asking for is the next one. */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Dropdown mode="input" ariaLabel="Assign To" label="Assign To" helperText={LEAD_FIELD_HELP.crm} value={addLeadForm.crm} onChange={(value) => updateForm("crm", value)} options={crmChoices} />
                      {/* A lead being turned down is not being chased, so it has no next call to
                          book - the same rule the lead popup applies, through the same list. */}
                      {!dropsNextFollowUp(addLeadForm.leadStatus, addLeadForm.vertical) && (
                        <>
                          <DateField
                            label="Next Follow-up Date"
                            helperText="The day this lead is due a call; it shows on Pending Followups."
                            value={addLeadForm.nextFollowUpDate}
                            onChange={(value) => updateForm("nextFollowUpDate", value)}
                            required={isRequiredLeadField("nextFollowUpDate", addLeadForm.leadStatus, addLeadForm.name)}
                            error={leadFieldMessage("nextFollowUpDate", addLeadMarks.errors.nextFollowUpDate, addLeadForm)}
                          />
                          <TimeField label="Next Follow-up Time" helperText="The time to call back on the follow-up day." value={addLeadForm.nextFollowUpTime} onChange={(event) => updateForm("nextFollowUpTime", event.target.value)} />
                        </>
                      )}
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-slate-600">Remarks</h4>
                      <NotesComposer
                      onUploadAttachment={uploadRemarkAttachment}
                      onFetchAttachment={fetchRemarkAttachment}
                        key="add-lead-notes"
                        value={addLeadForm.remarks}
                        entries={leadRemarkEntries(addLeadForm.remarkEntries, addLeadForm.remarks)}
                        // The same handle the lead popup and the info panel use: a note still
                        // in the box is posted by Confirm, so a remark typed but never sent is
                        // saved with the lead instead of being thrown away with the form.
                        commitRef={addLeadRemarkCommitRef}
                      onEntriesChange={(nextEntries) => {
                        updateForm("remarkEntries", nextEntries);
                        updateForm("remarks", remarkSummary(nextEntries));
                      }}
                      attachments={addLeadForm.attachments || []}
                      onAttachmentsChange={(value) => updateForm("attachments", value)}
                      className="w-full"
                      placeholder="I add your notes here..."
                      showEmptyState={false}
                    />
                  </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
              {/* Confirm stays live and marks the empty boxes when pressed, the same as the
                  lead popup. A list of names beside a dead button left the user to work out
                  which field on the form each name meant. */}
              <Button type="button" variant="ghost" onClick={requestCloseAddLead} disabled={addingLead}>Cancel</Button>
              <Button
                type="button"
                variant="primary"
                /*
                 * **One press, one lead.** The enquiry id is minted on the server, so a second post
                 * is not a duplicate anything can refuse - it is a second real lead, with its own
                 * id, for somebody to find and delete. `useSubmitOnce` holds the press in a ref as
                 * well as in state, because a double-click is two clicks in the same tick and both
                 * would read the old state before React had re-rendered the button disabled.
                 */
                busy={addingLead}
                busyLabel="Adding..."
                onClick={() => {
                  // Each missing box says what it needs under itself; the notice only how many.
                  const problems = {
                    ...leadFieldProblems(addLeadForm),
                    ...customLeadFieldProblems(addLeadForm, customFieldsByVertical[addLeadForm.vertical]),
                  };
                  if (!addLeadMarks.check(problems)) {
                    showError(markedFieldsMessage(Object.values(problems).filter(Boolean).length));
                    return;
                  }
                  /*
                   * The last thing before the lead is written: is this number already an enquiry?
                   *
                   * Raised here as well as while the number is typed, because the two moments catch
                   * different mistakes. The one while typing is a nudge; this one is the guarantee -
                   * a number pasted in and confirmed in the same second never gave the check time to
                   * answer, and a form left open while somebody else added that client is a warning
                   * that was right when it was drawn and is not now.
                   */
                  if (addLeadDuplicateWarning) {
                    /*
                     * `confirming` says Confirm raised this, so the dialog *may* offer to go on with
                     * the lead - pressed from the line under the Contact box it only informs.
                     *
                     * May, not will: the dialog withholds that button when the clash is inside the
                     * vertical being written to, because the server refuses that save. `vertical` is
                     * what it decides on, sent explicitly so the dialog is never reading a board
                     * that has changed under it.
                     */
                    setDuplicateAlert({ ...addLeadDuplicateWarning, intent: "add", confirming: true, vertical: addLeadForm.vertical });
                    return;
                  }
                  // Posted first, and the posted list handed straight to the save: the state
                  // update behind onEntriesChange has not been applied yet at this point, so
                  // reading the remark back out of the form would miss the one just written.
                  const committed = addLeadRemarkCommitRef.current?.();
                  void runAddLead(() => saveLead(committed));
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Add Lead's save-or-discard. Above the form at `dialogOverPanel`, because that modal covers
          the page on a dialog's own layer and a question drawn behind it dims the screen and shows
          nothing - which reads as a Cancel that did not work. */}
      <ConfirmDialog {...addLeadCloseConfirmProps} layer="dialogOverPanel" />

      {/* Announces a meeting thirty, fifteen and five minutes before it starts, at the bottom
          of the page. Someone working a list of leads is not watching a calendar, and a Meet
          that starts without them is what this is here to prevent. */}
      {/* Announced through this page's own snackbar, so a meeting is said the way everything
          else on the page is said - one bar, one place, one dismiss. */}
      <MeetingReminders onRemind={(message, action) => showNotice(message, "info", action)} />
    </section>
  );
}
