-- A project's Shoot List can be dragged into the order the studio wants (Bookings & Converted,
-- Create / Edit / Start Project). The position is kept per shoot; null - every existing shoot - keeps
-- the list in date order, as it has always been. Nothing else reads it: Pre Production, Production,
-- the calendar and Image Selection keep listing shoots by date.
ALTER TABLE `project_shoot` ADD COLUMN `sort_order` INTEGER NULL;
