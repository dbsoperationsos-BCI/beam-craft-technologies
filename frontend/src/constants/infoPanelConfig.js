import { preProductionVerticalFieldRuns, preProductionVerticalOf } from "./preProductionVerticalFields.js";
import { verticalCode } from "../components/sales/whatsappGroupNameUtils.js";
import { MONTH_NAMES, monthLabel, rupees } from "../lib/payrollRecovery.mjs";
import { assetCategoryLabel, assetTypeLabel } from "../lib/assetCategoryLabels.mjs";

/**
 * Every info panel in the app, described rather than drawn. `DataTableInfoPanel` renders whatever
 * it is handed from here, so adding a field to a panel is an edit to this file alone.
 *
 * A section is `{ title, fields }` and a field is `[key on the entity, label, type]`. The type
 * decides the formatting: "date" and "boolean" are built into the panel, "gallery" renders images
 * and drops itself (and an otherwise empty section) when there are none, and the shoot types are
 * supplied by `projectInfoFormatters`. No type means the value is printed as it stands.
 *
 * Panels read flat keys, so each entity that arrives nested from the API has a `forInfo` mapper
 * below it, kept here because it is part of the same contract as the field list.
 */

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const assetInfoSections = [
  { title: "Asset Details", fields: [["assetCode", "Asset ID"], ["assetName", "Asset Name"], ["categoryName", "Category"], ["typeName", "Type"], ["status", "Status"], ["company", "Brand Name"], ["specification", "Specification"], ["color", "Color"], ["serialNumber", "Serial Number"], ["remarks", "Remarks"]] },
  { title: "Location and Assignment", fields: [["branchName", "Branch"], ["assignedPersonName", "Assigned Person"], ["assignedPersonEmployeeId", "Employee ID"], ["managerName", "Manager"], ["managerEmployeeId", "Manager Employee ID"]] },
  { title: "Inspection and Purchase", fields: [["purchaseDate", "Purchase Date", "date"], ["inspectionPeriodMonths", "Inspection Period (months)"], ["lastInspectedDate", "Last Inspected Date", "date"], ["nextInspectionDate", "Next Inspection Date", "date"], ["purchasePrice", "Purchase Price"], ["purchasedFrom", "Purchased From"], ["invoiceNumber", "Invoice Number"], ["warrantyMonths", "Warranty (months)"]] },
  { title: "Insurance and Attachments", fields: [["insuranceDetails", "Insurance Details"], ["insuranceExpiry", "Insurance Expiry", "date"], ["imageCount", "Images"], ["documentCount", "Documents"]] },
  { title: "Image Gallery", fields: [["galleryImages", "Photos", "gallery"]] },
];

/** Flattens the nested category, branch and people values the asset panel reads by key. */
export function assetForInfo(asset) {
  if (!asset) return null;
  return {
    ...asset,
    categoryName: assetCategoryLabel(asset),
    typeName: assetTypeLabel(asset),
    branchName: asset.branch?.name,
    assignedPersonName: asset.assignedPerson?.employeeName,
    assignedPersonEmployeeId: asset.assignedPerson?.employeeId,
    managerName: asset.manager?.employeeName,
    managerEmployeeId: asset.manager?.employeeId,
    imageCount: `${(Array.isArray(asset.images) ? asset.images.length : 0) + (asset.photoData ? 1 : 0)} file(s)`,
    documentCount: `${Array.isArray(asset.documents) ? asset.documents.length : 0} file(s)`,
    // The main photo leads, then whatever else was uploaded with the asset.
    galleryImages: [asset.photoData, ...(Array.isArray(asset.images) ? asset.images : [])].filter(Boolean),
  };
}

/**
 * A request read in one place: what was asked for, who asked, and how it was decided. The decision
 * section stays visible while a request is still pending — its fields simply read "—", which says
 * "nobody has ruled on this yet" more plainly than the section vanishing would.
 */
export const assetRequestInfoSections = [
  { title: "Request", fields: [["requestCode", "Request ID"], ["assetName", "Asset Name"], ["status", "Status"]] },
  { title: "Category", fields: [["categoryName", "Category"], ["subCategoryName", "Sub Category"]] },
  { title: "Raised By", fields: [["requestedByName", "Requested By"], ["createdAt", "Requested On", "date"], ["remarks", "Remarks"]] },
  { title: "Decision", fields: [["decidedByName", "Decided By"], ["decidedAt", "Decided On", "date"], ["decisionRemarks", "Decision Remarks"], ["assetCode", "Asset Added"], ["assetNameAdded", "Asset Added Name"]] },
];

/** Flattens the nested category and asset values the request panel reads by key. */
export function assetRequestForInfo(request) {
  if (!request) return null;
  return {
    ...request,
    categoryName: request.category?.name,
    subCategoryName: request.subCategory?.name,
    assetCode: request.asset?.assetCode,
    // Named apart from the request's own assetName, which is what was asked for rather than what
    // was eventually added.
    assetNameAdded: request.asset?.assetName,
  };
}

// ---------------------------------------------------------------------------
// Client storage
// ---------------------------------------------------------------------------

