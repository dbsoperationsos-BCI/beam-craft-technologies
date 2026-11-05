-- Number Plate is no longer asked for in Pre-Production's Dum Dum vertical fields. Dropped rather
-- than left unread, since nothing on the form or the API writes or reads it any more.
ALTER TABLE `project_pre_production`
  DROP COLUMN `number_plate`;
