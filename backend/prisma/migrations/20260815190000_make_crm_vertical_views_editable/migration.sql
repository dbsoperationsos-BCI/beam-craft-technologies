-- Make the three vertical views editable in both directions.
--
-- They were built to read well: Status printed the label the CRM prints, Shoot Type fell back
-- to the shoots JSON, Enquiry Date coalesced two columns. Every one of those is an expression,
-- and MySQL will not accept an UPDATE through an expression column - so the views could be
-- browsed but not worked in.
--
-- What was asked for is that a change made in Workbench shows up in the CRM and the other way
-- round. That means every column has to be a plain reference to a real column of
-- `SalesCrmLead`, which is what this rebuild does. A view over a single table with no
-- aggregate, DISTINCT, GROUP BY or UNION is updatable, so UPDATE and DELETE through these
-- reach the actual row.
--
-- The trade is display fidelity: Status now shows what is stored - blank rather than
-- "Interested" for a lead nobody has set - and Shoot Type shows its own column rather than the
-- first shoot row. That is the honest picture of the data, and it is the only version that can
-- be written to.
--
-- Two things worth knowing before editing here:
--
--   * DELETE through a view is a real delete. The CRM soft-deletes by stamping `deletedAt`;
--     a DELETE in Workbench removes the row outright and it cannot be recovered from the
--     application. It will disappear from the CRM, which is what was wanted, but there is no
--     undo. To soft-delete instead, and keep the row recoverable:
--         UPDATE `SalesCrmLead` SET `deletedAt` = NOW() WHERE `enquiryId` = '...';
--
--   * Editing `Verticals` moves a lead between verticals, so the row leaves the view it was
--     edited in and appears in another. No CHECK OPTION is set, so this is allowed.
--
-- Generated from branchTableColumns in frontend/src/components/sales/CRMPage.js.

-- Dum Dum: 30 columns, every one writable.
CREATE OR REPLACE VIEW `vw_crm_leads_dum_dum` AS
SELECT
  `enquiryId` AS `Enquiry ID`,
  `createdDate` AS `Enquiry Date`,
  `addedTime` AS `Added Time`,
  `name` AS `Enquiry Name`,
  `phone` AS `Phone Number`,
  `relationship` AS `Relationship`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assignedBranch` AS `Nearest Branch`,
  `referredFrom` AS `Referred From`,
  `offerType` AS `Offer Type`,
  `campaignName` AS `Campaign Name`,
  `adsetName` AS `Adset Name`,
  `adName` AS `Ad Name`,
  `preferredBudget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `eventPlannedType` AS `Type of Event Planned`,
  `eventPlannedDate` AS `When is the Event Planned`,
  `groomName` AS `Groom Name`,
  `groomContact` AS `Groom Contact`,
  `groomLocation` AS `Groom Location`,
  `brideName` AS `Bride Name`,
  `brideContact` AS `Bride Contact`,
  `brideLocation` AS `Bride Location`,
  `referenceName` AS `Referenced Person Name`,
  `referenceContact` AS `Referenced Person Contact`,
  `remarks` AS `Remarks`,
  `source` AS `Source`,
  `branch` AS `Verticals`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL AND (TRIM(COALESCE(`branch`,'')) = '' OR LOWER(REPLACE(TRIM(`branch`),' ','')) NOT IN ('quaqua','corp','corporate','corporation'));

-- Qua Qua: 32 columns, every one writable.
CREATE OR REPLACE VIEW `vw_crm_leads_qua_qua` AS
SELECT
  `enquiryId` AS `Enquiry ID`,
  `createdDate` AS `Enquiry Date`,
  `name` AS `Enquiry Name`,
  `addedTime` AS `Added Timestamp`,
  `phone` AS `Phone Number`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assignedBranch` AS `Nearest Branch`,
  `offerType` AS `Offer Type`,
  `campaignName` AS `Campaign Name`,
  `adsetName` AS `Adset Name`,
  `adName` AS `Ad Name`,
  `referredFrom` AS `Referred From`,
  `preferredBudget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `eventPlannedType` AS `Type of Event Planned`,
  `eventPlannedDate` AS `When is the Event Planned`,
  `contactRepeated` AS `Contact Repeated`,
  `shootType` AS `Shoot Type`,
  `location` AS `Location`,
  `ihOh` AS `IH/OH`,
  `lastFollowUpDate` AS `Last Followup Date`,
  `nextFollowUpDate` AS `Next followup Date`,
  `lastConvertedDate` AS `Last Converted Date`,
  `shootId` AS `Shoot ID`,
  `date` AS `Date`,
  `babyOrMotherName` AS `Baby (or) Mother Name`,
  `dateOfBirthOrEdod` AS `Date of Birth (or) EDOD`,
  `contactNumber` AS `Contact`,
  `source` AS `Source`,
  `branch` AS `Verticals`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) = 'quaqua';

