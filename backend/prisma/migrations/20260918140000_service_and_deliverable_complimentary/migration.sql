-- Whether a service or a deliverable is given rather than charged for.
--
-- Settings → Project asks **Complimentary** of both, and a quotation copies the master's answer
-- onto a line as the line is added. The two are independent of each other: a complimentary service
-- does not make its deliverables complimentary, and a deliverable brought in by a service keeps its
-- own answer rather than the service's.
--
-- It is copied, not read live. Once a line is on a quotation the answer is that line's, so the
-- person building the quotation may change it for that quotation alone - it never writes back here -
-- and changing it here never moves a quotation already raised.
--
-- NULL on every row already here, which reads as No: only TRUE is complimentary, so every service
-- and every deliverable goes on behaving exactly as it does today until somebody answers Yes.
-- Nothing is read, rewritten or recreated by this.
--
-- Written by hand and applied with `prisma migrate deploy`.

ALTER TABLE `project_service_definition`
  ADD COLUMN `complimentary` BOOLEAN NULL AFTER `deliverable_added`;

ALTER TABLE `project_deliverable_definition`
  ADD COLUMN `complimentary` BOOLEAN NULL AFTER `size_option_set_id`;
