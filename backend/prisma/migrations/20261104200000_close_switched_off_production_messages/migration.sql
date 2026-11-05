-- Close the production step messages left waiting on a message the studio has already switched off.
--
-- A message that failed to reach the project's WhatsApp group stays on its step in red with a Retry
-- beside it, because somebody has to decide what to do about it. Switching that message off on
-- Settings → Templates *is* the decision: it is never going to be sent. From now on the switch
-- closes them as it is pressed (`production/messages.closeOpenMessages`); this does the same once
-- for the messages switched off before that existed, so an old failure cannot reappear on a step
-- if the studio ever turns the message back on.
--
-- `OFF` is a fourth value of the existing `status` column (SENT / FAILED / SENDING), not a new
-- column - the screens read the row's own status and show nothing for one that is closed.
--
-- Only rows whose template is explicitly off are touched; nothing is deleted, and each row keeps its
-- `error` text and its WHATSAPP_FAILED entry in the shoot's activity log. Replayable: a second run
-- finds nothing left in FAILED or SENDING for those templates.
--
-- Cost: one indexed join over a table of a few thousand rows at most. Instant.

UPDATE `project_production_message` `m`
  JOIN `message_template` `t`
    ON `t`.`key` = CASE `m`.`step`
      WHEN 'STARTED_FROM_STUDIO' THEN 'PRODUCTION_STARTED_FROM_STUDIO'
      WHEN 'REACHED_SHOOT_PLACE' THEN 'PRODUCTION_REACHED_SHOOT_PLACE'
      WHEN 'SHOOT_COMPLETED' THEN 'PRODUCTION_SHOOT_COMPLETED'
      ELSE NULL
    END
SET `m`.`status` = 'OFF', `m`.`reason` = NULL
WHERE `t`.`enabled` = false AND `m`.`status` IN ('FAILED', 'SENDING');
