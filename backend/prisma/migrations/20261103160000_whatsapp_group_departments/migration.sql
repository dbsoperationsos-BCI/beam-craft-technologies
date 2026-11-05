-- A WhatsApp group in Settings → Employee → WhatsApp Groups now says which departments it belongs to.
--
-- A join table rather than a column on the group, because one group serves several departments: an
-- "All Managers" group covers Sales and Production alike, and it is still one group on WhatsApp.
--
-- The department is an id with a key, never its name, so a renamed department keeps its groups
-- (CLAUDE.md Rule 5). Both sides cascade: a group deleted takes its claims with it, and so does a
-- department removed from the register - neither leaves a row pointing at nothing.
--
-- **Nothing is backfilled.** Every group that exists today ends up belonging to no department, which
-- is the honest answer: nobody has said which department any of them is for. A group with no
-- department is never one onboarding adds anybody to, so this cannot start adding people anywhere by
-- itself.
--
-- Cost: one empty table and two indexes. Instant, and nothing is locked.

CREATE TABLE `employee_whatsapp_group_department` (
  `group_id` INTEGER NOT NULL,
  `department_id` INTEGER NOT NULL,

  INDEX `employee_whatsapp_group_department_department_id_idx`(`department_id`),
  PRIMARY KEY (`group_id`, `department_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `employee_whatsapp_group_department`
  ADD CONSTRAINT `employee_whatsapp_group_department_group_id_fkey`
  FOREIGN KEY (`group_id`) REFERENCES `employee_whatsapp_group`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `employee_whatsapp_group_department`
  ADD CONSTRAINT `employee_whatsapp_group_department_department_id_fkey`
  FOREIGN KEY (`department_id`) REFERENCES `department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
