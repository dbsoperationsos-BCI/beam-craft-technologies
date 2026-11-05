/**
 * The columns each module's Import accepts, and the template it offers.
 *
 * The browser's copy of what the server already declares - `VENDOR_IMPORT_COLUMNS` and its siblings
 * in each module's controller - so a file can be judged, and its template written, before anything
 * is uploaded. The server checks the same thing again on arrival; this is the courtesy, not the
 * guard, and a drift between the two costs a confusing message rather than a bad import.
 *
 * `required` means the *column* must be present, not that every row must fill it in. What a row
 * must carry is each module's own schema, which answers per row and names the column it is about.
 */

/**
 * `aliases` are the headings a column used to be called.
 *
 * A heading is matched by name, so a column renamed stops being found in files the studio saved
 * before the rename - and because most columns are not required, the import then succeeds with that
 * field quietly empty. The old spelling keeps reading; the template and every message print the
 * current one. The server's own list carries the same aliases.
 */
/*
 * Carried only where there is one, so a column without aliases is the same three keys it always was.
 * `test/pre-production-import.test.js` on the server compares these lists with the backend's own
 * field for field, and an empty array on every column here made every list differ from its pair.
 */
const column = (field, label, required = false, aliases = []) => ({
  field,
  label,
  required,
  ...(aliases.length ? { aliases } : {}),
});

export const VENDOR_IMPORT_COLUMNS = [
  column("vendorName", "Vendor Name", true),
  column("vendorType", "Vendor Type", true),
  column("contactPerson", "Contact Person"),
  column("mobileNumber", "Mobile Number"),
  column("whatsappNumber", "WhatsApp Number"),
  column("alternateNumber", "Alternate Number"),
  column("email", "Email"),
  column("gstNumber", "GST Number"),
  column("panNumber", "PAN Number"),
  column("businessRegistrationName", "Business Registration Name"),
  column("address", "Address"),
  column("area", "Area"),
  column("city", "City"),
  column("district", "District"),
  column("state", "State"),
  column("country", "Country"),
  column("pincode", "Pincode"),
  column("bankName", "Bank Name"),
  column("accountNumber", "Account Number"),
  column("ifscCode", "IFSC Code"),
  column("upiId", "UPI ID"),
  column("website", "Website"),
  column("instagram", "Instagram"),
  column("facebook", "Facebook"),
  column("businessStartYear", "Business Start Year"),
  column("preferredLanguages", "Preferred Languages"),
  column("skills", "Skills"),
  column("canBeProductionTeamMember", "Can Be a Production Team Member"),
  column("rating", "Rating"),
  column("referredBy", "Referred By"),
  column("remarks", "Remarks"),
];

/*
 * Branch is named rather than chosen from a list, because a spreadsheet holds "Erode" and not the
 * id behind it. The server resolves it and refuses a row naming a branch the studio does not have.
 */
export const ASSET_IMPORT_COLUMNS = [
  column("assetName", "Asset Name", true),
  column("branchName", "Branch", true),
  column("categoryName", "Category"),
  column("company", "Company"),
  column("serialNumber", "Serial Number"),
  column("specification", "Specification"),
  column("color", "Colour"),
  column("purchaseDate", "Purchase Date"),
  column("purchasePrice", "Purchase Price"),
  column("purchasedFrom", "Purchased From"),
  column("invoiceNumber", "Invoice Number"),
  column("warrantyMonths", "Warranty (Months)"),
  column("inspectionPeriodMonths", "Inspection Period (Months)"),
  column("lastInspectedDate", "Last Inspected Date"),
  column("insuranceDetails", "Insurance Details"),
  column("insuranceExpiry", "Insurance Expiry"),
  column("remarks", "Remarks"),
];

export const CLIENT_STORAGE_IMPORT_COLUMNS = [
  column("product", "Product"),
  column("type", "Type"),
  column("wid", "WID"),
  column("workType", "Work Type"),
  column("footageLocation", "Footage Location"),
  column("storageType", "Storage Type"),
  column("footageLink", "Footage Link"),
  column("hardDiscBrand", "Hard Disc Brand"),
  column("hardDiscColour", "Hard Disc Colour"),
  column("hardDiscCapacity", "Hard Disc Capacity"),
  column("items", "Items"),
  column("footageSize", "Footage Size"),
  column("hardDiskIn", "Hard Disk In"),
  column("remarks", "Remarks"),
];

/*
 * Employee ID is deliberately not a column: it is minted from the studio's own counter inside the
 * create transaction, so a file cannot bring one and cannot collide with one already issued.
 */
