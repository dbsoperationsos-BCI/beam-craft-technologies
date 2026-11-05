/**
 * The CRM lead table's columns, in both spellings.
 *
 * Pulled out of crmLeadService so that every module writing raw SQL against the lead table reads
 * one list. It used to live there alone while googleSheetsService kept a camelCase copy of its
 * own - and when the database was converted to snake_case, the copy was not, so the sheet import
 * asked MySQL for a column called `enquiryId` and was told it did not exist.
 *
 * Prisma Client needs none of this: it applies the `@map` names in schema.prisma itself. Raw SQL
 * gets no such translation, which is the whole reason this file exists.
 */

/**
 * Every lead column, written as [ name the code uses, column the database has ].
 *
 * The database is snake_case; this module is camelCase. `schema.prisma` maps the two with `@map`
 * and Prisma applies that itself, but raw SQL gets no such translation — a query naming
 * "enquiryId" asks for a column that does not exist. Both spellings are therefore written out
 * here, side by side: the record shape and every key in this module keep the first, and the SQL
 * below is built from the second.
 *
 * Keep the two in step. Adding a column means adding both halves of its pair.
 */
const CRM_LEAD_COLUMN_PAIRS = [
  ["name", "name"],
  ["phone", "phone"],
  // The number the client is actually messaged on, which is not always the one they enquired
  // from - a landline, an office line, or a second phone. Asked for on every vertical.
  ["whatsappNumber", "whatsapp_number"],
  // The vertical - Dum Dum, Qua Qua, Corp. Both halves say so now; the column was called `branch`
  // until September 2026 and never held one. The lead's branch is `assignedBranch` below.
  ["vertical", "vertical"],
  ["status", "status"],
  ["crm", "crm"],
  ["addedTime", "added_time"],
  ["createdDate", "created_date"],
  ["relationship", "relationship"],
  ["referredFrom", "referred_from"],
  ["offerType", "offer_type"],
  ["campaignName", "campaign_name"],
  ["adsetName", "adset_name"],
  ["adName", "ad_name"],
  ["preferredBudget", "preferred_budget"],
  // What the studio reckons this lead is worth. Asked for on every vertical, unlike the two
  // budget columns beside it - Preferred Budget is what the client said, Estimated Value is
  // what the studio thinks.
  ["estimatedValue", "estimated_value"],
  ["city", "city"],
  ["state", "state"],
  ["source", "source"],
  ["assignedBranch", "assigned_branch"],
  ["eventPlannedType", "event_planned_type"],
  ["eventPlannedDate", "event_planned_date"],
  ["groomName", "groom_name"],
  ["groomContact", "groom_contact"],
  ["groomLocation", "groom_location"],
  ["brideName", "bride_name"],
  ["brideContact", "bride_contact"],
  ["brideLocation", "bride_location"],
  ["referenceName", "reference_name"],
  ["referenceContact", "reference_contact"],
  ["remarks", "remarks"],
  ["attachments", "attachments"],
  ["contactRepeated", "contact_repeated"],
  ["shootType", "shoot_type"],
  ["location", "location"],
  ["ihOh", "ih_oh"],
  ["lastFollowUpDate", "last_follow_up_date"],
  ["nextFollowUpDate", "next_follow_up_date"],
  ["lastConvertedDate", "last_converted_date"],
  // How many unanswered attempts this lead has had. Stored, because the count is the whole
  // point of CNA - it decides when the lead stops being chased, so it has to survive a
  // reload. It was previously sent by the CRM and silently dropped here, which is why the
  // number always read as though the lead had never been called.
  ["cnaSequence", "cna_sequence"],
  ["shootId", "shoot_id"],
  ["date", "date"],
  ["babyOrMotherName", "baby_or_mother_name"],
  ["dateOfBirthOrEdod", "date_of_birth_or_edod"],
  ["companyName", "company_name"],
  ["primaryDecisionMaker", "primary_decision_maker"],
  ["designation", "designation"],
  ["contactNumber", "contact_number"],
  ["alternateMobileNumber", "alternate_mobile_number"],
  ["officialEmailId", "official_email_id"],
  ["companyWebsite", "company_website"],
  ["companyType", "company_type"],
  ["companySize", "company_size"],
  ["branches", "branches"],
  ["projectType", "project_type"],
  ["shootCity", "shoot_city"],
  ["expectedBudget", "expected_budget"],
  ["competitions", "competitions"],
  ["sourceEnquiryId", "source_enquiry_id"],
  ["sourceRowNumber", "source_row_number"],
  ["spreadsheetId", "spreadsheet_id"],
  ["gid", "gid"],
  ["targetTab", "target_tab"],
  ["systemTableId", "system_table_id"],
  ["lastSourceSyncAt", "last_source_sync_at"],
  ["nextFollowUpTime", "next_follow_up_time"],
  ["shoots", "shoots"],
  ["remarkEntries", "remark_entries"],
  ["customFields", "custom_fields"],
];

// The database column for a given code name, for the handful of columns named on their own.
/**
 * The references beside the text: which branch, vertical and employee the text names, as ids.
 * Read with every lead and kept in step on every write by the write paths (see `syncCrmLeadColumns`),
 * never typed by a caller - so they are not in the pairs above, which are the columns a record
 * carries as text.
 */
const REFERENCE_COLUMN_PAIRS = [
  ["branchId", "branch_id"],
  ["verticalId", "vertical_id"],
  ["ownerEmployeeId", "owner_employee_id"],
];
const REFERENCE_COLUMNS = REFERENCE_COLUMN_PAIRS.map(([codeName]) => codeName);

const DB_COLUMN = Object.fromEntries([
  ...CRM_LEAD_COLUMN_PAIRS,
  ...REFERENCE_COLUMN_PAIRS,
  ["enquiryId", "enquiry_id"],
  ["deletedAt", "deleted_at"],
  ["createdAt", "created_at"],
  ["updatedAt", "updated_at"],
]);

module.exports = { CRM_LEAD_COLUMN_PAIRS, REFERENCE_COLUMN_PAIRS, REFERENCE_COLUMNS, DB_COLUMN };
