-- The three CRM verticals, readable in MySQL Workbench.
--
-- Every field the CRM shows already lives in `SalesCrmLead`, but as one flat table of raw
-- column names - `babyOrMotherName`, `ihOh`, `assignedBranch` - with nothing to say which
-- heading each one is, or which vertical shows it. Reading a lead in Workbench meant knowing
-- the frontend by heart.
--
-- These are three read-only views, one per vertical, each selecting only that vertical's
-- columns, in the order the CRM shows them, under the heading the CRM prints. They hold no
-- data of their own and cannot change a lead; `SalesCrmLead` is untouched and remains the
-- only place anything is stored.
--
-- The row filters mirror BRANCH_SQL in backend/src/modules/sales/crm-leads/leadQueryService.js,
-- including its rule that a blank or unrecognised branch belongs to Dum Dum. The column
-- expressions mirror COLUMN_SQL in the same file plus the shoot fallbacks getLeadCellValue
-- applies, so a cell here reads what the same cell reads in the CRM. Soft-deleted leads are
-- excluded, as they are everywhere else.
--
-- Generated from branchTableColumns in frontend/src/components/sales/CRMPage.js. If a column
-- is added to a vertical there, re-run that generation rather than editing these by hand.

-- Dum Dum: the 29 headings its CRM table shows, in the order it shows them.
CREATE OR REPLACE VIEW `vw_crm_leads_dum_dum` AS
SELECT
  `enquiryId` AS `Enquiry ID`,
  COALESCE(NULLIF(`date`,''), `addedTime`) AS `Enquiry Date`,
  `addedTime` AS `Added Time`,
  `name` AS `Enquiry Name`,
  `phone` AS `Phone Number`,
  `relationship` AS `Relationship`,
  CASE LOWER(TRIM(COALESCE(`status`, '')))
      WHEN '' THEN 'Interested'
      WHEN 'follow-up' THEN 'Followup'
      WHEN 'followup' THEN 'Followup'
      WHEN 'in review' THEN 'CNA'
      WHEN 'cna' THEN 'CNA'
      WHEN 'followup & converted' THEN 'Converted & Followup'
      WHEN 'followup and converted' THEN 'Converted & Followup'
      WHEN 'converted & followup' THEN 'Converted & Followup'
      ELSE `status` END AS `Status`,
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
  COALESCE(NULLIF(`eventPlannedType`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].shootType')), 'null') END) AS `Type of Event Planned`,
  COALESCE(NULLIF(`eventPlannedDate`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].date')), 'null') END) AS `When is the Event Planned`,
  `groomName` AS `Groom Name`,
  `groomContact` AS `Groom Contact`,
  `groomLocation` AS `Groom Location`,
  `brideName` AS `Bride Name`,
  `brideContact` AS `Bride Contact`,
  `brideLocation` AS `Bride Location`,
  `referenceName` AS `Referenced Person Name`,
  `referenceContact` AS `Referenced Person Contact`,
  `remarks` AS `Remarks`,
  `source` AS `Source`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL AND (TRIM(COALESCE(`branch`,'')) = '' OR LOWER(REPLACE(TRIM(`branch`),' ','')) NOT IN ('quaqua','corp','corporate','corporation'));

-- Qua Qua: the 31 headings its CRM table shows, in the order it shows them.
CREATE OR REPLACE VIEW `vw_crm_leads_qua_qua` AS
SELECT
  `enquiryId` AS `Enquiry ID`,
  COALESCE(NULLIF(`date`,''), `addedTime`) AS `Enquiry Date`,
  `name` AS `Enquiry Name`,
  `addedTime` AS `Added Timestamp`,
  `phone` AS `Phone Number`,
  CASE LOWER(TRIM(COALESCE(`status`, '')))
      WHEN '' THEN 'Interested'
      WHEN 'follow-up' THEN 'Followup'
      WHEN 'followup' THEN 'Followup'
      WHEN 'in review' THEN 'CNA'
      WHEN 'cna' THEN 'CNA'
      WHEN 'followup & converted' THEN 'Converted & Followup'
      WHEN 'followup and converted' THEN 'Converted & Followup'
      WHEN 'converted & followup' THEN 'Converted & Followup'
      ELSE `status` END AS `Status`,
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
  COALESCE(NULLIF(`eventPlannedType`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].shootType')), 'null') END) AS `Type of Event Planned`,
  COALESCE(NULLIF(`eventPlannedDate`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].date')), 'null') END) AS `When is the Event Planned`,
  `contactRepeated` AS `Contact Repeated`,
  COALESCE(NULLIF(`shootType`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].shootType')), 'null') END) AS `Shoot Type`,
  COALESCE(NULLIF(`location`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].venue')), 'null') END, CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].districtState')), 'null') END) AS `Location`,
  `ihOh` AS `IH/OH`,
  `lastFollowUpDate` AS `Last Followup Date`,
  `nextFollowUpDate` AS `Next followup Date`,
  `lastConvertedDate` AS `Last Converted Date`,
  `shootId` AS `Shoot ID`,
  COALESCE(NULLIF(`date`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].date')), 'null') END) AS `Date`,
  `babyOrMotherName` AS `Baby (or) Mother Name`,
  `dateOfBirthOrEdod` AS `Date of Birth (or) EDOD`,
  COALESCE(NULLIF(`contactNumber`,''), `phone`) AS `Contact`,
  `source` AS `Source`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) = 'quaqua';

-- Corp: the 33 headings its CRM table shows, in the order it shows them.
CREATE OR REPLACE VIEW `vw_crm_leads_corp` AS
SELECT
  `enquiryId` AS `Enquiry ID`,
  COALESCE(NULLIF(`date`,''), `addedTime`) AS `Enquiry Date`,
  `name` AS `Enquiry Name`,
  `addedTime` AS `Added Timestamp`,
  `phone` AS `Phone Number`,
  CASE LOWER(TRIM(COALESCE(`status`, '')))
      WHEN '' THEN 'Interested'
      WHEN 'follow-up' THEN 'Followup'
      WHEN 'followup' THEN 'Followup'
      WHEN 'in review' THEN 'CNA'
      WHEN 'cna' THEN 'CNA'
      WHEN 'followup & converted' THEN 'Converted & Followup'
      WHEN 'followup and converted' THEN 'Converted & Followup'
      WHEN 'converted & followup' THEN 'Converted & Followup'
      ELSE `status` END AS `Status`,
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
  COALESCE(NULLIF(`contactNumber`,''), `phone`) AS `Contact Number`,
  `alternateMobileNumber` AS `Alternate Mobile Number`,
  `officialEmailId` AS `Official Email ID`,
  `companyWebsite` AS `Company Website`,
  `companyType` AS `Company Type`,
  `companySize` AS `Company Size`,
  `branches` AS `Branches`,
  `projectType` AS `Project Type`,
  COALESCE(NULLIF(`location`, ''), CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].venue')), 'null') END, CASE WHEN JSON_VALID(`shoots`) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`shoots`, '$[0].districtState')), 'null') END) AS `Location`,
  `shootCity` AS `Shoot City`,
  `expectedBudget` AS `Expected Budget`,
  `competitions` AS `Competitions`,
  `remarks` AS `Remarks`,
  `source` AS `Source`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL AND LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) IN ('corp','corporate','corporation');

