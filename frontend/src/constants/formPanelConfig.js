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
      { name: "assetName", label: "Asset Name", required: true, colSpan: 2, placeholder: "e.g. Wireless lapel mic" },
      { name: "categoryId", label: "Category", type: "select", required: true, placeholder: "Select category", options: categoryOptions, clears: ["subCategoryId"], props: { searchable: true } },
      { name: "subCategoryId", label: "Sub Category", type: "select", options: subCategoryOptions, placeholder: "Select sub category", derive: (value, values, context) => ({ categoryId: parentCategoryId(value, context) || values.categoryId }), props: { searchable: true } },
    ],
  },
  {
    id: "notes",
    title: "Additional Information",
    columns: 1,
    fields: [
      { name: "remarks", label: "Remarks", type: "textarea", placeholder: "Why it is needed, or anything else worth knowing", props: { rows: 4 } },
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
      { name: "remarks", label: "Reason for Rejection", type: "textarea", required: true, placeholder: "e.g. Already available with the Chennai branch", props: { rows: 4 } },
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
      { name: "transitCondition", label: "Current Condition", type: "select", options: "transitConditions", placeholder: "Select condition" },
      { name: "transitDamageRemarks", label: "Damage Remarks" },
      { name: "transitCurrentPhoto", label: "Current Photo", type: "file", colSpan: 2, props: { image: true, accept: ".jpg,.jpeg,.png,.webp" } },
      { name: "transferFrom", label: "Transfer From" },
      { name: "transferTo", label: "Transfer To" },
      { name: "sentBy", label: "Sent By" },
      { name: "sentByPhone", label: "Sender Phone Number", props: { type: "tel" } },
      { name: "receivedBy", label: "Received By" },
      { name: "receivedByPhone", label: "Receiver Phone Number", props: { type: "tel" } },
    ],
  },
  {
    id: "shipment-details",
    title: "Shipment Details",
    fields: [
      { name: "courierService", label: "Courier Service" },
      { name: "trackingNumber", label: "Tracking / Consignment Number" },
      { name: "shipmentDateTime", label: "Shipment Date and Time", type: "date", props: { restriction: "future" } },
      { name: "shipmentEta", label: "Expected Delivery Date (ETA)", type: "date", props: { restriction: "past" } },
      { name: "courierCharge", label: "Courier Charge", props: { type: "number", min: "0", step: "0.01" } },
      { name: "shipmentType", label: "Shipment Type", type: "select", options: "shipmentTypes", placeholder: "Select shipment type" },
      { name: "courierReceipt", label: "Courier Receipt Upload", type: "file", props: { accept: ".pdf,.jpg,.jpeg,.png" } },
      { name: "packagePhoto", label: "Courier Package Photo", type: "file", props: { image: true, accept: ".jpg,.jpeg,.png,.webp" } },
    ],
  },
  {
    id: "transit-remarks",
    title: "Instructions & Remarks",
    fields: [
      { name: "transferReason", label: "Transfer Reason" },
      { name: "specialInstructions", label: "Special Instructions" },
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

/** The hard disc holding a shoot's footage, and the checks done on it. */
export const clientStorageFormSections = [
  {
    id: "shoot",
    title: "Shoot & Project",
    fields: [
      { name: "storageId", label: "SM ID", placeholder: "Generated on save", props: { readOnly: true } },
      { name: "shootId", label: "Shoot ID", type: "select", options: "shoots", placeholder: "Select shoot", props: { searchable: true } },
      // While this is on, a delivered disc returns to "Yet to Receive" for the next shoot instead of
      // finishing. Meant to follow the project's last shoot date once that exists.
      { name: "isShootStatusPending", label: "Shoot Status Pending", type: "toggle" },
      { name: "shootSummary", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "work",
    title: "Work Details",
    fields: [
      { name: "product", label: "Product" },
      { name: "type", label: "Type" },
      { name: "wid", label: "WID" },
      { name: "workType", label: "Work Type" },
    ],
  },
  {
    id: "footage",
    title: "Footage & Storage",
    fields: [
      { name: "footageLocation", label: "Footage Location" },
      { name: "storageType", label: "Storage Type" },
      { name: "footageSize", label: "Footage Size", placeholder: "e.g. 1.2 TB" },
      { name: "hardDiskIn", label: "Hard disk in", type: "select", options: "hardDiskStates", placeholder: "Select status" },
      { name: "footageLink", label: "Footage Link", colSpan: 2, props: { type: "url" } },
      { name: "remarks", label: "Remarks", type: "textarea", colSpan: 2 },
    ],
  },
  {
    id: "hard-disc",
    title: "Hard Disc",
    fields: [
      { name: "hardDiscBrand", label: "Hard Disc Brand" },
      { name: "hardDiscColour", label: "Hard Disc Colour" },
      { name: "hardDiscCapacity", label: "Hard Disc Capacity", placeholder: "e.g. 2 TB" },
      { name: "items", label: "Items" },
    ],
  },
  {
    id: "checks",
    title: "Checks",
    fields: clientStorageChecks.map(([name, label]) => ({ name, label, type: "toggle" })),
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
        { name: "workType", label: "Work Type", required: true },
        { name: "footageLocation", label: "Footage Location", required: true },
        { name: "storageType", label: "Storage Type", required: true },
        { name: "footageLink", label: "Footage Link", props: { type: "url" } },
      ] },
      { id: "hard-disc", title: "Hard Disc", fields: [
        { name: "hardDiscBrand", label: "Hard Disc Brand", required: true },
        { name: "hardDiscColour", label: "Hard Disc Colour" },
        { name: "hardDiscCapacity", label: "Hard Disc Capacity", required: true, placeholder: "e.g. 2 TB" },
        { name: "items", label: "Items" },
      ] },
      { id: "checks", title: "Checks", fields: [{ name: "labeled", label: "Labeled?", type: "toggle" }] },
      { id: "remarks", title: "Remarks", fields: [{ name: "remarks", label: "Remarks", type: "textarea", colSpan: 2 }] },
    ],
  },
  "Footage Backup Done": {
    description: "Confirm the footage backup that has been taken.",
    sections: [
      { id: "record", title: "Storage Record", summary: storageSummary },
      { id: "backup", title: "Footage Backup", fields: [
        { name: "footageSize", label: "Footage Size", required: true, placeholder: "e.g. 1.2 TB" },
        { name: "footageBackup", label: "Footage Backup", type: "toggle" },
        { name: "finalFilesCopy", label: "Final Files Copy", type: "toggle" },
        { name: "harddiskFootagesBackup", label: "Harddisk Footages Back up", type: "toggle" },
      ] },
    ],
  },
  "HDD Out": {
    description: "Make the closing checks before this hard disc goes out.",
    sections: [
      { id: "record", title: "Storage Record", summary: storageSummary },
      { id: "checks", title: "Final Checks", fields: [
        { name: "folderStructureChecked", label: "Folder Structure Checked", type: "toggle" },
        { name: "finalRenders", label: "Final Renders", type: "toggle" },
        { name: "otherFilesInHarddisk", label: "Other Files in Harddisk", type: "toggle" },
      ] },
      { id: "location", title: "Location", fields: [
        { name: "hardDiskIn", label: "Hard disk in", type: "select", options: "hardDiskStates", placeholder: "Select status" },
        // Compressed in the browser before upload, the same as every other image field.
        { name: "hddOutPhoto", label: "Proof of Done", type: "file", colSpan: 2, props: { image: true, maxFiles: 1, accept: ".jpg,.jpeg,.png,.webp" } },
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
      { name: "receivedBy", label: "Received By" },
      { name: "handedOverTo", label: "Handed Over To" },
      { name: "receivedDate", label: "Received Date", type: "date", props: { restriction: "future" } },
      { name: "condition", label: "Condition", type: "select", options: "assetConditions", placeholder: "Select condition" },
      { name: "receivedRemarks", label: "Damage / Received Remarks", type: "textarea", colSpan: 2 },
      { name: "receivedCourierPhoto", label: "Received Courier Photo", type: "file", props: { image: true, accept: imageTypes } },
      { name: "currentPhoto", label: "Current Photo", type: "file", props: { image: true, accept: imageTypes } },
    ],
  },
  {
    id: "repair-details",
    title: "Repair Details",
    when: forAction("UNDER_REPAIR"),
    fields: [
      { name: "issueCategory", label: "Issue Category", required: true },
      { name: "severity", label: "Severity", type: "select", required: true, options: "assetRepairSeverities", placeholder: "Select severity" },
      { name: "problemDescription", label: "Problem Description", type: "textarea", required: true, colSpan: 2 },
      { name: "repairAssignee1Id", label: "Assignee 1", type: "select", required: true, options: "people", placeholder: "Select first employee", props: { searchable: true } },
      { name: "repairAssignee2Id", label: "Assignee 2", type: "select", required: true, options: "people", placeholder: "Select second employee", props: { searchable: true } },
      { name: "reportedById", label: "Reported By", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
      { name: "reportedDate", label: "Reported Date", type: "date", required: true, props: { restriction: "future" } },
      { name: "repairedPhotos", label: "Repaired Photos", type: "file", colSpan: 2, props: { image: true, accept: imageTypes } },
    ],
  },
  {
    id: "service-details",
    title: "Service Details",
    when: forAction("IN_SERVICE"),
    fields: [
      // Choosing the vendor fills in where it is, so the record of the service says where the asset
      // went without anyone typing the address again.
      { name: "vendorName", label: "Vendor Name", type: "select", required: true, options: "vendors", placeholder: "Select active vendor", props: { searchable: true }, derive: (value, values, context) => ({ vendorAddress: vendorAddressLine(context?.vendorsByName?.[value]) }) },
      // A plain line like the fields around it: the address is read, not written, so it needs no
      // more room than any other value on the form.
      { name: "vendorAddress", label: "Vendor Address", props: { readOnly: true, title: "Vendor address" } },
      { name: "estimatedCost", label: "Estimated Cost", props: { type: "number", min: "0" } },
      { name: "estimatedCompletionDate", label: "Estimated Completion Date", type: "date", props: { restriction: "past" } },
      { name: "remarks", label: "Remarks", type: "textarea" },
    ],
  },
  {
    id: "service-completion",
    title: "Service Completion",
    when: (values, context) => context.serviceToActive,
    fields: [
      { name: "receivedOn", label: "Received On", type: "date", required: true, props: { restriction: "future" } },
      { name: "serviceCost", label: "Cost", required: true, props: { type: "number", min: "0", step: "0.01" } },
      { name: "receivedAndReviewedById", label: "Received and Reviewed By", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
      { name: "handoverToId", label: "Handover To", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
    ],
  },
  {
    id: "assignment-details",
    title: "Assignment Details",
    when: (values, context) => context.unassignedToActive,
    fields: [
      { name: "assignedToId", label: "Assigned To", type: "select", required: true, options: "people", placeholder: "Select employee", props: { searchable: true } },
      { name: "assignedOn", label: "Assigned On", type: "date", required: true, props: { restriction: "future" } },
      // Asked for here because unassigning the asset cleared it: the manager is who answers for the
      // asset while it is out, so handing it back out is the moment to say who that is again. Not
      // required, since an asset can be created without one.
      { name: "managerId", label: "Manager", type: "select", options: "people", placeholder: "Select employee", props: { searchable: true } },
    ],
  },
  {
    id: "condition-transfer",
    title: "Condition & Transfer",
    when: forAction("IN_TRANSIT"),
    fields: [
      { name: "condition", label: "Current Condition", type: "select", options: "assetConditions", placeholder: "Select condition" },
      { name: "damageRemarks", label: "Damage Remarks" },
      { name: "currentPhoto", label: "Current Photo", type: "file", colSpan: 2, props: { image: true, accept: imageTypes } },
      { name: "transferFrom", label: "Transfer From" },
      { name: "transferTo", label: "Transfer To" },
      { name: "sentBy", label: "Sent By" },
      { name: "sentByPhone", label: "Sender Phone Number" },
      { name: "receivedBy", label: "Received By" },
      { name: "receivedByPhone", label: "Receiver Phone Number" },
    ],
  },
  {
    id: "shipment-details",
    title: "Shipment Details",
    when: forAction("IN_TRANSIT"),
    fields: [
      { name: "courierService", label: "Courier Service" },
      { name: "trackingNumber", label: "Tracking / Consignment Number" },
      { name: "shipmentDateTime", label: "Shipment Date and Time", type: "date", props: { restriction: "future" } },
      { name: "eta", label: "Expected Delivery Date (ETA)", type: "date", props: { restriction: "past" } },
      { name: "courierCharge", label: "Courier Charge", props: { type: "number", min: "0" } },
      { name: "shipmentType", label: "Shipment Type", type: "select", options: "assetShipmentTypes", placeholder: "Select shipment type" },
      { name: "courierReceipt", label: "Courier Receipt Upload", type: "file", props: { accept: ".pdf,.jpg,.jpeg,.png" } },
      { name: "packagePhoto", label: "Courier Package Photo", type: "file", props: { image: true, accept: imageTypes } },
    ],
  },
  {
    id: "transit-remarks",
    title: "Instructions & Remarks",
    when: forAction("IN_TRANSIT"),
    fields: [
      { name: "reason", label: "Transfer Reason", type: "textarea" },
      { name: "specialInstructions", label: "Special Instructions", type: "textarea" },
    ],
  },
  {
    id: "sold-details",
    title: "Sold Details",
    when: forAction("SOLD"),
    fields: [
      { name: "soldByName", label: "Sold By Name", required: true },
      { name: "soldByEmployeeId", label: "Sold By Employee ID" },
      { name: "soldTo", label: "Sold To Name", required: true },
      { name: "soldToContact", label: "Sold To Contact", required: true, props: { type: "tel" } },
      { name: "soldDate", label: "Sold Date", type: "date", required: true, props: { restriction: "future" } },
      { name: "soldPrice", label: "Sold Price", required: true, props: { type: "number", min: "0", step: "0.01" } },
    ],
  },
  {
    id: "status-reason",
    title: "Reason & Remarks",
    // The statuses that only want to know why, plus cancelling a repair that was never needed.
    when: (values, context) => context.generic || context.cancellation,
    fields: [
      { name: "lostByName", label: "Lost By Name", required: true, when: forAction("LOST") },
      { name: "reason", type: "textarea", required: true, colSpan: 2, label: (values, context) => context.cancellation ? "Cancellation Reason" : `${assetStatusTitles[context.action]} Reason and Remarks` },
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
      { name: "vendorId", label: "Vendor ID", placeholder: "Generated on save", props: { readOnly: true } },
      { name: "vendorName", label: "Vendor Name", required: true },
      { name: "vendorType", label: "Vendor Type", type: "select", required: true, options: "vendorTypes", placeholder: "Select vendor type", props: { searchable: true } },
      { name: "businessRegistrationName", label: "Business Registration Name" },
      { name: "businessStartYear", label: "Business Start Year", props: { type: "number", min: "1800", max: String(new Date().getFullYear()) } },
      { name: "rating", label: "Rating (1-5)", props: { type: "number", min: "1", max: "5" } },
    ],
  },
  {
    id: "contact",
    title: "Contact & Address",
    fields: [
      { name: "contactPerson", label: "Contact Person" },
      { name: "mobileNumber", label: "Mobile Number", props: { inputMode: "tel" } },
      { name: "whatsappNumber", label: "WhatsApp Number", props: { inputMode: "tel" } },
      { name: "alternateNumber", label: "Alternate Number", props: { inputMode: "tel" } },
      { name: "email", label: "Email", props: { type: "email" } },
      { name: "address", label: "Address", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "tax-bank",
    title: "Tax & Bank Details",
    fields: [
      { name: "gstNumber", label: "GST Number" },
      { name: "panNumber", label: "PAN Number" },
      { name: "aadhaarNumber", label: "Aadhaar Number", props: { inputMode: "numeric" } },
      { name: "bankName", label: "Bank Name" },
      { name: "accountNumber", label: "Account Number", props: { inputMode: "numeric" } },
      { name: "ifscCode", label: "IFSC Code" },
      { name: "upiId", label: "UPI ID" },
    ],
  },
  {
    id: "capabilities",
    title: "Capabilities",
    fields: [
      { name: "preferredLanguages", label: "Preferred Languages", type: "custom", colSpan: 2 },
      { name: "skills", label: "Skills", type: "custom", colSpan: 2 },
    ],
  },
  {
    id: "social-reference",
    title: "Social & Reference",
    fields: [
      { name: "website", label: "Website", props: { type: "url" } },
      { name: "instagram", label: "Instagram" },
      { name: "facebook", label: "Facebook" },
      { name: "referredBy", label: "Referred By" },
      { name: "remarks", label: "Remarks", type: "textarea", colSpan: 2 },
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
      { name: "originalStoragePath", label: "Original Storage Path", placeholder: "D:\\DBS-Originals or \\\\NAS\\Albums", props: { maxLength: 500 } },
      { name: "selectedOutputPath", label: "Final Album Output Path", placeholder: "D:\\DBS-Selections or \\\\NAS\\Final-Albums", props: { maxLength: 500 } },
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
    title: "Processing",
    columns: 1,
    fields: [
      // Drawn by `ProcessingSettingsField` through `context.renderers`. Like the Target Download
      // Path, it holds no form value: the preview quality belongs to this browser and saves
      // itself as it changes (concurrency is derived from the machine, not chosen), so a form
      // save neither reads nor writes it.
      { name: "processingSettings", type: "custom", colSpan: "full" },
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
      { name: "dumDumTerms", label: "Configure T&C", type: "textarea", props: { rows: 20 } },
    ],
  },
];

export const crdQuaQuaTermsSections = [
  {
    id: "qua-qua",
    title: "Qua Qua",
    columns: 1,
    fields: [
      { name: "quaQuaTerms", label: "Configure T&C", type: "textarea", props: { rows: 20 } },
    ],
  },
];

/** Combined sections for the Settings panel — Dum Dum first, then Qua Qua. */
export const crdSettingsSections = [...crdDumDumTermsSections, ...crdQuaQuaTermsSections];

/** @deprecated Use crdSettingsSections / crdDumDumTermsSections / crdQuaQuaTermsSections instead. */
export const crdTermsSettingsSections = crdSettingsSections;

/** The value a field starts at, so a form can be built from its own description. */
export function emptyValues(sections, record) {
  const fields = sections.flatMap((section) => section.fields || []);
  return Object.fromEntries(fields.map((field) => {
    if (field.type === "toggle") return [field.name, Boolean(record?.[field.name])];
    if (field.type === "file") return [field.name, Array.isArray(record?.[field.name]) ? record[field.name] : []];
    return [field.name, record?.[field.name] ?? ""];
  }));
}
