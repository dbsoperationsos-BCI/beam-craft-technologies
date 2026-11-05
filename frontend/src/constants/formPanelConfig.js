/**
 * Every schema form in the app, described rather than drawn. `SchemaFormPanel` renders whatever it
 * is handed from here, so adding a field to a form is an edit to this file alone.
 *
 * A section is `{ id, title, fields, columns?, when?, summary? }` and a field is
 * `{ name, label, type?, required?, options?, placeholder?, colSpan?, when?, clears?, props? }`.
 * Types map to the shared inputs — text, textarea, select, date, time, toggle, radio, file, image —
 * and `custom` defers to a renderer the form passes in `context.renderers`, which is how the few
 * one-off widgets stay out of these lists.
 */


// ---------------------------------------------------------------------------
// Asset requests
// ---------------------------------------------------------------------------

const categoryOptions = (values, context) => (context?.tree || []).map((node) => ({ value: node.id, label: node.name }));

/**
 * Narrowed to the chosen category once there is one, and every sub category before that, so someone
 * who knows exactly what they want can pick it straight away and let it settle the category.
 */
const subCategoryOptions = (values, context) => {
  const tree = context?.tree || [];
  const chosen = tree.find((node) => node.id === values.categoryId);
  return (chosen ? [chosen] : tree).flatMap((node) => (node.children || []).map((child) => ({ value: child.id, label: child.name })));
};

/** The category a sub category belongs to, which is what lets one fill in the other. */
const parentCategoryId = (subCategoryId, context) => (context?.tree || []).find((node) => (node.children || []).some((child) => child.id === subCategoryId))?.id || "";

/**
 * Asking for an asset that does not exist yet. The two work in both directions: choosing a category
 * narrows the sub categories under it, and choosing a sub category fills in the category it belongs
 * to. Changing the category clears the sub category, so the pair submitted can never come from two
 * different branches.
 */
export const assetRequestSections = [
  {
    id: "asset",
    title: "Asset Details",
    fields: [
      { name: "assetName", label: "Asset Name", helperText: "The item you need, named clearly enough for the team to source it.", required: true, colSpan: 2, placeholder: "e.g. Wireless lapel mic" },
      { name: "categoryId", label: "Category", helperText: "The asset group it belongs to; changing it clears the sub category.", type: "select", required: true, placeholder: "Select category", options: categoryOptions, clears: ["subCategoryId"], props: { searchable: true } },
      { name: "subCategoryId", label: "Sub Category", helperText: "Optional; picking one fills in its category for you.", type: "select", options: subCategoryOptions, placeholder: "Select sub category", derive: (value, values, context) => ({ categoryId: parentCategoryId(value, context) || values.categoryId }), props: { searchable: true } },
    ],
  },
  {
    id: "notes",
    title: "Additional Information",
    columns: 1,
    fields: [
      { name: "remarks", label: "Remarks", helperText: "Optional: why it is needed, or anything the approver should know.", type: "textarea", placeholder: "Why it is needed, or anything else worth knowing", props: { rows: 4 } },
    ],
  },
];

/**
 * Turning down an asset request. The remark is mandatory: a rejection is only useful to the person
 * who raised the request if it says why, and the server enforces the same rule.
 */
export const assetRequestRejectSections = [
  {
    id: "decision",
    title: "Rejection Details",
    columns: 1,
    summary: (values, context) => [
      ["Request ID", context.request.requestCode],
      ["Asset Name", context.request.assetName],
      ["Category", context.request.category?.name],
      ["Sub Category", context.request.subCategory?.name],
      ["Requested By", context.request.requestedByName],
      ["Requester's Remarks", context.request.remarks],
    ],
    fields: [
      { name: "remarks", label: "Reason for Rejection", helperText: "Why the request is turned down, so the person who raised it knows.", type: "textarea", required: true, placeholder: "e.g. Already available with the Chennai branch", props: { rows: 4 } },
    ],
  },
];

// ---------------------------------------------------------------------------
// Client storage
// ---------------------------------------------------------------------------

const storageSummary = (values, context) => [
  ["SM ID", context.record.storageId],
  ["Client Name", context.record.project?.clientName],
  ["Shoot ID", context.record.shoot?.shootId],
  ["Shoot", context.record.shoot?.shoot],
];

/**
 * What is recorded as the hard disc leaves for the client, laid out in the same three sections the
 * asset In Transit step uses. Nothing is required: a disc often goes out before its tracking number
 * is known, and the API accepts the same.
 */