-- Corp: 34 columns, every one writable.
CREATE OR REPLACE VIEW `vw_crm_leads_corp` AS
SELECT
  `enquiryId` AS `Enquiry ID`,
  `createdDate` AS `Enquiry Date`,
  `name` AS `Enquiry Name`,
  `addedTime` AS `Added Timestamp`,
  `phone` AS `Phone Number`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assignedBranch` AS `Nearest Branch`,
  `referredFrom` AS `Referred From`,
  `offerType` AS `Offer Type`,
  `campaignName` AS `Campaign Name`,
  `adsetName` AS `Adset Name`,
  `adName` AS `Ad Name`,
  `preferredBudget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `companyName` AS `Company Name (or) Client organisation`,
  `primaryDecisionMaker` AS `Primary decision-maker - Contact`,
  `designation` AS `Designation`,
  `contactNumber` AS `Contact Number`,
  `alternateMobileNumber` AS `Alternate Mobile Number`,
  `officialEmailId` AS `Official Email ID`,
  `companyWebsite` AS `Company Website`,
  `companyType` AS `Company Type`,
  `companySize` AS `Company Size`,
  `branches` AS `Branches`,
  `projectType` AS `Project Type`,
  `location` AS `Location`,
  `shootCity` AS `Shoot City`,
  `expectedBudget` AS `Expected Budget`,
  `competitions` AS `Competitions`,
  `remarks` AS `Remarks`,
  `source` AS `Source`,
  `branch` AS `Verticals`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) IN ('corp','corporate','corporation');

-- All three verticals. Every column writable except `Vertical`, which is derived from
-- `branch` - edit `Verticals` to move a lead.
CREATE OR REPLACE VIEW `vw_crm_leads_all` AS
SELECT
  CASE
    WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) = 'quaqua' THEN 'Qua Qua'
    WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) IN ('corp','corporate','corporation') THEN 'Corp'
    ELSE 'Dum Dum' END COLLATE utf8mb4_unicode_ci AS `Vertical`,
  `enquiryId` AS `Enquiry ID`,
  `createdDate` AS `Enquiry Date`,
  `addedTime` AS `Added Time`,
  `name` AS `Enquiry Name`,
  `phone` AS `Phone Number`,
  `relationship` AS `Relationship`,
  `status` AS `Status`,
  `crm` AS `CRM`,
  `assignedBranch` AS `Nearest Branch`,
  `referredFrom` AS `Referred From`,
  `offerType` AS `Offer Type`,
  `campaignName` AS `Campaign Name`,
  `adsetName` AS `Adset Name`,
  `adName` AS `Ad Name`,
  `preferredBudget` AS `Preferred Budget`,
  `city` AS `City`,
  `state` AS `State`,
  `eventPlannedType` AS `Type of Event Planned`,
  `eventPlannedDate` AS `When is the Event Planned`,
  `groomName` AS `Groom Name`,
  `groomContact` AS `Groom Contact`,
  `groomLocation` AS `Groom Location`,
  `brideName` AS `Bride Name`,
  `brideContact` AS `Bride Contact`,
  `brideLocation` AS `Bride Location`,
  `referenceName` AS `Referenced Person Name`,
  `referenceContact` AS `Referenced Person Contact`,
  `remarks` AS `Remarks`,
  `source` AS `Source`,
  `addedTime` AS `Added Timestamp`,
  `contactRepeated` AS `Contact Repeated`,
  `shootType` AS `Shoot Type`,
  `location` AS `Location`,
  `ihOh` AS `IH/OH`,
  `lastFollowUpDate` AS `Last Followup Date`,
  `nextFollowUpDate` AS `Next followup Date`,
  `lastConvertedDate` AS `Last Converted Date`,
  `shootId` AS `Shoot ID`,
  `date` AS `Date`,
  `babyOrMotherName` AS `Baby (or) Mother Name`,
  `dateOfBirthOrEdod` AS `Date of Birth (or) EDOD`,
  `contactNumber` AS `Contact`,
  `companyName` AS `Company Name (or) Client organisation`,
  `primaryDecisionMaker` AS `Primary decision-maker - Contact`,
  `designation` AS `Designation`,
  `contactNumber` AS `Contact Number`,
  `alternateMobileNumber` AS `Alternate Mobile Number`,
  `officialEmailId` AS `Official Email ID`,
  `companyWebsite` AS `Company Website`,
  `companyType` AS `Company Type`,
  `companySize` AS `Company Size`,
  `branches` AS `Branches`,
  `projectType` AS `Project Type`,
  `shootCity` AS `Shoot City`,
  `expectedBudget` AS `Expected Budget`,
  `competitions` AS `Competitions`,
  `branch` AS `Verticals`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL;