/**
 * The whole record read in one place, grouped the way it is filled in: what the shoot and project
 * are, what was recorded as the disc was handed in, what the backup and closing checks found, and
 * how it travelled out. Most of these are only editable at the status change that asks for them,
 * so this is where they stay readable afterwards.
 */
export const clientStorageInfoSections = [
  { title: "Storage Record", fields: [["storageId", "SM ID"], ["status", "Status"], ["clientName", "Client Name"], ["projectStatus", "Project Status"], ["shootCode", "Shoot ID"], ["shootName", "Shoot"], ["shootDate", "Date Created", "date"], ["mainEventDate", "Main Event Date", "date"], ["isShootStatusPending", "Shoot Status Pending", "boolean"]] },
  { title: "Project Team", fields: [["sourceBranch", "Source Branch"], ["crmName", "CRM"], ["preProductionCoordinator", "Pre Production Coordinator"], ["creativeManager", "Creative Manager"], ["postProductionCoordinator", "Post Production Coordinator"]] },
  { title: "Work Details", fields: [["product", "Product"], ["type", "Type"], ["wid", "WID"], ["workType", "Work Type"], ["footageLocation", "Footage Location"], ["storageType", "Storage Type"], ["footageLink", "Footage Link"], ["remarks", "Remarks"]] },
  { title: "Hard Disc", fields: [["hardDiscBrand", "Hard Disc Brand"], ["hardDiscColour", "Hard Disc Colour"], ["hardDiscCapacity", "Hard Disc Capacity"], ["items", "Items"], ["labeled", "Labeled?", "boolean"]] },
  { title: "Backup & Checks", fields: [["footageSize", "Footage Size"], ["footageBackup", "Footage Backup", "boolean"], ["finalFilesCopy", "Final Files Copy", "boolean"], ["harddiskFootagesBackup", "Harddisk Footages Back up", "boolean"], ["folderStructureChecked", "Folder Structure Checked", "boolean"], ["finalRenders", "Final Renders", "boolean"], ["otherFilesInHarddisk", "Other Files in Harddisk", "boolean"], ["hardDiskIn", "Hard disk in"]] },
  { title: "Handover", fields: [["assignedToName", "Assigned To"], ["assignedAt", "Assigned On", "date"]] },
  { title: "Transit", fields: [["transitCondition", "Condition"], ["transitDamageRemarks", "Damage Remarks"], ["transferFrom", "Transfer From"], ["transferTo", "Transfer To"], ["sentBy", "Sent By"], ["sentByPhone", "Sender Phone"], ["receivedBy", "Received By"], ["receivedByPhone", "Receiver Phone"], ["courierService", "Courier Service"], ["trackingNumber", "Tracking Number"], ["shipmentType", "Shipment Type"], ["shipmentDateTime", "Shipment Date", "date"], ["shipmentEta", "ETA", "date"], ["courierCharge", "Courier Charge"], ["transferReason", "Transfer Reason"], ["specialInstructions", "Special Instructions"], ["attachmentCount", "Attachments"]] },
  { title: "Record History", fields: [["addedByName", "Added By"], ["createdAt", "Added On", "date"]] },
];

const fileCount = (value) => Array.isArray(value) ? value.length : 0;

/** Flattens the nested shoot, project and assignee values the storage panel reads by key. */
export function clientStorageForInfo(record) {
  if (!record) return null;
  return {
    ...record,
    clientName: record.project?.clientName,
    projectStatus: record.project?.projectStatus,
    mainEventDate: record.project?.mainEventDate,
    sourceBranch: record.project?.sourceBranch,
    crmName: record.project?.crmName,
    preProductionCoordinator: record.project?.preProductionCoordinator,
    creativeManager: record.project?.creativeManager,
    postProductionCoordinator: record.project?.postProductionCoordinator,
    shootCode: record.shoot?.shootId,
    shootName: record.shoot?.shoot,
    shootDate: record.shoot?.dateCreated,
    addedByName: record.addedBy?.name,
    attachmentCount: `${fileCount(record.hddOutPhoto) + fileCount(record.transitCurrentPhoto) + fileCount(record.courierReceipt) + fileCount(record.packagePhoto)} file(s)`,
  };
}

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/** How a vendor's status reads, shared by the table cell, the row menu and the panel. */
export const vendorStatusLabels = { ACTIVE: "Active", INACTIVE: "Inactive" };

/**
 * Grouped the way the vendor form collects them, so a row read here and the same row opened for
 * editing are laid out alike. The address is spread across its own section rather than sitting as
 * one line, since the PIN code lookup fills the parts in separately.
 */
