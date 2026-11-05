-- A design free to clients is now one the studio marks so. Every other design's invitations get the
-- free edits and then wait on payment - at its price, or at the price the studio tells the client
-- when none is set yet. Defaulted, on a table added this week.

ALTER TABLE `invitation_template`
  ADD COLUMN `is_free` BOOLEAN NOT NULL DEFAULT false;
