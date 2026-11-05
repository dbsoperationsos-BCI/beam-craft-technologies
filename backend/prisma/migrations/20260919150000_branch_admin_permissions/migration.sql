-- The Admin Permission set: one studio-wide permission matrix carried by every role marked as a
-- branch administrator (`role.is_branch_manager`).
--
-- One of these, not one per role. Two branch administrators in two branches do the same job in two
-- places; what differs between them is the branch list on their own role, which this does not
-- touch. So the studio decides once what the job may reach, and editing it changes what every
-- branch administrator may do without a single role being re-saved.
--
-- `permission_id` is UNIQUE: one access level per permission is the only sensible reading of the
-- set, and the index is where that belongs rather than in a comment. A permission with no row here
-- grants nothing through this route.
--
-- ON DELETE CASCADE, because a retired permission cannot go on being granted by anything. It
-- matches `role_permission`, which is the table this one is modelled on.
--
-- Empty on arrival. A new set grants nobody anything until somebody opens Admin Permission in Role
-- Management and saves one, which is the direction this has to fail in: shipping a table that
-- silently widened every branch administrator the moment it was created would be a permission
-- change nobody asked for.
CREATE TABLE `branch_admin_permission` (
  `id` VARCHAR(191) NOT NULL,
  `permission_id` VARCHAR(191) NOT NULL,
  `access_level` VARCHAR(20) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `branch_admin_permission_permission_id_key` (`permission_id`),
  INDEX `branch_admin_permission_permission_id_idx` (`permission_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `branch_admin_permission`
  ADD CONSTRAINT `branch_admin_permission_permission_id_fkey`
  FOREIGN KEY (`permission_id`) REFERENCES `permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