export const EMPLOYEE_IMPORT_COLUMNS = [
  column("employeeName", "Employee Name", true),
  column("employmentStatus", "Employment Status"),
  column("contactNumber", "Contact Number"),
  column("emailId", "Email ID"),
  column("dateOfJoining", "Date of Joining"),
  column("designation", "Designation"),
  column("department", "Department"),
  column("vertical", "Vertical"),
  column("workBaseLocation", "Work Base Location"),
  column("currentWorkLocation", "Current Work Location"),
  column("workType", "Work Type"),
  column("skills", "Skills"),
  column("languagesKnown", "Languages Known"),
  column("bloodGroup", "Blood Group"),
  column("gender", "Gender"),
  column("dateOfBirth", "Date of Birth"),
  column("currentAddress", "Current Address"),
  column("permanentAddress", "Permanent Address"),
  column("emergencyContactName", "Emergency Contact Name"),
  column("emergencyContactNumber", "Emergency Contact Number"),
];

/*
 * Branch is required and is asked for by no form: an entry's branch is normally the Source Branch of
 * the project it is filed against, and a spreadsheet carries no project id - so an imported entry
 * names its branch directly.
 */
export const CASH_ENTRY_IMPORT_COLUMNS = [
  column("entryType", "Entry Type", true),
  column("entryDate", "Entry Date", true),
  column("category", "Category", true),
  column("amount", "Amount", true),
  // Only for a row filed against no project: one with a project takes the project's branch.
  column("branch", "Branch"),
  column("paymentMode", "Payment Mode", true),
  // The project's WhatsApp group name, in full - what files the row against its project.
  column("clientName", "Client Name"),
  // Which project, when two share a group name; wins whenever it is given.
  column("eventId", "Event ID"),
  column("paidTo", "Paid To"),
  column("transactionId", "Transaction ID"),
  // A remark about the payment mode, as against the Description below, which is about the payment.
  column("paymentModeOther", "Remarks", false, ["Payment Mode Details"]),
  column("receivedAccount", "Received Account"),
  column("paidFromAccount", "Paid From Account"),
  column("handlerName", "Handled By"),
  column("description", "Description"),
  // Which open scheduled payment a receipt settles, by its category; with a Balance Due Date it is
  // part of it, and the rest falls due on that day. Blank: not tied to the schedule.
  column("scheduledPayment", "Scheduled Payment"),
  column("balanceDueDate", "Balance Due Date"),
];

/*
 * An interview candidate. Mirrors `INTERVIEW_IMPORT_COLUMNS` in
 * `backend/src/modules/hrm/interview/controller.js`, so a file is judged and its template written
 * before anything is uploaded; the server checks the same thing again on arrival.
 *
 * The status is a column a file may carry, and an unknown word in it is kept as typed rather than
 * refused - a recruiter's spreadsheet has its own vocabulary for a stage, and the register shows
 * such a candidate under All rather than losing them.
 */
export const INTERVIEW_IMPORT_COLUMNS = [
  column("name", "Candidate Name", true),
  column("phone", "Phone"),
  column("email", "Email"),
  column("whatsappNumber", "WhatsApp Number"),
  column("position", "Position Applied For"),
  column("department", "Department"),
  column("employmentType", "Employment Type"),
  column("experience", "Experience"),
  column("currentCompany", "Current Company"),
  column("currentDesignation", "Current Designation"),
  column("currentCtc", "Current CTC"),
  column("howYouKnowUs", "How They Know Us"),
  column("aboutUs", "What They Know About Us"),
  column("minExpectedCtc", "Least Expected CTC"),
  column("expectedCtc", "Expected CTC"),
  column("noticePeriod", "Notice Period"),
  column("availableFrom", "Available From"),
  column("highestQualification", "Highest Qualification"),
  column("skills", "Skills"),
  column("languagesKnown", "Languages Known"),
  column("gender", "Gender"),
  column("dateOfBirth", "Date of Birth"),
  column("city", "City"),
  column("nativePlace", "Native Place"),
  column("currentLocation", "Current Location"),
  column("state", "State"),
  column("address", "Address"),
  column("branch", "Branch"),
  column("source", "Source"),
  column("campaignName", "Campaign Name"),
  column("adsetName", "Adset Name"),
  column("adName", "Ad Name"),
  column("referredBy", "Referred By"),
  column("status", "Status"),
  column("interviewer", "Interviewer"),
  column("interviewDate", "Interview Scheduled On"),
  column("interviewTime", "Interview Time"),
  column("interviewMode", "Interview Mode"),
  column("meetLink", "Meet Link"),
  column("appliedDate", "Applied On"),
  column("nextFollowUpDate", "Next Follow-up Date"),
  column("portfolioUrl", "Portfolio Link"),
  column("resumeUrl", "Resume Link"),
  column("remarks", "Remarks"),
];

