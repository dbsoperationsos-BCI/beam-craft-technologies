-- Vendor Type takes several values: Vendors -> Add Vendor -> Business Details is a multi-select now.
--
-- They are stored the way an employee's Skills are, in the one column joined by ", "
-- ("Photographer, Editor"), and the Vendor Types master-data list reads the column entry by entry
-- (`match: "csv"` in hrm/master-data/definitions.js) for its usage count and its renames.
--
-- Only the column's width changes: 100 characters held one type, 500 holds several and still fits
-- the index already on it (utf8mb4, 2,000 bytes against MySQL's 3,072). Widening never truncates and
-- never fails on existing data - every vendor's single type is already a valid one-entry list.
--
-- No permission changes: the field belongs to the same Vendor screen and endpoints as before.
--
-- Cost: one ALTER on the vendor table. Widening past 255 characters changes the column's length
-- prefix, so MySQL rebuilds the table rather than altering it in place - a quick rebuild on a table
-- of this size. Collation and the index on the column are kept.

ALTER TABLE `vendor` MODIFY `vendor_type` VARCHAR(500) NOT NULL;
