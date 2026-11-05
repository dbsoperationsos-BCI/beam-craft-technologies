-- WRC (Waiting for Client Reply) is gone from Pre Production - the toggle, the aging timestamp
-- behind it, the board's rollup column, the card badge and the info panel rows. Dropped rather
-- than left unread, since nothing on the form or the API writes or reads either column any more.
ALTER TABLE `project_pre_production`
  DROP COLUMN `waiting_for_client_reply`,
  DROP COLUMN `waiting_since`;
