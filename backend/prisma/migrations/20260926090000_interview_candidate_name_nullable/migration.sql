-- A candidate may arrive without a name.
--
-- A linked sheet no longer refuses a row because one of its cells cannot be read: the cell is
-- stored empty and the rest of the row is kept, because a candidate is worth more than a tidy
-- column. `name` was the one field that could not honour that - `VARCHAR(191) NOT NULL` - so a
-- nameless row was written as `''` instead, which on this schema is the one thing a blank must
-- never be: `''` never means "none" here, and anything asking `name IS NOT NULL` would have read
-- those rows as named.
--
-- `sales_crm_lead.name` has always been nullable, so this only brings the register into line with
-- the board beside it.
--
-- Safe to replay and safe on live data: widening a NOT NULL column to NULL rewrites no row and
-- rejects none. The rows already holding `''` from before this change are left exactly as they are
-- rather than converted - they are somebody's real history, and rewriting them here would be a
-- second, silent change nobody asked for.
ALTER TABLE `hrm_interview_candidate`
  MODIFY COLUMN `name` VARCHAR(191) NULL;