export const vendorInfoSections = [
  { title: "Business Details", fields: [["vendorId", "Vendor ID"], ["vendorName", "Vendor Name"], ["vendorType", "Vendor Type"], ["sourceType", "Source"], ["statusLabel", "Status"], ["statusReason", "Status Reason"], ["businessRegistrationName", "Business Registration Name"], ["businessStartYear", "Business Start Year"], ["experience", "Experience"], ["rating", "Rating"]] },
  { title: "Contact", fields: [["contactPerson", "Contact Person"], ["mobileNumber", "Mobile Number"], ["whatsappNumber", "WhatsApp Number"], ["alternateNumber", "Alternate Number"], ["email", "Email"]] },
  { title: "Address", fields: [["address", "Address"], ["area", "Area"], ["city", "City"], ["district", "District"], ["state", "State"], ["country", "Country"], ["pincode", "Pincode"]] },
  { title: "Tax & Bank Details", fields: [["gstNumber", "GST Number"], ["panNumber", "PAN Number"], ["aadhaarNumber", "Aadhaar Number"], ["bankName", "Bank Name"], ["accountNumber", "Account Number"], ["ifscCode", "IFSC Code"], ["upiId", "UPI ID"]] },
  { title: "Capabilities", fields: [["preferredLanguages", "Preferred Languages"], ["skills", "Skills"], ["supportedBranchNames", "Supported Branches"], ["canBeProductionTeamMember", "Can Be a Production Team Member", "boolean"]] },
  { title: "Social & Reference", fields: [["website", "Website"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["referredBy", "Referred By"], ["remarks", "Remarks"]] },
  { title: "Record History", fields: [["addedByName", "Added By"], ["createdAt", "Added On", "date"]] },
];

/**
 * Reads the creator and the status the way the table shows them. Experience is worded here rather
 * than left as a bare number, so the panel does not read "Experience 4" with no unit.
 */
export function vendorForInfo(vendor) {
  if (!vendor) return null;
  return {
    ...vendor,
    statusLabel: vendorStatusLabels[vendor.status] || vendor.status,
    experience: vendor.yearsOfExperience == null ? "" : `${vendor.yearsOfExperience} years`,
    addedByName: vendor.addedBy?.name,
  };
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

/**
 * The repository lists two kinds of row — a hired employee and an onboarding invite that has not
 * become one yet — so there is a list for each. An invite carries only what the invite itself
 * recorded, which is why it is the shorter of the two.
 */
export const employeeInfoSections = [
  { title: "Employee information", fields: [["employeeId", "Employee ID"], ["employeeName", "Employee Name"], ["employmentStatus", "Employment Status"], ["contactNumber", "Contact Number"], ["emailId", "Email ID"], ["dateOfJoining", "Date Of Joining", "date"], ["dateOfRelieving", "Last Working Day", "date"]] },
  { title: "Role", fields: [["designation", "Designation"], ["department", "Department"], ["skills", "Skills"], ["vertical", "Vertical"], ["workBaseLocation", "Work Base Location"], ["currentWorkLocation", "Current Work Location"], ["photoShooter", "Photo Shooter", "boolean"], ["workType", "Work Type"], ["languagesKnown", "Languages Known"]] },
  { title: "Personal", fields: [["bloodGroup", "Blood Group"], ["fatherName", "Father’s Name"], ["motherName", "Mother’s Name"], ["dateOfBirth", "Date Of Birth", "date"], ["maritalStatus", "Marital Status"], ["weddingAnniversary", "Wedding Anniversary", "date"], ["currentAddress", "Current Address"], ["permanentAddress", "Permanent Address"]] },
  // Both are lists on the record rather than columns, so the panel reads the one-line summaries the
  // repository folds them into — the panel shows values, and a table of rows is not one.
  { title: "Qualification & Experience", fields: [["qualificationSummary", "Qualifications"], ["experienceSummary", "Experience"]] },
  { title: "Emergency Contact", fields: [["emergencyContactName", "Emergency Contact Name"], ["emergencyContactNumber", "Emergency Contact Number"], ["emergencyContactRelationship", "Emergency Contact Relationship"]] },
  { title: "Photo", fields: [["profilePhotoUrl", "Profile Photo", "gallery"]] },
  { title: "Identity", fields: [["aadharCardNumber", "Aadhar Card Number"], ["panCardNumber", "Pan Card Number"], ["aadharCardImageUrl", "Aadhar Card Photo", "gallery"], ["panCardImageUrl", "PAN Card Photo", "gallery"]] },
  { title: "Bank", fields: [["bankName", "Bank Name"], ["bankLocation", "Bank Location"], ["accountNumber", "Account Number"], ["ifscCode", "IFSC Code"], ["bankAccountStatus", "Bank Account Status"]] },
  { title: "Notes", fields: [["remarksDetails", "Remarks Details"], ["appreciationDetails", "Appreciation Details"]] },
];

export const inviteInfoSections = [
  { title: "Invite information", fields: [["employeeName", "Candidate Name"], ["emailId", "Candidate Email"], ["contactNumber", "Candidate Phone"], ["designation", "Intended Designation"], ["employmentStatus", "Employment Status"]] },
  { title: "Invite Status", fields: [["inviteCreatedAt", "Invite Created At", "date"], ["inviteExpiresAt", "Invite Expires At", "date"], ["inviteStatus", "Invite Status"], ["candidateSubmission", "Candidate Submission"]] },
];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * The same project is read differently depending on where it is opened: the sales table shows the
 * sale, the projects table adds the workflow the project runs through, the production table adds
 * that day's assignment, and the tree view repeats the workflow beside the tree it is drawing.
 */
export const commonProjectInfoSections = [
  { title: "Project Identity", fields: [["eventId", "Event ID"], ["enquiryId", "Enquiry ID"], ["projectStatus", "Project Status"], ["whatsappGroupName", "WhatsApp Group Name"], ["vertical", "Vertical", "vertical"]] },
  { title: "Client & Branch", fields: [["clientMainNumber", "Client Main Number"], ["sourceBranch", "Source Branch"], ["crmName", "CRM Name"]] },
  { title: "Event Planning", fields: [["mainEventDateKnown", "Main Event Date Known", "boolean"], ["mainEventDate", "Main Event Date", "date"], ["initialConvertedValue", "Initial Converted Value"]] },
  { title: "Deliverables", fields: [["deliverables", "Deliverables"], ["deliverablesDetails", "Deliverables Details"]] },
  { title: "WhatsApp Group Details", fields: [["whatsappGroupName", "WhatsApp Group Name"], ["vertical", "Vertical", "vertical"], ["waBranch", "Branch"], ["waOfferName", "Offer Name"], ["waClientName", "Client Name"], ["waPlace", "Place"], ["mainEventDate", "Main Event Date", "date"], ["waGou", "GOU"], ["waHouseType", "House Type"], ["waSocialMediaPosting", "Social Media Posting"], ["waGeneratorCreatedAt", "Generator Created At", "date"], ["waGeneratorExpiresAt", "Generator Expires At", "date"], ["waGeneratorUsedStatus", "Generator Used Status"]] },
  { title: "Remarks", fields: [["salesPreProductionRemarks", "Sales Pre Production Remarks"], ["salesProductionRemarks", "Sales Production Remarks"], ["salesPostProductionRemarks", "Sales Post Production Remarks"]] },
  { title: "System Details", fields: [["createdAt", "Created At", "date"], ["updatedAt", "Updated At", "date"]] },
];

/** The three stages of the workflow, shown wherever a project is managed rather than sold. */
const workflowSections = [
  { title: "Shoot Creation", fields: [["shoots", "Shoot List", "shootList"]] },
  { title: "Production Creation", fields: [["shoots", "Service Allocations", "shootServiceAllocations"]] },
  { title: "Post Production Allocation", fields: [["shoots", "Deliverables", "shootDeliverables"]] },
];

export const projectManagementInfoSections = [
  ...commonProjectInfoSections.slice(0, 4),
  { title: "Project Workflow", fields: [["projectStatus", "Current Project Status"], ["startProjectStatus", "Start Project Status"]] },
  {
    title: "Project Identification",
    fields: [
      ["projectManager", "Project Manager"],
      ["preProductionCoordinator", "Pre Production Coordinator"],
      ["creativeManager", "Creative Manager"],
      ["postProductionCoordinator", "Post Production Coordinator"],
      ["welcomeGift", "Welcome Gift"],
      ["welcomeGiftAssignee", "Welcome Gift Assigned To"],
      ["shootCompletedGift", "Shoot Completed Gift"],
      ["shootCompletedGiftAssignee", "Shoot Completed Gift Assigned To"],
      ["projectValidityMonths", "Project Validity (In Months)"],
      ["storageNeeded", "Storage Needed"],
      ["crdDocumentStatus", "CRD Document Groom / Bride / Baby Shoot"],
    ],
  },
  ...workflowSections,
  ...commonProjectInfoSections.slice(4),
];

/**
 * One shoot on the Pre Production board, read back in full.
 *
 * The row is the shoot, not the project, so the project's columns lead as the context the shoot
 * sits in and the coordinator's own answers follow. The order matches the form that fills them in,
 * so a field is read where it was written.
 */
export const preProductionInfoSections = [
  { title: "Project", fields: [["eventId", "Event ID"], ["clientName", "Client Name"], ["clientMainNumber", "Client Number"], ["sourceBranch", "Source Branch"], ["product", "Vertical", "vertical"], ["crdDocumentStatus", "CRD Document Groom / Bride / Baby Shoot"], ["crdDocumentState", "CRD Document State"], ["crdSidesReceived", "CRD Sides Received"], ["crdCompletion", "CRD Completion %"], ["crdSubmittedAt", "CRD Submitted At", "date"], ["projectStatus", "Project Status"], ["mainEventDate", "Main Event Date", "date"]] },
  { title: "People", fields: [["crmName", "CRM"], ["preProductionCoordinator", "Pre Production Coordinator"], ["creativeManager", "Creative Manager"], ["postProductionCoordinator", "Post Production Coordinator"]] },
  { title: "Shoot", fields: [["shootId", "Shoot ID"], ["shoot", "Shoot"], ["shootType", "Shoot Type"], ["subEventDate", "Sub Event Date", "date"], ["isMainEvent", "Main Event", "boolean"], ["shootPlace", "Shoot Place"], ["district", "District"], ["state", "State"], ["sessionTiming", "Session Timing"]] },
  { title: "Location", fields: [["locationAddress", "Location Address"], ["locationLink", "Location Link"]] },
  { title: "Event Timing", fields: [["eventStartTime", "Event Start Time"], ["eventEndTime", "Event End Time"], ["reportingTime", "Reporting Time"], ["scheduleRemarks", "Remarks"]] },
  { title: "Concepts", fields: [["conceptList", "Concept List", "multiline"]] },
  { title: "Travel & Accommodation", fields: [["travelAccommodationNeeded", "Travel & Accommodation Needed", "boolean"], ["travelPaidBy", "Travel Paid By"], ["accommodationPaidBy", "Accommodation Paid By"], ["foodTakenCareBy", "Food Taken Care By"], ["accommodationAddress", "Accommodation Location Address"], ["accommodationLink", "Accommodation Link"], ["accommodationRemarks", "Remarks"]] },
  { title: "Status", fields: [["completionStatus", "Pre Production Status"], ["shootStatusRemarks", "Status Remarks"]] },
  { title: "Storage", fields: [["storageId", "Storage ID"], ["receivedTheStorage", "Received The Storage", "boolean"], ["storageStatus", "Storage Status"]] },
  { title: "Sales Handover", fields: [["salesPreProductionRemarks", "Sales Pre Production Remarks"]] },
  { title: "System Details", fields: [["updatedAt", "Last Updated", "date"], ["updatedBy", "Last Updated By"]] },
];

/**
 * The sections for one pre production row, given the project's vertical: the base list
 * with that vertical's checklist slotted in before Follow-up & Status — the same placement the
 * edit form gives it. Reads the same field runs as every other pre production surface.
 */
/** An intro call reads as it was asked - Yes or No - rather than as the Completed / Pending it is kept as. */
export const preProductionInfoFormatters = {
  preProductionYesNo: (value) => (value === "Completed" ? "Yes" : "No"),
  // DD, not the stored WED - see `verticalCode`.
  vertical: (value) => verticalCode(value) || "—",
};

export function preProductionInfoSectionsFor(product) {
  const vertical = preProductionVerticalOf(product);
  const run = preProductionVerticalFieldRuns[vertical];
  if (!run.length) return preProductionInfoSections;
  const section = {
    title: vertical === "dumdum" ? "Dum Dum Checklist" : "Qua Qua Checklist",
    fields: run.map((field) => [field.id, field.label, field.type === "toggle" ? "boolean" : field.type === "yesno" ? "preProductionYesNo" : field.type === "date" ? "date" : undefined].filter((part) => part !== undefined)),
  };
  const at = preProductionInfoSections.findIndex((entry) => entry.title === "Follow-up & Status");
  return [...preProductionInfoSections.slice(0, at), section, ...preProductionInfoSections.slice(at)];
}

/**
 * One project row on the Pre Production board — the project's own columns plus the summary of its
 * shoots the board computes. Everything per-shoot is read by opening the project's cards, so this
 * panel deliberately stops at the summary.
 */
export const preProductionProjectInfoSections = [
  { title: "Project", fields: [["eventId", "Event ID"], ["clientName", "Client Name"], ["clientMainNumber", "Client Number"], ["sourceBranch", "Source Branch"], ["product", "Vertical", "vertical"], ["crdDocumentStatus", "CRD Document Groom / Bride / Baby Shoot"], ["crdDocumentState", "CRD Document State"], ["crdSidesReceived", "CRD Sides Received"], ["crdCompletion", "CRD Completion %"], ["crdSubmittedAt", "CRD Submitted At", "date"], ["projectStatus", "Project Status"], ["mainEventDate", "Main Event Date", "date"]] },
  { title: "People", fields: [["crmName", "CRM"], ["productionManager", "Production Manager"], ["preProductionCoordinator", "Pre Production Coordinator"], ["creativeManager", "Creative Manager"], ["postProductionCoordinator", "Post Production Coordinator"]] },
  { title: "Storage", fields: [["storageId", "Storage ID"], ["receivedTheStorage", "Received The Storage", "boolean"], ["storageStatus", "Storage Status"]] },
  { title: "Shoots", fields: [["shootCount", "Shoots"], ["shootNames", "Shoot Names"], ["shootIds", "Shoot IDs"], ["subEventDates", "Sub Event Dates"], ["completionStatusLabel", "Pre Production Status"], ["preProductionStatusRemarks", "Status Remarks"], ["completionSummary", "Shoots Planned"], ["shootsPending", "Shoots Pending"], ["lastFollowupDate", "Last Followup Date", "date"], ["nextFollowupDate", "Next Followup Date", "date"], ["followupRemarks", "Followup Remarks"], ["nextFollowupDate", "Next Followup Due", "date"]] },
  { title: "Sales Handover", fields: [["salesPreProductionRemarks", "Sales Pre Production Remarks"]] },
];

export const productionProjectInfoSections = [
  ...projectManagementInfoSections.slice(0, 4),
  {
    title: "Production Assignment",
    fields: [
      ["productionTravelMode", "Travel Mode"],
      ["productionDrivenBy", "Driven By"],
      ["productionVehicle", "Vehicle"],
      ["productionCoordinator", "Assigned By (Project Coordinator)"],
      ["productionAssignedPerson", "Assigned Person"],
      ["productionEquipment", "Equipment"],
      ["productionRemarks", "Remarks"],
    ],
  },
  ...commonProjectInfoSections.slice(4),
];

export const treeProjectInfoSections = [
  { title: "Project Identity", fields: [["projectStatus", "Project Status"], ["eventId", "Event ID"], ["enquiryId", "Enquiry ID"], ["whatsappGroupName", "WhatsApp Group Name"], ["vertical", "Vertical", "vertical"]] },
  { title: "Client & Branch", fields: [["clientMainNumber", "Client Main Number"], ["sourceBranch", "Source Branch"], ["crmName", "CRM Name"]] },
  { title: "WhatsApp Group Details", fields: [["whatsappGroupName", "WhatsApp Group Name"], ["vertical", "Vertical", "vertical"], ["waBranch", "Branch"], ["waOfferName", "Offer Name"], ["waClientName", "Client Name"], ["waPlace", "Place"], ["waGou", "GOU"], ["waHouseType", "House Type"], ["waSocialMediaPosting", "Social Media Posting"], ["waGeneratorCreatedAt", "Generator Created At", "date"], ["waGeneratorExpiresAt", "Generator Expires At", "date"], ["waGeneratorUsedStatus", "Generator Used Status"]] },
  { title: "Project Identification", fields: [["projectManager", "Project Manager"], ["preProductionCoordinator", "Pre Production Coordinator"], ["creativeManager", "Creative Manager"], ["postProductionCoordinator", "Post Production Coordinator"]] },
  ...workflowSections,
];

/**
 * A quotation, read back beside its table and in full on a double-click.
 *
 * Grouped rather than listed in column order: the table is scanned left to right, but a record is
 * read a section at a time — who it is for, what it is worth, and when it stops being valid are
 * three different questions.
 */
export const quotationInfoSections = [
  /*
   * `quotationId` is the whole reference and is the only one shown: "QUT039-01" is chain 039 at
   * version 01, so a separate Quotation Number field beside it repeated half of its neighbour.
   * That is why there is no `quotationNumber` row here — the chain number still names the version
   * history dialog and the delete warning, where the chain rather than one version is the subject.
   *
   * The two finalized fields answer the question the register is read for: whether a project
   * converted at this exact version, and which project it was. Only one version of a chain ever
   * did, so both are empty on every other row.
   */
  // `brandName` is the badge's wording - "Dum Dum" - written onto the row by the register, beside the
  // id because which brand a quotation was raised under is the first thing that says which package it is.
  { title: "Quotation", fields: [["quotationId", "Quotation ID"], ["brandName", "Brand"], ["version", "Version", "number"], ["versionCount", "Versions Raised", "number"], ["enquiryId", "Enquiry ID"], ["status", "Status"], ["finalizedQuotation", "Finalized Quotation"], ["finalizedByEventId", "Finalized On Project"]] },
  { title: "Client", fields: [["clientName", "Client Name"], ["clientMainNumber", "Client Main Number"], ["secondaryContactNumber", "Secondary Contact Number"], ["sourceBranch", "Source Branch"], ["eventVenue", "Event Venue"]] },
  // The link's own five days sit here rather than under the client: it is this version's validity,
  // and it is the answer to "can they still open what I sent them".
  { title: "Value & Validity", fields: [["amount", "Amount", "number"], ["quotationDate", "Quotation Date", "datetime"], ["validUntil", "Valid Until", "date"], ["linkStatus", "Link"], ["linkExpiresAt", "Link Expires", "datetime"], ["linkRenewedAt", "Link Re-enabled", "date"]] },
  { title: "Record History", fields: [["followedBy", "Followed By"], ["referredBy", "Referred By"], ["createdAt", "Created At", "date"]] },
  /*
   * Last, and on its own, because it is the one field here that is prose rather than an answer -
   * several lines of it sitting between Followed By and Created At would push everything the panel
   * is scanned for off the bottom. `multiline` keeps the breaks it was typed with.
   */
  { title: "Notes", fields: [["additionalNotes", "Additional Notes", "multiline"]] },
];

/** A CRD document link and whatever the client has sent back against it. */
export const crdDocumentInfoSections = [
  { title: "Document", fields: [["eventId", "Event ID"], ["enquiryId", "Enquiry ID"], ["status", "Status"], ["receivedAt", "Received At", "date"]] },
  { title: "Client", fields: [["clientName", "Client Name"], ["clientMainNumber", "Contact Number"], ["sourceBranch", "Nearest Branch"], ["verticalLabel", "Vertical"]] },
];

/*
 * A Client Gifts row: the gift, then the project it belongs to.
 *
 * The gift comes first because that is what this screen is a list of - the project beneath it is
 * how the person chasing the gift finds the client. The row carries a gift's fields under neutral
 * names, so one config serves both gifts rather than one each.
 */
export const clientGiftsInfoSections = [
  {
    title: "Gift",
    fields: [
      ["giftLabel", "Gift"],
      ["status", "Status"],
      ["assignee", "Assigned To"],
      ["sentAt", "Sent At"],
      ["receivedAt", "Received By Client At"],
    ],
  },
  {
    title: "Project",
    fields: [
      ["eventId", "Event ID"],
      ["enquiryId", "Enquiry ID"],
      ["clientName", "Client Name"],
      ["whatsappGroupName", "WhatsApp Group Name"],
      ["clientMainNumber", "Client Main Number"],
      ["sourceBranch", "Source Branch"],
      // Formatted like every other project panel: DD, not the WED the group name generator keeps.
      ["vertical", "Vertical", "vertical"],
      ["crmName", "CRM"],
      ["projectManager", "Project Manager"],
      ["projectStatus", "Project Status"],
    ],
  },
];

/*
 * Project Management → Feedback: one review, read back. The info panel (a row's click) and View
 * (its double-click or ⋮ menu, `RecordViewPanel`) both draw these, so the two cannot differ. The
 * Shoot and Project sections are what Give Feedback's Project Description card shows.
 */
/*
 * One attendance request - a leave, permission, comp-off or on-duty - read beside its table and in
 * full on a double-click, on HRM → Request and Employee Attendance.
 *
 * One list for all four kinds. `attendanceRequestSections` (in `components/hrm/attendanceRequests`,
 * beside the type labels `attendanceRequestForInfo` reads) narrows Period to the request's own kind,
 * so a leave never shows a From Time. Reason and Remarks are prose, so they are `multiline` and keep
 * the breaks they were typed with.
 *
 * The table says how far a request got as a count; this says who, under Approvers - each approver
 * and whether they have approved, rejected or not yet answered (`approverProgress`, formatted by
 * `attendanceRequestFormatters`). Only where the server sends the names: it withholds them from the
 * person who raised a request once it is rejected (`requesterMaySeeApprovers`), and the field is
 * simply absent then.
 */
export const attendanceRequestInfoSections = [
  { title: "Request", fields: [["typeLabel", "Request Type"], ["displayStatus", "Status"], ["createdAt", "Applied On", "datetime"]] },
  { title: "Employee", fields: [["employeeName", "Employee Name"], ["employeeCode", "Employee ID"]] },
  {
    title: "Period",
    fields: [
      ["workedDate", "Holiday / Weekly Off Worked", "date"],
      // A Comp-Off Credit's day as attendance recorded it, and what became of it.
      ["creditDayKind", "Day"],
      ["creditLoginAt", "Login", "datetime"],
      ["creditLogoutAt", "Logout", "datetime"],
      ["creditWorked", "Worked"],
      ["creditStatus", "Comp-Off Credit"],
      ["creditExpiresOn", "Use By", "date"],
      ["dayOff", "Day Off", "date"],
      ["permissionDate", "Date", "date"],
      ["fromDate", "From Date", "date"],
      ["toDate", "To Date", "date"],
      ["daysLabel", "Days"],
      ["fromTime", "From Time"],
      ["toTime", "To Time"],
      ["durationLabel", "Duration"],
    ],
  },
  // An Incorrect Login request's day as the server read it when it was raised, and what it asks for.
  { title: "Attendance Correction", fields: [["currentStatus", "Current Status"], ["requestedStatus", "Change To"]] },
  { title: "Reason", fields: [["reason", "Reason", "multiline"]] },
  { title: "Decision", fields: [["approvalsSummary", "Approvals"], ["approvers", "Approvers", "approverProgress"], ["decidedAt", "Decided On", "datetime"], ["decisionRemarks", "Remarks", "multiline"]] },
];

/*
 * One referral, read beside the register.
 *
 * The two instalments are one field rather than six: they are a schedule, and a schedule reads as
 * lines under a heading rather than as "3rd month amount", "3rd month due", "3rd month status"
 * spread down a column. `referralInstalments` is the formatter the HRM module passes in, the same
 * way the project module passes its shoot summaries.
 */
export const referralInfoSections = [
  {
    title: "Referral",
    fields: [
      ["referralId", "Referral ID"],
      ["referredEmployeeName", "Referred Employee"],
      ["referredEmployeeCode", "Employee ID"],
      ["referrerName", "Referred By"],
      ["referredOn", "Date of Joining", "date"],
      ["total", "Referral Amount", "currency"],
      ["remarks", "Remarks"],
    ],
  },
  {
    title: "Instalments",
    fields: [
      ["payouts", "Schedule", "referralInstalments"],
    ],
  },
];

/*
 * One request from the user activity log, read beside the grid - every field the row carries,
 * including the four the grid has no room for: who the account belongs to, their branch, the path
 * that was called and the browser that called it.
 *
 * `logTime` and `durationMs` are formatters the screen passes in: the log reads its time to the
 * second in the grid's own format, and a duration is milliseconds rather than a bare number.
 */
export const activityLogInfoSections = [
  {
    title: "Request",
    fields: [
      ["createdAt", "Log time", "logTime"],
      ["username", "Username"],
      ["userName", "Full name"],
      ["branchName", "Branch"],
      ["module", "Utility name"],
      ["action", "Action name"],
      ["method", "HTTP method"],
      ["path", "Route path"],
    ],
  },
  /*
   * **What the write changed**, in a section of its own.
   *
   * Its own, because it is the answer to the question this panel is usually opened for - "he says he
   * updated it and it is not reflecting" - and because it is several sentences rather than one value:
   * under Request it would have read as one more line of plumbing between the route path and the
   * status code. A line whose save changed nothing on a watched record, or was refused, has none and
   * the section says so rather than disappearing.
   */
  {
    title: "What changed",
    fields: [["changes", "Changes", "changes"]],
  },
  {
    title: "Response",
    fields: [
      ["statusCode", "Status code"],
      ["statusText", "Response status"],
      ["durationMs", "Duration", "durationMs"],
    ],
  },
  {
    title: "Device",
    fields: [
      ["clientIp", "Client host"],
      ["userAgent", "User agent", "multiline"],
    ],
  },
];
// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

/** "October 2026" for a payroll month. */
const payrollMonth = (year, month) => (year && month ? `${MONTH_NAMES[Number(month) - 1]} ${year}` : "");
/** The months skipped on the Main Page, as the registers list them: "Oct 2026, Nov 2026". */
const skippedText = (keys) => (keys || []).map(monthLabel).join(", ");

/** Payroll → Advance Salary: one advance, read the way its form collects it. */
export const payrollAdvanceInfoSections = [
  { title: "Advance", fields: [["employeeName", "Employee Name"], ["employeeCode", "Employee ID"], ["advanceId", "Advance ID"], ["status", "Status"], ["amountText", "Amount"], ["advanceDate", "Advance Date", "date"], ["reason", "Reason", "multiline"]] },
  { title: "Deduction", fields: [["fromMonth", "From Month (salary it comes off)"], ["skippedText", "Skipped Months"]] },
  { title: "Record History", fields: [["createdAt", "Added On", "datetime"], ["updatedAt", "Last Changed", "datetime"]] },
];

/** Money in rupees and the months worded, so the panel never reads a bare number or a month index. */
export function payrollAdvanceForInfo(advance) {
  if (!advance) return null;
  return {
    ...advance,
    amountText: rupees(advance.amount),
    fromMonth: payrollMonth(advance.deductYear, advance.deductMonth),
    skippedText: skippedText(advance.skippedMonths),
  };
}

/** Payroll → Recovery: one recovery - what is owed, how it is taken back, and where it came from. */
export const payrollRecoveryInfoSections = [
  { title: "Recovery", fields: [["employeeName", "Employee Name"], ["employeeCode", "Employee ID"], ["recoveryId", "Recovery ID"], ["status", "Status"], ["totalAmountText", "Total Amount"], ["monthlyDeductionText", "Monthly Deduction"], ["monthsText", "No. of Months"], ["instalmentsText", "Instalments Deducted"], ["reason", "Reason", "multiline"]] },
  { title: "Schedule", fields: [["startMonthText", "Start Month"], ["startDate", "Start Date", "date"], ["endDate", "End Date", "date"], ["skippedText", "Skipped Months"]] },
  { title: "Source", fields: [["advancesText", "Made From"]] },
  { title: "Record History", fields: [["createdAt", "Added On", "datetime"], ["updatedAt", "Last Changed", "datetime"]] },
];

export function payrollRecoveryForInfo(recovery) {
  if (!recovery) return null;
  return {
    ...recovery,
    // An LOP policy breach is days, not money - its total and monthly share say so.
    totalAmountText: recovery.deductBy === "LOP" ? `${Number(recovery.totalDays) || 0} days of LOP` : rupees(recovery.totalAmount),
    monthlyDeductionText: recovery.deductBy === "LOP" ? `${(recovery.lopDaysPerMonth || []).join(", ")} days` : rupees(recovery.monthlyDeduction),
    monthsText: recovery.months ? `${recovery.months} ${Number(recovery.months) === 1 ? "month" : "months"}` : "",
    instalmentsText: recovery.months ? `${recovery.instalmentsDeducted ?? 0} of ${recovery.months}` : "",
    startMonthText: payrollMonth(recovery.startYear, recovery.startMonth),
    skippedText: skippedText(recovery.skippedMonths),
    // Where it came from: the advances converted into it, or entered here.
    advancesText: (recovery.advanceIds || []).length ? `Advances ${recovery.advanceIds.join(", ")}` : "Entered on Recovery",
  };
}

/** Payroll → Policy Breach: one fine - how much, and how it is taken from salary. Mapped by `payrollRecoveryForInfo`. */
export const payrollPolicyBreachInfoSections = [
  { title: "Policy Breach", fields: [["employeeName", "Employee Name"], ["employeeCode", "Employee ID"], ["policyBreachId", "Policy Breach ID"], ["status", "Status"], ["totalAmountText", "Total Amount"], ["monthlyDeductionText", "Monthly Deduction"], ["monthsText", "No. of Months"], ["instalmentsText", "Instalments Deducted"], ["reason", "Reason", "multiline"]] },
  { title: "Schedule", fields: [["startMonthText", "Start Month"], ["startDate", "Start Date", "date"], ["endDate", "End Date", "date"], ["skippedText", "Skipped Months"]] },
  { title: "Record History", fields: [["createdAt", "Added On", "datetime"], ["updatedAt", "Last Changed", "datetime"]] },
];