/*
 * A booking - the record Sales Manager calls a booking and Project Management calls a project.
 *
 * Its shoots are not here: a shoot is a row of its own with its own services and deliverables, and
 * flattening a variable number of them into one line is how a template becomes unusable. They are
 * added to the project afterwards, which is where the form adds them too.
 */
export const PROJECT_IMPORT_COLUMNS = [
  column("enquiryId", "Enquiry ID", true),
  column("whatsappGroupName", "WhatsApp Group Name", true),
  column("clientMainNumber", "Client Main Number", true),
  column("sourceBranch", "Source Branch", true),
  column("initialConvertedValue", "Initial Converted Value", true),
  column("vertical", "Vertical"),
  column("mainEventDate", "Main Event Date"),
  column("deliverables", "Deliverables"),
  column("deliverablesDetails", "Deliverables Details"),
  column("salesPreProductionRemarks", "Sales Pre Production Remarks"),
  column("salesProductionRemarks", "Sales Production Remarks"),
  column("salesPostProductionRemarks", "Sales Post Production Remarks"),
];

/**
 * Pre Production → Import, one template per vertical (`WED`, `QQ`, `CORP`).
 *
 * One row per shoot of the studio's old sheet: the booking's columns repeat on every shoot of it,
 * people are named by Employee Code, and dates are DD-MM-YYYY. The server's copy, and the rules each
 * cell answers to, are in `backend/src/modules/project-management/pre-production/importColumns.js`; a
 * backend test fails if this list and that one differ.
 */
const PRE_PRODUCTION_PROJECT_COLUMNS = [
  column("sheetEventId", "Event ID", true),
  column("whatsappGroupName", "Client Name", true),
  column("clientMainNumber", "Client Number", true),
  column("sourceBranch", "Branch", true),
  column("initialConvertedValue", "Initial Converted Value"),
  column("projectStatus", "Project Status"),
  column("crmCode", "CRM Employee Code", true),
  column("projectManagerCode", "Project Manager Employee Code"),
  column("preProductionCoordinatorCode", "Pre Production Coordinator Employee Code", true),
  column("creativeManagerCode", "Creative Manager Employee Code"),
  column("postProductionCoordinatorCode", "Post Production Coordinator Employee Code"),
  column("productionManagerCode", "Production Manager Employee Code"),
];

const preProductionShootColumns = (vertical) => [
  column("sheetShootId", "Shoot ID", true),
  column("shoot", "Shoot Name", true),
  column("dateCreated", "Shoot Date"),
  column("isMainEvent", "Main Event"),
  column("shootPlace", "Shoot Place", true),
  column("district", "District", true),
  column("state", "State", true),
  column("shootTypes", "Shoot Type", true),
  column("sessionTimings", "Session Timing", true),
  column("sessionDurationHours", "Session Hours"),
  ...(vertical === "WED" ? [column("preference", "Preference")] : []),
  column("eventStartTime", "Event Start Time"),
  column("eventEndTime", "Event End Time"),
];

const PRE_PRODUCTION_SHARED_COLUMNS = [
  column("locationAddress", "Location Address"),
  column("locationLink", "Location Link"),
  column("reportingTime", "Reporting Time"),
  column("studioStartDate", "Studio Start Date"),
  column("studioStartTime", "Studio Start Time"),
  column("scheduleRemarks", "Schedule Remarks"),
  column("conceptReference", "Concept Reference"),
  column("conceptRemarks", "Concept Remarks"),
  column("travelAccommodationNeeded", "Travel & Accommodation Needed"),
  column("accommodationAddress", "Accommodation Address"),
  column("accommodationLink", "Accommodation Link"),
  column("accommodationRemarks", "Accommodation Remarks"),
];

const PRE_PRODUCTION_CHECKLIST_COLUMNS = {
  WED: [
    column("introCallRemarks", "Intro Call Remarks"),
    column("gettingDressesImages", "Getting Dresses Images"),
    column("shootCompletionMessage", "Shoot Completion Message"),
    column("groomAddress", "Groom Address"),
    column("brideAddress", "Bride Address"),
    column("introCallGroom", "Intro Call Groom"),
    column("introCallBride", "Intro Call Bride"),
    column("eventScheduleMeeting", "Event Schedule Meeting"),
    column("meetingDate", "Meeting Date"),
    column("meetingTime", "Meeting Time"),
    column("meetingLink", "Meeting Link"),
    column("invitationSoftCopy", "Invitation Soft Copy"),
    column("invitationLink", "Invitation Link"),
    column("gettingDecorImages", "Getting Decor Images"),
    column("siteVisit", "Site Visit"),
    column("teamReachedMessage", "Team Reached Message"),
    column("postWeddingGift", "Post Wedding Gift"),
  ],
  QQ: [
    column("introCallRemarks", "Intro Call Remarks"),
    column("introCall", "Intro Call"),
    column("gettingDressesImages", "Getting Dresses Images"),
    column("shootCompletionMessage", "Shoot Completion Message"),
  ],
  CORP: [],
};