export const clientStorageTransitSections = [
  {
    id: "record",
    title: "Storage Record",
    summary: (values, context) => [
      ["SM ID", context.record.storageId],
      ["Client Name", context.record.project?.clientName],
      ["Assigned To", context.record.assignedToName],
      ["Hard Disc", [context.record.hardDiscBrand, context.record.hardDiscCapacity].filter(Boolean).join(" ")],
    ],
  },
  {
    id: "condition-transfer",
    title: "Condition & Transfer",
    fields: [
      { name: "transitCondition", label: "Current Condition", helperText: "The hard disc's condition as it leaves.", type: "select", options: "transitConditions", placeholder: "Select condition" },
      { name: "transitDamageRemarks", label: "Damage Remarks", helperText: "Any damage on the disc, so it is on record before it travels." },
      { name: "transitCurrentPhoto", label: "Current Photo", helperText: "A photo of the disc as it is sent, as proof of its condition.", type: "file", colSpan: 2, props: { image: true, accept: ".jpg,.jpeg,.png,.webp" } },
      { name: "transferFrom", label: "Transfer From", helperText: "Where it is being sent from, such as a branch." },
      { name: "transferTo", label: "Transfer To", helperText: "Where it is going, such as the client's address or a branch." },
      { name: "sentBy", label: "Sent By", helperText: "The person handing it over to be sent." },
      { name: "sentByPhone", label: "Sender Phone Number", helperText: "The sender's number, for questions about the delivery.", props: { type: "tel" } },
      { name: "receivedBy", label: "Received By", helperText: "The person who collects it at the other end." },
      { name: "receivedByPhone", label: "Receiver Phone Number", helperText: "The receiver's number, so they can be reached about the delivery.", props: { type: "tel" } },
    ],
  },
  {
    id: "shipment-details",
    title: "Shipment Details",
    fields: [
      { name: "courierService", label: "Courier Service", helperText: "The courier company carrying the package, if it is couriered." },
      { name: "trackingNumber", label: "Tracking / Consignment Number", helperText: "The courier's tracking number, used to follow the package." },
      { name: "shipmentDateTime", label: "Shipment Date and Time", helperText: "The day the package was sent; a future date is not allowed.", type: "date", props: { restriction: "future" } },
      { name: "shipmentEta", label: "Expected Delivery Date (ETA)", helperText: "The day it is expected to arrive; a past date is not allowed.", type: "date", props: { restriction: "past" } },
      { name: "courierCharge", label: "Courier Charge", helperText: "The amount paid to send the package.", props: { type: "number", min: "0", step: "0.01" } },
      { name: "shipmentType", label: "Shipment Type", helperText: "How the package is being sent.", type: "select", options: "shipmentTypes", placeholder: "Select shipment type" },
      { name: "courierReceipt", label: "Courier Receipt Upload", helperText: "The courier's receipt, as a PDF or a photo.", type: "file", props: { accept: ".pdf,.jpg,.jpeg,.png" } },
      { name: "packagePhoto", label: "Courier Package Photo", helperText: "A photo of the package as it was sent.", type: "file", props: { image: true, accept: ".jpg,.jpeg,.png,.webp" } },
    ],
  },
  {
    id: "transit-remarks",
    title: "Instructions & Remarks",
    fields: [
      { name: "transferReason", label: "Transfer Reason", helperText: "Why the hard disc is being sent." },
      { name: "specialInstructions", label: "Special Instructions", helperText: "Anything the courier or receiver must take care with." },
    ],
  },
];

/** Every Yes/No column on a storage record, in the order it appears in the table. */
export const clientStorageChecks = [
  ["labeled", "Labeled?"],
  ["footageBackup", "Footage Backup"],
  ["finalFilesCopy", "Final Files Copy"],
  ["harddiskFootagesBackup", "Harddisk Footages Back up"],
  ["folderStructureChecked", "Folder Structure Checked"],
  ["finalRenders", "Final Renders"],
  ["otherFilesInHarddisk", "Other Files in Harddisk"],
];

/** The helper line beside each of those checks, wherever it is asked. */
const clientStorageCheckHelp = {
  labeled: "Whether the hard disc is labelled so it can be told apart.",
  footageBackup: "Whether the shoot's footage has been backed up.",
  finalFilesCopy: "Whether a copy of the final files has been made.",
  harddiskFootagesBackup: "Whether the footage on this hard disc has been backed up.",
  folderStructureChecked: "Whether the folders on the disc have been checked and are in order.",
  finalRenders: "Answer Yes once the final renders have been checked.",
  otherFilesInHarddisk: "Whether the disc holds any files besides this shoot's.",
};

