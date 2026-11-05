-- The offboarding form asks the two dates a resignation is made of, in the separation's own words.
--
-- It asked "from when are you serving notice" and stored the notice end beside it. The form the
-- studio actually uses asks for the **resignation date** - defaulted to today - and shows the
-- **proposed last working day** worked out from it and the notice period HR set, which the employee
-- may move if they are asking to leave earlier. So `notice_start_date` becomes `resignation_date`
-- and `expected_last_working_date` becomes `proposed_last_working_date`, matching
-- `employee_separation`'s own columns, and nothing is left holding two names for one day.
--
-- Where the notice period ends is no longer a column at all: it is the resignation date plus the
-- days on the form (`lastWorkingDateFrom`), computed on every read. Stored, it would be the figure
-- that disagreed with the arithmetic the moment either input was corrected.
--
-- A rename rather than a drop and add, so any form already filled in keeps its dates. Both columns
-- are nullable and only a form that has been submitted carries values, so this cannot fail on
-- production data.
ALTER TABLE `employee_offboarding_invite`
  RENAME COLUMN `notice_start_date` TO `resignation_date`,
  RENAME COLUMN `expected_last_working_date` TO `proposed_last_working_date`;
