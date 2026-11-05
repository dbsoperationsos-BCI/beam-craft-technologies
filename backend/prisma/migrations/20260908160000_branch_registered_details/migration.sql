-- What a branch is on paper: where it trades from, what it is registered as, and where it banks.
--
-- The branch table held a code, a name, a free-text address and a description, which was enough to
-- scope a record to a place and no more. Settings -> Branding -> Branches is where the studio now
-- keeps the rest, so a branch can be named on the documents that need these numbers rather than
-- having them typed in again each time.
--
-- Every column is nullable: a branch that exists today has none of them, and the register has to
-- stay usable while they are filled in one at a time. The one exception is the head-office flag,
-- which is a yes/no with an obvious default - no existing branch is claimed to be the head office
-- until somebody says so. Only one branch may hold it, and that is kept by the service rather than
-- by a constraint: MySQL has no partial unique index, and a unique index over the flag would allow
-- exactly one branch that is *not* the head office.
--
-- The widths are the identifiers' own: a PAN is 10 characters, an IFSC 11, a GSTIN 15, and an
-- Indian account number never more than 18 digits.
ALTER TABLE `branch`
  ADD COLUMN `is_head_office` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `gst_number` VARCHAR(15) NULL,
  ADD COLUMN `pan_number` VARCHAR(10) NULL,
  ADD COLUMN `phone` VARCHAR(20) NULL,
  ADD COLUMN `email` VARCHAR(150) NULL,
  ADD COLUMN `bank_account_name` VARCHAR(150) NULL,
  ADD COLUMN `bank_name` VARCHAR(120) NULL,
  ADD COLUMN `bank_account_number` VARCHAR(18) NULL,
  ADD COLUMN `bank_ifsc` VARCHAR(11) NULL;