export const preProductionImportColumns = (vertical) => [
  ...PRE_PRODUCTION_PROJECT_COLUMNS,
  ...preProductionShootColumns(vertical),
  ...PRE_PRODUCTION_SHARED_COLUMNS,
  ...(PRE_PRODUCTION_CHECKLIST_COLUMNS[vertical] || []),
  ...PRE_PRODUCTION_PROJECT_ANSWERS,
];

/*
 * The project's own answers, last because they belong to the booking rather than to the shoot each
 * row carries: one booking's rows all repeat them. The two gifts and Storage Needed are the General
 * panel's "does this apply" answers; Storage Needed = Yes raises the project's Client Storage record.
 */
const PRE_PRODUCTION_PROJECT_ANSWERS = [
  column("welcomeGift", "Welcome Gift"),
  column("shootCompletedGift", "Shoot Completed Gift"),
  column("welcomeGiftCode", "Welcome Gift Assignee Employee Code"),
  column("shootCompletedGiftCode", "Shoot Completed Gift Assignee Employee Code"),
  column("salesPreProductionRemarks", "Sales Pre Production Remarks"),
  column("salesProductionRemarks", "Sales Production Remarks"),
  column("salesPostProductionRemarks", "Sales Post Production Remarks"),
  column("projectValidityMonths", "Project Validity (In Months)"),
  column("storageNeeded", "Storage Needed"),
  column("storageReceived", "Received The Storage"),
  column("projectCreatedAt", "Date Created"),
];

/** How each cell is written, shown in the import dialog beside the template. */
export const PRE_PRODUCTION_IMPORT_HINTS = [
  "Preference (Dum Dum only): Groom, Bride or Both. Left empty, the shoot covers Both.",
];


/**
 * Production → Import, one row per shoot of the studio's old production sheet, linked by the sheet's
 * Shoot ID to the shoot Pre Production → Import made. The same columns for every vertical; the
 * vertical chosen is checked against each shoot. The server's copy is
 * `backend/src/modules/project-management/production/importColumns.js`; a backend test fails if
 * the two differ.
 */
export const PRODUCTION_IMPORT_COLUMNS = [
  column("sheetShootId", "Shoot ID", true),
  column("sheetEventId", "Event ID"),
  column("productionCoordinatorCode", "Production Coordinator Employee Code"),
  column("teamCodes", "Production Team Employee Codes"),
  column("travelMode", "Travel Mode"),
  column("travelModeOther", "Travel Mode Other"),
  column("vehicleNumberPlate", "Vehicle Number Plate"),
  column("remarks", "Plan Remarks"),
  column("planSubmitted", "Plan Submitted"),
  column("currentStep", "Production Step"),
  column("shootStatus", "Shoot Status"),
  column("shootStatusRemarks", "Shoot Status Remarks"),
  column("footageUrl", "Footage Location"),
  column("footageBackupCode", "Footage Backup By Employee Code"),
  column("fileCount", "File Count"),
  column("size", "Size"),
  column("firstFileName", "First File Name"),
  column("lastFileName", "Last File Name"),
  column("footageRemarks", "Footage Remarks"),
];

export const PRODUCTION_IMPORT_HINTS = [
  "Import Pre Production first. Each row's Shoot ID is the sheet's own, the same one used there, and links the row to that shoot.",
  "A shoot has production only once its project has a Production Manager - give one in the Pre Production import.",
  "People: the Employee Code from HRM → Employees, or the name as HRM has it. Somebody who has left can be written by name - it is kept as written. Several team members: separate them with commas.",
  "IN OLD SHEET, WCR, NA, N/A, NIL, #REF!, TBD and blank cells all come in empty.",
  "Travel Mode: Bus, Train, Flight, Own, Car or Other. Own and Car need the Vehicle Number Plate; Other needs Travel Mode Other. An office vehicle is set on the board.",
  "Plan Submitted: Yes or No. Left blank, a plan with a Production Coordinator is submitted.",
  "Production Step: the step the shoot reached - Started to shoot, Reached venue, Pineapple meeting, Shoot started, Happening now, Happy clients, File in - or Done. A sheet written before these were renamed still reads.",
  "Shoot Status: Started, Paused, On Hold, Rejected or Completed. A finished shoot is Completed with the step Done.",
  "File in (Footage Location to Last File Name): fill in all of it or none. It is the last step, so the shoot is taken as Done. A sheet still headed Footage URL reads as before.",
  "Uploading the file again fills in only what is still empty; it never overwrites and never moves a shoot back a step.",
];
