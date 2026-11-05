-- HRM → Payroll → Main Page → Payment → Cost Centre: the branch a row's pay is booked to.
--
-- Chosen per row from every active branch of the organisation, after Freeze in the Payment band. A
-- link to the branch, never its name: a renamed branch is read through it. Empty until chosen - every
-- existing row is left without one, so nothing is guessed. Removing a branch clears the cost centre
-- of the rows booked to it rather than refusing the removal.
--
-- Cost: one nullable column, its index and its key on `payroll_entry`. No row is rewritten.

ALTER TABLE `payroll_entry` ADD COLUMN `cost_centre_branch_id` INTEGER NULL;

CREATE INDEX `payroll_entry_cost_centre_branch_id_idx` ON `payroll_entry`(`cost_centre_branch_id`);

ALTER TABLE `payroll_entry` ADD CONSTRAINT `payroll_entry_cost_centre_branch_id_fkey` FOREIGN KEY (`cost_centre_branch_id`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