/** The hard disc holding a shoot's footage, and the checks done on it. */
export const clientStorageFormSections = [
  {
    id: "shoot",
    title: "Shoot & Project",
    fields: [
      { name: "storageId", label: "SM ID", helperText: "The storage record's own number, given automatically when it is saved.", placeholder: "Generated on save", props: { readOnly: true } },
      { name: "shootId", label: "Shoot ID", helperText: "The shoot whose footage is on this hard disc.", type: "select", options: "shoots", placeholder: "Select shoot", props: { searchable: true } },
      // Read from the project's shoots, not ticked here: while any shoot is still ahead, a
      // delivered disc returns to "Yet to Receive" for that shoot instead of finishing. Shown so
      // the reason the record loops is visible, and disabled because nothing here decides it.
      // Drawn as a pair like the answers around it, though it is a reading rather than a question -
      // the one switch among seven pairs would read as a control somebody forgot to convert.
      yesNoField("isShootStatusPending", "Shoot Status Pending", { helperText: "Read from the project's shoots: Yes while any shoot is still ahead.", props: { variant: "field", disabled: true } }),
      { name: "shootSummary", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "work",
    title: "Work Details",
    fields: [
      { name: "product", label: "Product", helperText: "The product this footage was shot for, as the studio names it." },
      { name: "type", label: "Type", helperText: "The kind of work on this disc, in the studio's own words." },
      { name: "wid", label: "WID", helperText: "The work ID this footage is filed under, if it has one." },
      { name: "workType", label: "Work Type", helperText: "The kind of work this footage is for; asked when the disc is handed in." },
    ],
  },
  {
    id: "footage",
    title: "Footage & Storage",
    fields: [
      { name: "footageLocation", label: "Footage Location", helperText: "Where the footage is kept, such as a system or drive name." },
      { name: "storageType", label: "Storage Type", helperText: "What kind of storage holds the footage." },
      { name: "footageSize", label: "Footage Size", helperText: "The total size of the footage, such as 1.2 TB.", placeholder: "e.g. 1.2 TB" },
      { name: "hardDiskIn", label: "Hard disk in", helperText: "Where the hard disc is right now.", type: "select", options: "hardDiskStates", placeholder: "Select status" },
      { name: "footageLink", label: "Footage Link", helperText: "A link to the footage online, if it has been uploaded.", colSpan: 2, props: { type: "url" } },
      { name: "remarks", label: "Remarks", helperText: "Optional notes about this hard disc or its footage.", type: "textarea", colSpan: 2 },
    ],
  },
  {
    id: "hard-disc",
    title: "Hard Disc",
    fields: [
      { name: "hardDiscBrand", label: "Hard Disc Brand", helperText: "The disc's maker, as printed on it, to tell it apart." },
      { name: "hardDiscColour", label: "Hard Disc Colour", helperText: "The disc's colour, to help pick it out." },
      { name: "hardDiscCapacity", label: "Hard Disc Capacity", helperText: "How much the disc holds, such as 2 TB.", placeholder: "e.g. 2 TB" },
      { name: "items", label: "Items", helperText: "Anything handed in with the disc, such as cables or a pouch." },
    ],
  },
  {
    id: "checks",
    title: "Checks",
    fields: clientStorageChecks.map(([name, label]) => yesNoField(name, label, { helperText: clientStorageCheckHelp[name] })),
  },
];

/**
 * Three steps along the flow ask for details, and each asks for a different part of the record: the
 * disc is described when it is handed in, the backup is confirmed once it has been taken, and the
 * closing checks are made as it goes out. The API validates the same split, so a field asked for
 * here is a field that step will accept, and `required` mirrors it exactly.
 */
export const clientStorageStatusSteps = {
  "Hand In": {
    description: "Describe the hard disc as it is handed in.",
    sections: [
      { id: "record", title: "Storage Record", summary: storageSummary },
      { id: "work", title: "Work Details", fields: [
        { name: "workType", label: "Work Type", helperText: "The kind of work this footage is for.", required: true },
        { name: "footageLocation", label: "Footage Location", helperText: "Where the footage is kept, such as a system or drive name.", required: true },
        { name: "storageType", label: "Storage Type", helperText: "What kind of storage holds the footage.", required: true },
        { name: "footageLink", label: "Footage Link", helperText: "A link to the footage online, if it has been uploaded.", props: { type: "url" } },
      ] },
      { id: "hard-disc", title: "Hard Disc", fields: [
        { name: "hardDiscBrand", label: "Hard Disc Brand", helperText: "The disc's maker, as printed on it, to tell it apart.", required: true },
        { name: "hardDiscColour", label: "Hard Disc Colour", helperText: "The disc's colour, to help pick it out." },
        { name: "hardDiscCapacity", label: "Hard Disc Capacity", helperText: "How much the disc holds, such as 2 TB.", required: true, placeholder: "e.g. 2 TB" },
        { name: "items", label: "Items", helperText: "Anything handed in with the disc, such as cables or a pouch." },
      ] },
      { id: "checks", title: "Checks", fields: [yesNoField("labeled", "Labeled?", { helperText: clientStorageCheckHelp.labeled })] },
      { id: "remarks", title: "Remarks", fields: [{ name: "remarks", label: "Remarks", helperText: "Optional notes about this hard disc as it is handed in.", type: "textarea", colSpan: 2 }] },
    ],
  },
  "Footage Backup Done": {
    description: "Confirm the footage backup that has been taken.",
    sections: [
      { id: "record", title: "Storage Record", summary: storageSummary },
      { id: "backup", title: "Footage Backup", fields: [
        { name: "footageSize", label: "Footage Size", helperText: "The total size of the footage backed up, such as 1.2 TB.", required: true, placeholder: "e.g. 1.2 TB" },
        yesNoField("footageBackup", "Footage Backup", { helperText: clientStorageCheckHelp.footageBackup }),
        yesNoField("finalFilesCopy", "Final Files Copy", { helperText: clientStorageCheckHelp.finalFilesCopy }),
        yesNoField("harddiskFootagesBackup", "Harddisk Footages Back up", { helperText: clientStorageCheckHelp.harddiskFootagesBackup }),
      ] },
    ],
  },
  "HDD Out": {
    description: "Make the closing checks before this hard disc goes out.",
    sections: [
      { id: "record", title: "Storage Record", summary: storageSummary },
      { id: "checks", title: "Final Checks", fields: [
        yesNoField("folderStructureChecked", "Folder Structure Checked", { helperText: clientStorageCheckHelp.folderStructureChecked }),
        yesNoField("finalRenders", "Final Renders", { helperText: clientStorageCheckHelp.finalRenders }),
        yesNoField("otherFilesInHarddisk", "Other Files in Harddisk", { helperText: clientStorageCheckHelp.otherFilesInHarddisk }),
      ] },
      { id: "location", title: "Location", fields: [
        { name: "hardDiskIn", label: "Hard disk in", helperText: "Where the hard disc is right now.", type: "select", options: "hardDiskStates", placeholder: "Select status" },
        // Compressed in the browser before upload, the same as every other image field.
        { name: "hddOutPhoto", label: "Proof of Done", helperText: "One photo showing the closing checks are done.", type: "file", colSpan: 2, props: { image: true, maxFiles: 1, accept: ".jpg,.jpeg,.png,.webp" } },
      ] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Asset status transitions
// ---------------------------------------------------------------------------

export const assetStatusTitles = {
  UNDER_REPAIR: "Move to Under Repair",
  IN_SERVICE: "Move to In Service",
  IN_TRANSIT: "Move to In Transit",
  ACTIVE: "Mark Asset Active",
  LOST: "Mark Asset Lost",
  SOLD: "Mark Asset Sold",
  DISPOSED: "Mark Asset Disposed",
  UNASSIGNED: "Mark Asset Unassigned",
};

/*
 * The words the studio judges and moves its equipment by.
 *
 * These were the lists themselves, read straight into the field descriptions below - and the first
 * and third were written a second time on the server, in `client-storage.controller.js`, where the
 * same two questions are asked of a client's hard disk. So the browser and the server could
 * disagree about what an answer may be, which is the drift Payment Mode had.
 *
 * They are lists the studio maintains now (Settings → Fields → Assets), fetched by the dialog and
 * passed in through `context.options`; these three are what it falls back to when the read fails or
 * comes back empty, which is exactly what the form offered before. Client Storage keeps a list of
 * its own rather than sharing these, by the studio's choice.
 */
export const assetConditions = ["Excellent", "Good", "Fair", "Damaged"];
export const assetRepairSeverities = ["Low", "Medium", "High", "Critical"];
export const assetShipmentTypes = ["Hand Delivery", "Courier", "Transport", "Internal Transfer"];
/** Statuses an asset can be received into, and the ones that only want a reason. */
export const assetReceiptStatuses = ["ACTIVE", "UNDER_REPAIR", "LOST", "SOLD", "DISPOSED", "UNASSIGNED"];
export const assetReasonStatuses = ["LOST", "SOLD", "DISPOSED", "UNASSIGNED"];

const imageTypes = ".jpg,.jpeg,.png,.webp";
const forAction = (...actions) => (values, context) => actions.includes(context.action);

/** Where a vendor is, read off the vendor record so nobody has to copy it across by hand. */
const vendorAddressLine = (vendor) => [vendor?.address, vendor?.area, vendor?.city, vendor?.district, vendor?.state, vendor?.pincode].filter(Boolean).join(", ");

/**
 * One form covering every status an asset can be moved to: which sections it asks for depends on
 * where the asset is coming from as well as where it is going, so each one carries the transition
 * it belongs to. The panel hides the rest, sidebar included.
 */
export const assetStatusSections = [
  {
    id: "asset-information",
    title: "Asset Information",
    summary: (values, context) => [
      ["Asset ID", context.asset.assetCode],
      ["Asset Name", context.asset.assetName],
      ["Asset Category", context.asset.category?.parent?.name || context.asset.category?.name],
      ["Serial Number", context.asset.serialNumber],
    ],
  },
  {
    id: "receipt-details",
    title: "Receipt Details",
    // Receiving an asset that is on its way back, whatever status it is being received into.
    when: (values, context) => context.fromTransit,
    fields: [
      { name: "receivedBy", label: "Received By", helperText: "The person who took the asset in when it arrived." },
      { name: "handedOverTo", label: "Handed Over To", helperText: "The person the asset was given to after it arrived." },
      { name: "receivedDate", label: "Received Date", helperText: "The day the asset arrived; a future date is not allowed.", type: "date", props: { restriction: "future" } },
      { name: "condition", label: "Condition", helperText: "The asset's condition when it arrived.", type: "select", options: "assetConditions", placeholder: "Select condition" },
      { name: "receivedRemarks", label: "Damage / Received Remarks", helperText: "Any damage found, or anything else noticed on arrival.", type: "textarea", colSpan: 2 },
      { name: "receivedCourierPhoto", label: "Received Courier Photo", helperText: "A photo of the package as it arrived.", type: "file", props: { image: true, accept: imageTypes } },
      { name: "currentPhoto", label: "Current Photo", helperText: "A photo of the asset as it is now.", type: "file", props: { image: true, accept: imageTypes } },
    ],
  },
  {
    id: "repair-details",
    title: "Repair Details",
    when: forAction("UNDER_REPAIR"),
    fields: [
      { name: "issueCategory", label: "Issue Category", helperText: "A short name for the kind of fault the asset has.", required: true },
      { name: "severity", label: "Severity", helperText: "How badly the fault affects using the asset.", type: "select", required: true, options: "assetRepairSeverities", placeholder: "Select severity" },
      { name: "problemDescription", label: "Problem Description", helperText: "What is wrong and how it happened, for whoever repairs it.", type: "textarea", required: true, colSpan: 2 },
      { name: "repairAssignee1Id", label: "Assignee 1", helperText: "The first employee responsible for getting it repaired.", type: "select", required: true, options: "people", placeholder: "Select first employee", props: { searchable: true } },
      { name: "repairAssignee2Id", label: "Assignee 2", helperText: "The second employee responsible for getting it repaired.", type: "select", required: true, options: "people", placeholder: "Select second employee", props: { searchable: true } },
      { name: "reportedById", label: "Reported By", helperText: "The employee who found or reported the fault.", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
      { name: "reportedDate", label: "Reported Date", helperText: "The day the fault was reported; a future date is not allowed.", type: "date", required: true, props: { restriction: "future" } },
      { name: "repairedPhotos", label: "Repaired Photos", helperText: "Optional photos showing the fault or the repair work.", type: "file", colSpan: 2, props: { image: true, accept: imageTypes } },
    ],
  },
  {
    id: "service-details",
    title: "Service Details",
    when: forAction("IN_SERVICE"),
    fields: [
      // Choosing the vendor fills in where it is, so the record of the service says where the asset
      // went without anyone typing the address again.
      { name: "vendorName", label: "Vendor Name", helperText: "The service vendor; choosing one fills in their address below.", type: "select", required: true, options: "vendors", placeholder: "Select active vendor", props: { searchable: true }, derive: (value, values, context) => ({ vendorAddress: vendorAddressLine(context?.vendorsByName?.[value]) }) },
      // A plain line like the fields around it: the address is read, not written, so it needs no
      // more room than any other value on the form.
      { name: "vendorAddress", label: "Vendor Address", helperText: "Filled in from the vendor's record, so it cannot be typed here.", props: { readOnly: true, title: "Vendor address" } },
      { name: "estimatedCost", label: "Estimated Cost", helperText: "What the vendor expects the service to cost.", props: { type: "number", min: "0" } },
      { name: "estimatedCompletionDate", label: "Estimated Completion Date", helperText: "When the vendor expects to finish; a past date is not allowed.", type: "date", props: { restriction: "past" } },
      { name: "remarks", label: "Remarks", helperText: "Optional notes about this service job.", type: "textarea" },
    ],
  },
  {
    id: "service-completion",
    title: "Service Completion",
    when: (values, context) => context.serviceToActive,
    fields: [
      { name: "receivedOn", label: "Received On", helperText: "The day the asset came back from service; a future date is not allowed.", type: "date", required: true, props: { restriction: "future" } },
      { name: "serviceCost", label: "Cost", helperText: "What the service actually cost, as on the vendor's bill.", required: true, props: { type: "number", min: "0", step: "0.01" } },
      { name: "receivedAndReviewedById", label: "Received and Reviewed By", helperText: "The employee who collected the asset and checked the work.", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
      { name: "handoverToId", label: "Handover To", helperText: "The employee the asset is handed to now it is back in use.", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
    ],
  },
  {
    id: "assignment-details",
    title: "Assignment Details",
    when: (values, context) => context.unassignedToActive,
    fields: [
      { name: "assignedToId", label: "Assigned To", helperText: "The employee who will now hold and use this asset.", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
      { name: "assignedOn", label: "Assigned On", helperText: "The day it was handed to them; a future date is not allowed.", type: "date", required: true, props: { restriction: "future" } },
      // Asked for here because unassigning the asset cleared it: the manager is who answers for the
      // asset while it is out, so handing it back out is the moment to say who that is again. Not
      // required, since an asset can be created without one.
      { name: "managerId", label: "Manager", helperText: "Optional: the employee who answers for this asset while it is out.", type: "select", options: "people", placeholder: "Select employee", props: { searchable: true } },
    ],
  },
  {
    id: "condition-transfer",
    title: "Condition & Transfer",
    when: forAction("IN_TRANSIT"),
    fields: [
      { name: "condition", label: "Current Condition", helperText: "The asset's condition as it leaves.", type: "select", options: "assetConditions", placeholder: "Select condition" },
      { name: "damageRemarks", label: "Damage Remarks", helperText: "Any damage on the asset, so it is on record before it travels." },
      { name: "currentPhoto", label: "Current Photo", helperText: "A photo of the asset as it is sent, as proof of its condition.", type: "file", colSpan: 2, props: { image: true, accept: imageTypes } },
      { name: "transferFrom", label: "Transfer From", helperText: "Where it is being sent from, such as a branch." },
      { name: "transferTo", label: "Transfer To", helperText: "Where it is going, such as a branch or a person." },
      { name: "sentBy", label: "Sent By", helperText: "The person handing it over to be sent." },
      { name: "sentByPhone", label: "Sender Phone Number", helperText: "The sender's number, for questions about the delivery." },
      { name: "receivedBy", label: "Received By", helperText: "The person who collects it at the other end." },
      { name: "receivedByPhone", label: "Receiver Phone Number", helperText: "The receiver's number, so they can be reached about the delivery." },
    ],
  },
  {
    id: "shipment-details",
    title: "Shipment Details",
    when: forAction("IN_TRANSIT"),
    fields: [
      { name: "courierService", label: "Courier Service", helperText: "The courier company carrying the package, if it is couriered." },
      { name: "trackingNumber", label: "Tracking / Consignment Number", helperText: "The courier's tracking number, used to follow the package." },
      { name: "shipmentDateTime", label: "Shipment Date and Time", helperText: "The day the package was sent; a future date is not allowed.", type: "date", props: { restriction: "future" } },
      { name: "eta", label: "Expected Delivery Date (ETA)", helperText: "The day it is expected to arrive; a past date is not allowed.", type: "date", props: { restriction: "past" } },
      { name: "courierCharge", label: "Courier Charge", helperText: "The amount paid to send the package.", props: { type: "number", min: "0" } },
      { name: "shipmentType", label: "Shipment Type", helperText: "How the asset is being sent, such as by courier or by hand.", type: "select", options: "assetShipmentTypes", placeholder: "Select shipment type" },
      { name: "courierReceipt", label: "Courier Receipt Upload", helperText: "The courier's receipt, as a PDF or a photo.", type: "file", props: { accept: ".pdf,.jpg,.jpeg,.png" } },
      { name: "packagePhoto", label: "Courier Package Photo", helperText: "A photo of the package as it was sent.", type: "file", props: { image: true, accept: imageTypes } },
    ],
  },
  {
    id: "transit-remarks",
    title: "Instructions & Remarks",
    when: forAction("IN_TRANSIT"),
    fields: [
      { name: "reason", label: "Transfer Reason", helperText: "Why the asset is being moved.", type: "textarea" },
      { name: "specialInstructions", label: "Special Instructions", helperText: "Anything the courier or receiver must take care with.", type: "textarea" },
    ],
  },
  {
    id: "sold-details",
    title: "Sold Details",
    when: forAction("SOLD"),
    fields: [
      { name: "soldByName", label: "Sold By Name", helperText: "The person who sold the asset on the studio's behalf.", required: true },
      { name: "soldByEmployeeId", label: "Sold By Employee ID", helperText: "Optional employee ID of the seller, if they are on staff." },
      { name: "soldTo", label: "Sold To Name", helperText: "The buyer's name, as on the sale.", required: true },
      { name: "soldToContact", label: "Sold To Contact", helperText: "The buyer's phone number, in case anything about the sale comes up.", required: true, props: { type: "tel" } },
      { name: "soldDate", label: "Sold Date", helperText: "The day it was sold; a future date is not allowed.", type: "date", required: true, props: { restriction: "future" } },
      { name: "soldPrice", label: "Sold Price", helperText: "The amount the buyer paid for the asset.", required: true, props: { type: "number", min: "0", step: "0.01" } },
    ],
  },
  {
    id: "status-reason",
    title: "Reason & Remarks",
    // The statuses that only want to know why, plus cancelling a repair that was never needed.
    when: (values, context) => context.generic || context.cancellation,
    fields: [
      { name: "lostByName", label: "Lost By Name", helperText: "The person who had the asset when it was lost.", required: true, when: forAction("LOST") },
      { name: "reason", type: "textarea", required: true, colSpan: 2, helperText: (values, context) => (context.cancellation ? "Why the repair is being cancelled, kept with this change." : "Why the asset's status is changing, kept with this change."), label: (values, context) => context.cancellation ? "Cancellation Reason" : `${assetStatusTitles[context.action]} Reason and Remarks` },
    ],
  },
];

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

/**
 * Vendor business, payment and capability details. Three of these have no shared input — the PIN
 * code lookup that fills in the address, the grouped skills picker and the language chips — so they
 * are declared as custom fields and drawn by the panel's own renderers.
 */
export const vendorFormSections = [
  {
    id: "business",
    title: "Business Details",
    fields: [
      { name: "vendorId", label: "Vendor ID", helperText: "The vendor's own ID, given automatically when they are saved.", placeholder: "Generated on save", props: { readOnly: true } },
      { name: "vendorName", label: "Vendor Name", helperText: "The name the studio knows this vendor by, shown wherever vendors are picked.", required: true },
      // Several at once - a studio that shoots and edits is both - so it is drawn by the panel's own
      // multi-select (`VendorFormPanel` renderers), held as "Photographer, Editor".
      { name: "vendorType", label: "Vendor Type", type: "custom", required: true },
      { name: "businessRegistrationName", label: "Business Registration Name", helperText: "The vendor's registered business name, as on their bills." },
      { name: "businessStartYear", label: "Business Start Year", helperText: "The year the vendor started in business.", props: { type: "number", min: "1800", max: String(new Date().getFullYear()) } },
      { name: "rating", label: "Rating (1-5)", helperText: "The studio's own rating of their work, from 1 (poor) to 5 (excellent).", props: { type: "number", min: "1", max: "5" } },
    ],
  },
  {
    id: "contact",
    title: "Contact & Address",
    fields: [
      { name: "contactPerson", label: "Contact Person", helperText: "The person to speak to at the vendor." },
      { name: "mobileNumber", label: "Mobile Number", helperText: "The vendor's main phone number for calls.", props: { inputMode: "tel" } },
      { name: "whatsappNumber", label: "WhatsApp Number", helperText: "The number to message the vendor on WhatsApp.", props: { inputMode: "tel" } },
      { name: "alternateNumber", label: "Alternate Number", helperText: "Another number to try if the main one is not answered.", props: { inputMode: "tel" } },
      { name: "email", label: "Email", helperText: "Where to email the vendor about work and payments.", props: { type: "email" } },
      { name: "address", label: "Address", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "tax-bank",
    title: "Tax & Bank Details",
    fields: [
      { name: "gstNumber", label: "GST Number", helperText: "The vendor's GST registration number, as on their invoices." },
      { name: "panNumber", label: "PAN Number", helperText: "The vendor's PAN card number, for tax records." },
      { name: "aadhaarNumber", label: "Aadhaar Number", helperText: "The 12-digit Aadhaar number of the vendor or the business owner.", props: { inputMode: "numeric" } },
      { name: "bankName", label: "Bank Name", helperText: "The bank the vendor is paid into." },
      { name: "accountNumber", label: "Account Number", helperText: "The bank account number the vendor is paid into.", props: { inputMode: "numeric" } },
      { name: "ifscCode", label: "IFSC Code", helperText: "The IFSC of the vendor's bank branch, used with the account number." },
      { name: "upiId", label: "UPI ID", helperText: "The UPI ID to pay the vendor through a payment app." },
    ],
  },
  {
    id: "capabilities",
    title: "Capabilities",
    fields: [
      { name: "preferredLanguages", label: "Preferred Languages", type: "custom", colSpan: 2 },
      { name: "skills", label: "Skills", type: "custom", colSpan: 2 },
      // The studio's branches this vendor works for: branch ids, drawn by the panel's own multi-select.
      { name: "supportedBranchIds", label: "Supported Branches", type: "custom", colSpan: 2 },
      /*
       * One answer of two, and No unless somebody says Yes: a new vendor's form opens with No chosen
       * (`VendorFormPanel`), matching the column's default. Held as "Yes" / "No" by the radio and
       * sent as true / false. Sized as the Interview form's Yes / No radio is, so it sits level with
       * the fields around it.
       */
      {
        name: "canBeProductionTeamMember",
        label: "Can be a production team member?",
        type: "radio",
        options: ["Yes", "No"],
        helperText: "Whether this vendor can work as part of a shoot's production crew.",
        props: {
          className: "text-[11px] font-semibold text-slate-600 sm:text-xs",
          controlClassName: "!mt-1.5 !min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-0",
        },
      },
    ],
  },
  {
    id: "social-reference",
    title: "Social & Reference",
    fields: [
      { name: "website", label: "Website", helperText: "The vendor's website, as a full link.", props: { type: "url" } },
      { name: "instagram", label: "Instagram", helperText: "The vendor's Instagram handle or link, to see their work." },
      { name: "facebook", label: "Facebook", helperText: "The vendor's Facebook page name or link." },
      { name: "referredBy", label: "Referred By", helperText: "Who introduced this vendor to the studio." },
      { name: "remarks", label: "Remarks", helperText: "Optional notes about this vendor.", type: "textarea", colSpan: 2 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Image Selection settings
// ---------------------------------------------------------------------------

/**
 * The ⋮ → Settings form on the Image Selection title bar. Everything here is studio-wide:
 * one record shared by every project, holding the values that used to be hard-coded constants in
 * the backend. A single project's own answers — its validity toggles, its per-item limits — stay in
 * the Selection Settings rail beside the workspace and are not repeated here.
 *
 * Gallery link validity and the default selection limit are stored on the same record but are not
 * offered here: the studio does not set them by hand, so they keep whatever the record holds — the
 * backend defaults of six months and fifty until they are given another value. The form carries
 * them through a save untouched.
 *
 * The Target Download Path is where every file the app saves is filed;
 * `src/lib/projectStorage.mjs` resolves each download beneath it, and no module builds a path of
 * its own.
 */
export const imageSelectionSettingsSections = [
  {
    id: "storage",
    title: "Studio Storage",
    description: "Paths on the machine running the backend, or its accessible NAS share. These are used to read original photos and write approved final albums.",
    columns: 1,
    fields: [
      { name: "originalStoragePath", label: "Original Storage Path", helperText: "The folder the original shoot photos are read from.", placeholder: "D:\\DBS-Originals or \\\\NAS\\Albums", props: { maxLength: 500 } },
      { name: "selectedOutputPath", label: "Final Album Output Path", helperText: "The folder approved final album photos are written to.", placeholder: "D:\\DBS-Selections or \\\\NAS\\Final-Albums", props: { maxLength: 500 } },
    ],
  },
  {
    id: "downloads",
    title: "Downloads",
    columns: 1,
    fields: [
      // Drawn by `TargetDownloadPathField` through `context.renderers`. It holds no form value: the
      // setting is a folder this browser was granted, remembered by `projectStorage`, not a string
      // saved with the record — so it is the one field a save neither reads nor writes. It is where
      // selected originals land when no Selected Output Path is configured above.
      { name: "targetDownloadPath", type: "custom", colSpan: "full" },
    ],
  },
  /*
   * Global Name and Global Logo used to be edited here too.
   *
   * They are studio-wide branding — the top bar, the login page, a quotation's PDF and the client
   * gallery all read them — and they have their own home in Settings → Organization →
   * Branding Logo, behind the same ADMIN / System Settings permission that opens this panel.
   * A second editor for the same two values inside one module's project settings was a place to
   * change the whole studio's name without meaning to.
   *
   * They are still *sent* by this form's save, untouched: the API reads a missing field as an
   * instruction to clear it, so dropping them from the payload would blank the studio's branding
   * everywhere the moment anybody saved a download path. See `ImageSelectionSettingsForm`.
   */
  {
    id: "processing",
    title: "Processing / Compression",
    columns: 1,
    fields: [
      // Drawn by `CompressionSettingsSection` through `context.renderers`. Like the Target
      // Download Path, it holds no form value: the studio's preview and thumbnail presets per
      // Virtual Curation module are their own record (/api/image-selection/compression; the AI
      // Feature's pair its Event Default Settings), saved as each is changed, so a form save
      // neither reads nor writes them. Concurrency is derived from the machine, not chosen.
      { name: "processingSettings", type: "custom", colSpan: "full" },
    ],
  },
  {
    id: "signature-album",
    title: "Signature Album",
    description: "The defaults every new Signature Album starts from. An album already configured keeps its own values.",
    columns: 1,
    fields: [
      // Drawn by `SignatureAlbumSettingsField` through `context.renderers`. Its own record and
      // its own endpoint (/api/image-selection/signature-albums/settings), saved by its own
      // button - like the two entries above, the panel's Save neither reads nor writes it.
      { name: "signatureAlbumSettings", type: "custom", colSpan: "full" },
    ],
  },
  {
    id: "culling-training",
    title: "AI Culling Training",
    description: "Whether finalized culls teach the culling AI. Off until the studio turns it on.",
    columns: 1,
    fields: [
      // Drawn by `CullingTrainingConsentField`: its own record and endpoint
      // (/api/image-selection/culling-learning), saved as the switch moves - Save never touches it.
      { name: "cullingTrainingSettings", type: "custom", colSpan: "full" },
    ],
  },
];

// ---------------------------------------------------------------------------
// CRD terms & conditions settings
// ---------------------------------------------------------------------------

/**
 * The ⋮ → Configure T&C form on the CRD Documents title bar. One rail entry today — `alwaysShowSidebar`
 * keeps the rail on screen anyway, the same way Settings does, because the rail is the map of what
 * this screen covers rather than a way around what is already there.
 *
 * Both fields answer the same record's two columns, one per vertical's public CRD document — see
 * crd-terms-settings/service.js on the backend for the wording a blank column falls back to.
 */
export const crdDumDumTermsSections = [
  {
    id: "dum-dum",
    title: "Dum Dum",
    columns: 1,
    fields: [
      { name: "dumDumTerms", label: "Configure T&C", helperText: "The terms on Dum Dum's public CRD document; left blank, the default wording is used.", type: "textarea", props: { rows: 20 } },
    ],
  },
];

export const crdQuaQuaTermsSections = [
  {
    id: "qua-qua",
    title: "Qua Qua",
    columns: 1,
    fields: [
      { name: "quaQuaTerms", label: "Configure T&C", helperText: "The terms on Qua Qua's public CRD document; left blank, the default wording is used.", type: "textarea", props: { rows: 20 } },
    ],
  },
];

/** Combined sections for the Settings panel — Dum Dum first, then Qua Qua. */
export const crdSettingsSections = [...crdDumDumTermsSections, ...crdQuaQuaTermsSections];

/** @deprecated Use crdSettingsSections / crdDumDumTermsSections / crdQuaQuaTermsSections instead. */
export const crdTermsSettingsSections = crdSettingsSections;

/**
 * What a Pre Production Coordinator fills in for one shoot.
 *
 * The first section is the project and shoot as the studio already knows them, shown read-only:
 * they are stored once on those records and read back through the links, so a pre production row
 * can never disagree with the sale it came from. Everything after it is what pre production finds
 * out afterwards.
 *
 * Event Start and End Time sit here rather than in Add Shoot. They are columns on the shoot itself
 * — Production wants them too — but pre production is the stage that finally knows them, so this is
 * the only form that asks.
 */
import { yesNoField } from "./yesNoField.js";
import { preProductionVerticalFormSection } from "./preProductionVerticalFields.js";
import { endsNextDay } from "../lib/shootBoard.mjs";

/** The three answers pre production gives for the project's hard disk; Client Storage runs on its own. */
export const HARD_DISK_STATUS_OPTIONS = [
  { value: "NOT_RECEIVED", label: "Not Received" },
  { value: "RECEIVED", label: "Received" },
  { value: "HANDED_OVER", label: "Handed Over" },
];

/** What a stored status reads as; a project saved before it was asked reads as Not Received. */
export const hardDiskLabel = (status) => (HARD_DISK_STATUS_OPTIONS.find((option) => option.value === (status || "NOT_RECEIVED"))?.label || "Not Received");

export const preProductionFormSections = [
  {
    id: "context",
    title: "Project & Shoot",
    fields: [
      { name: "contextSummary", type: "custom", colSpan: 2 },
      // Optional, and not counted towards Planned. Squeezed here to what the server keeps (600 KB at
      // 2000px), compressed again there and stored in R2.
      { name: "coverImageUrl", label: "Cover Image", helperText: "Optional picture used as this shoot's cover; it is compressed on upload.", type: "image", colSpan: 2, props: { compress: { maxBytes: 600 * 1024, maxDimension: 2000 } } },
    ],
  },
  {
    id: "concepts",
    title: "Concepts",
    fields: [
      // Asked first; the list opens on Yes. No empties it on save.
      yesNoField("conceptsNeeded", "Concepts Needed", { helperText: "Yes lets you add the concepts planned for this shoot; No clears them." }),
      // As many as the shoot needs, added one by one the way an employee's qualifications are —
      // each its own reference and remarks. Drawn by the form's `concepts` renderer.
      { name: "concepts", type: "custom", colSpan: 2, when: (values) => values.conceptsNeeded === true },
    ],
  },
  {
    id: "travel",
    title: "Travel & Accommodation",
    fields: [
      // Not the same question as the shoot's Travel and Accommodation, which say who *pays*. This
      // asks whether there is anything to arrange at all, and the three fields below only apply
      // once there is. How the crew travels is asked on the production plan, not here.
      yesNoField("travelAccommodationNeeded", "Travel & Accommodation Needed", { helperText: "Yes asks for where the crew will stay; No if there is nothing to arrange." }),
      { name: "accommodationAddress", label: "Accommodation Location Address", helperText: "The full address where the crew will stay.", type: "textarea", colSpan: 2, when: (values) => Boolean(values.travelAccommodationNeeded) },
      { name: "accommodationLink", label: "Accommodation Link", helperText: "A map or booking link for the stay.", colSpan: 2, placeholder: "https://…", props: { type: "url" }, when: (values) => Boolean(values.travelAccommodationNeeded) },
      { name: "accommodationRemarks", label: "Remarks", helperText: "Optional notes about the stay, such as check-in times.", type: "textarea", colSpan: 2, placeholder: "Anything about the stay", when: (values) => Boolean(values.travelAccommodationNeeded) },
    ],
  },
  {
    id: "location",
    title: "Location",
    fields: [
      // Mandatory, and counted: these are the answers a shoot is read as Planned on
      // (`preProductionProgress.mandatoryAnswers`). The asterisk is a mark, not a gate - the form
      // saves half-filled, the way a coordinator fills it over days.
      { name: "locationAddress", label: "Location Address", helperText: "The venue's full address, where the shoot takes place.", type: "textarea", colSpan: 2, required: true, placeholder: "The venue address in full" },
      { name: "locationLink", label: "Location Link", helperText: "A map link to the venue, so the crew can find it.", colSpan: 2, placeholder: "https://…", props: { type: "url" } },
    ],
  },
  {
    id: "timing",
    title: "Event Timing",
    fields: [
      // The shoot's own date - the same one Edit Project shows, kept on the shoot: a change here is seen
      // there, and a date here reads there as Shoot Date Known: Yes.
      { name: "shootDate", label: "Shoot Date", helperText: "The shoot's own date; changing it here changes it in Edit Project too.", type: "date", required: true },
      { name: "eventStartTime", label: "Event Start Time", helperText: "When the event itself begins.", type: "time", required: true },
      // An end earlier than the start runs past midnight - 9:00 PM to 2:00 AM ends the next day - and
      // the label says so the moment it does.
      { name: "eventEndTime", label: (values) => (endsNextDay(values.eventStartTime, values.eventEndTime) ? "Event End Time (next day)" : "Event End Time"), type: "time", required: true, helperText: "When the event ends; a time earlier than the start means the next day." },
      // Earlier than the event start on almost every shoot — the crew is on site before it begins —
      // so it is deliberately not validated against it.
      { name: "reportingTime", label: "Reporting Time", helperText: "When the crew must reach the venue, usually before the event starts.", type: "time", required: true },
      { name: "scheduleRemarks", label: "Remarks", helperText: "Optional notes about the schedule or the journey.", type: "textarea", colSpan: 2, placeholder: "Anything about the schedule or the journey" },
    ],
  },
];

/**
 * The form for one shoot: the shared sections, with the shoot's vertical checklist slotted in
 * straight after Concepts. A vertical with no checklist (Corp, or no vertical set) gets the base
 * form. The Production Coordinator is not asked here - it is named on the shoot's production plan.
 */
export function preProductionFormSectionsFor(product, { indoor = false } = {}) {
  const shared = indoor ? indoorSections(preProductionFormSections) : preProductionFormSections;
  const verticalSection = preProductionVerticalFormSection(product);
  if (!verticalSection) return shared;
  const afterConcepts = shared.findIndex((section) => section.id === "concepts") + 1;
  return [...shared.slice(0, afterConcepts), verticalSection, ...shared.slice(afterConcepts)];
}

/** A venue's field in the form's values: the Location Address or Link of the shoot's `index`th place. */
export const venueFieldName = (key, index) => `${key}:${index}`;

/**
 * A shoot held at several places (Add / Edit Shoot → Location: Multiple) is asked its Location
 * Address and Link under each name, in the name's order, in place of the one pair. `venues` is the
 * row's `locations`; null leaves the form as it is.
 */
export function withShootVenues(sections, venues) {
  if (!venues?.length) return sections;
  return sections.map((section) => (section.id !== "location" ? section : {
    ...section,
    fields: venues.flatMap(({ shoot }, index) => [
      // Each name's Location Link first, then its Location Address.
      { name: venueFieldName("locationLink", index), label: `${shoot} - Location Link`, colSpan: 2, placeholder: "https://…", props: { type: "url" } },
      { name: venueFieldName("locationAddress", index), label: `${shoot} - Location Address`, type: "textarea", colSpan: 2, required: true, placeholder: "The venue address in full" },
    ]),
  }));
}

/**
 * What an indoor shoot (Studio / In-House) is not asked: it happens at the studio, so there is no
 * travel or stay to arrange and no venue to find. In place of the Location it is asked which branch
 * it is held at. (When the crew leaves the studio is Production's to plan, not asked here.)
 *
 * It **is** asked its Shoot Date, as an outdoor shoot is: a studio day still has to be a day, and
 * the coordinator working this form is the one who learns it. The field is the shoot's own, the same
 * one Edit Project shows, so a date set here is seen there.
 */
export const INDOOR_SKIPPED_SECTIONS = ["travel"];
const SHOOT_BRANCH_SECTION = {
  id: "location",
  title: "Shoot Branch",
  fields: [
    // The branches come in the form's context (`options.branches`), as `{ value: id, label: name }`.
    // Mandatory on an indoor shoot, in place of the location an outdoor one is asked for.
    { name: "shootBranchId", label: "Branch", helperText: "The branch where this studio shoot takes place.", type: "select", required: true, placeholder: "Which branch the shoot is at", options: "branches" },
  ],
};
function indoorSections(sections) {
  return sections
    .filter((section) => !INDOOR_SKIPPED_SECTIONS.includes(section.id))
    .map((section) => (section.id === "location" ? SHOOT_BRANCH_SECTION : section));
}

/** The value a field starts at, so a form can be built from its own description. */
export function emptyValues(sections, record) {
  const fields = sections.flatMap((section) => section.fields || []);
  return Object.fromEntries(fields.map((field) => {
    if (field.type === "toggle") return [field.name, Boolean(record?.[field.name])];
    if (field.type === "file") return [field.name, Array.isArray(record?.[field.name]) ? record[field.name] : []];
    return [field.name, record?.[field.name] ?? ""];
  }));
}
