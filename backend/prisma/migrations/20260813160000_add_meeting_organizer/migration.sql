-- Who booked the meeting, as the Google account the calendar event was created on. Stored
-- rather than derived from createdByUserId because the CRM user and the connected Google
-- account are not the same identity, and the panel needs to name the person whose calendar
-- actually holds the event and who is hosting the Meet.
ALTER TABLE `SalesCrmMeeting` ADD COLUMN `organizerEmail` VARCHAR(191) NULL;
