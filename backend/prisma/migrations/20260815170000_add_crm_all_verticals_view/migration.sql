-- All three verticals in one grid.
--
-- The per-vertical views answer "show me Corp", but browsing `SalesCrmLead` itself does not:
-- Qua Qua is 14,635 of its 14,665 rows, so the first page of any unordered SELECT is Qua Qua
-- and the other two verticals look absent. They are not - there are 21 Dum Dum leads and 9
-- Corp ones, sitting further down a table nobody scrolls to the end of.
--
-- This view puts the vertical in a column, first, so all three can be seen together and
-- either filtered or sorted on in Workbench. It carries every heading any vertical shows -
-- 56 of them - because the columns are all on the one underlying table regardless of which
-- vertical happens to display them.
--
-- Read only, like the others: it holds no data and cannot change a lead.
--
-- Generated alongside the per-vertical views from branchTableColumns in
-- frontend/src/components/sales/CRMPage.js.

-- All three verticals in one grid, with a Vertical column to tell them apart and to filter on.
CREATE OR REPLACE VIEW `vw_crm_leads_all` AS
SELECT
  CASE
    WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) = 'quaqua' THEN 'Qua Qua'
    WHEN LOWER(REPLACE(TRIM(COALESCE(`branch`,'')),' ','')) IN ('corp','corporate','corporation') THEN 'Corp'
    ELSE 'Dum Dum' END AS `Vertical`,
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
  `source` AS `Source`,
  `addedTime` AS `Added Timestamp`,
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
  `shootCity` AS `Shoot City`,
  `expectedBudget` AS `Expected Budget`,
  `competitions` AS `Competitions`
FROM `SalesCrmLead`
WHERE `deletedAt` IS NULL;
