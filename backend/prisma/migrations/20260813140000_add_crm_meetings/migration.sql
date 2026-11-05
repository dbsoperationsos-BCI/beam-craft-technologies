-- Meetings booked against a CRM lead. The Google Calendar event holds the Meet link; this
-- row is the CRM's own copy, so the lead keeps its meeting history even if the event is
-- deleted in Google, and the panel can list meetings without calling Google every time.
CREATE TABLE `SalesCrmMeeting` (
  `id` VARCHAR(191) NOT NULL,
  `enquiryId` VARCHAR(100) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `startAt` DATETIME(3) NOT NULL,
  `endAt` DATETIME(3) NOT NULL,
  `attendees` TEXT NULL,
  `googleEventId` VARCHAR(191) NULL,
  `googleCalendarId` VARCHAR(191) NULL,
  `meetLink` VARCHAR(500) NULL,
  `htmlLink` VARCHAR(500) NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
  `createdByUserId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `SalesCrmMeeting_enquiryId_startAt_idx` (`enquiryId`, `startAt`),
  INDEX `SalesCrmMeeting_googleEventId_idx` (`googleEventId`),
  INDEX `SalesCrmMeeting_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
