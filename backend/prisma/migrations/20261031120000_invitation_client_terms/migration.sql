-- The studio may set one client's own terms for an invitation (Client Management -> Invitation Cards
-- -> Payments -> Edit): their price, and how many free edits they get. Empty uses the design's price
-- and the usual free edits. Two empty columns on a table added this week.

ALTER TABLE `client_invitation`
  ADD COLUMN `price` INTEGER NULL,
  ADD COLUMN `edit_limit` INTEGER NULL;
