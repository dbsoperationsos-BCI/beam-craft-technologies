-- The terms & conditions text each CRD document vertical shows, moved out of the frontend bundle
-- so it can be edited from the CRD Documents screen instead of shipping as a code change.
--
-- One row, keyed "default", the same idiom as `app_monitoring_settings`, `image_selection_settings`
-- and `sales_quotation_settings`. Both text columns are seeded NULL rather than with the wording
-- that shipped with the feature - that wording lives once, in the read path's own default, so it
-- never has to be kept in step with a copy sitting in this migration too.
CREATE TABLE `sales_crd_terms_settings` (
  `id` VARCHAR(30) NOT NULL DEFAULT 'default',
  `dum_dum_terms` TEXT NULL,
  `qua_qua_terms` TEXT NULL,
  `updated_by_user_id` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `sales_crd_terms_settings` (`id`) VALUES ('default');
