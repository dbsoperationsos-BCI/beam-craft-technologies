-- Keep the user who last changed each pre-production row as a navigable audit reference.
ALTER TABLE `project_pre_production`
  ADD CONSTRAINT `project_pre_production_updated_by_user_id_fkey`
  FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
