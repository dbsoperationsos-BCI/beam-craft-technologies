-- The studio starts its Services and Deliverables from nothing, and writes its own.
--
-- Settings → Project opened on forty services and thirty-eight deliverables the seed had put there.
-- The studio does not want them: the two name boxes no longer suggest anything, and the tables under
-- them are to start empty so its own names are the only ones in the application.
--
-- They are **retired**, not deleted - `is_active = 0`, which is exactly what the ⋮ menu's own Delete
-- does to one row, applied to all of them at once. Both screens read `where isActive: true`, so they
-- go blank; nothing else changes:
--
--   * the twenty-five post-production workflow definitions hanging off services survive, where a
--     hard delete would have cascaded through and taken every one of them with it;
--   * the twelve project rows that point at a definition keep pointing at it, so work already
--     booked still reads as it did;
--   * `Acrylic Printing`'s brand and its ₹123,233 variant survive with it.
--
-- And it is reversible. A row is retired, not gone, so putting one back is a single UPDATE - and the
-- application already does that by itself: typing a retired name into Add Service or Add Deliverable
-- finds the row by its `code` and restores it, id and every setting intact, answering "restored
-- successfully" rather than creating a second one. A studio that retypes "Album Printing" gets its
-- own row back rather than a duplicate.
--
-- Only rows that are currently active are touched, so running this twice changes nothing the second
-- time and a row the studio has deliberately brought back is not retired again by a replay.
--
-- The seed is left as it is. It only ever runs against a database being created, and it upserts by
-- `code`, so it neither reverses this nor duplicates anything.
--
-- Written by hand and applied with `prisma migrate deploy`.

UPDATE `project_service_definition` SET `is_active` = 0 WHERE `is_active` = 1;

UPDATE `project_deliverable_definition` SET `is_active` = 0 WHERE `is_active` = 1;
