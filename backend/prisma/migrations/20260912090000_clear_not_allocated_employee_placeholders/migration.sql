-- "Not Allocated" was never an answer, so it stops being stored as one.
--
-- The onboarding submission wrote the literal string "Not Allocated" into an employee's
-- `designation`, `department` and `vertical`, standing for "the studio has not chosen yet". It is on
-- none of the three dropdowns Review Employee offers, and `SchemaFormFields` adds a stored value it
-- cannot find back into the options rather than losing it - so the sentinel arrived on the review
-- form as a *selected* option in a required field. HR could approve a record without ever choosing,
-- and the register then held a designation no dropdown offers.
--
-- The write is gone (see `submittedEmployeeData` in modules/hrm/onboarding-invites/controller.js).
-- This clears what it already wrote, so the candidates currently waiting to be reviewed behave like
-- the ones submitted after it: an empty required field showing its own "Select Department"
-- placeholder, which HR has to answer before the record can be saved.
--
-- NULL is what the application already takes this to mean. `DATA-SCOPE.md` records that
-- `employee.vertical` holding "Not Allocated" is not a vertical and resolves to NULL, and
-- `vertical_id` beside it is already NULL on every one of these rows - nothing is being decided
-- here that was not already the reading.
--
-- Matched exactly, on the one spelling the code wrote, so a genuine answer that merely resembles it
-- is untouched. Only these three columns: the sentinel was never written anywhere else. Applying it
-- twice does nothing, since the second run matches no rows.

UPDATE `employee` SET `designation` = NULL WHERE `designation` = 'Not Allocated';
UPDATE `employee` SET `department`  = NULL WHERE `department`  = 'Not Allocated';
UPDATE `employee` SET `vertical`    = NULL WHERE `vertical`    = 'Not Allocated';
