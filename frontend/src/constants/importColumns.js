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

const column = (field, label, required = false) => ({ field, label, required });

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
  column("branch", "Branch", true),
  column("paymentMode", "Payment Mode", true),
  column("clientName", "Client Name"),
  column("paidTo", "Paid To"),
  column("transactionId", "Transaction ID"),
  column("paymentModeOther", "Payment Mode Details"),
  column("receivedAccount", "Received Account"),
  column("paidFromAccount", "Paid From Account"),
  column("handlerName", "Handled By"),
  column("description", "Description"),
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
