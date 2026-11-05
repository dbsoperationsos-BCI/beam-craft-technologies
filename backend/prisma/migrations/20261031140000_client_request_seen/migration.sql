-- When a client has seen the studio's answer to their request: until then it waits in their Action
-- Needed. One empty column on a table added today.

ALTER TABLE `client_service_request`
  ADD COLUMN `client_seen_at` DATETIME(3) NULL;
