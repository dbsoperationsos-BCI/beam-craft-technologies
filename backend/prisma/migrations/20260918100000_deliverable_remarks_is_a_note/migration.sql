-- A deliverable's Remarks is a note the studio writes, not a Yes or a No.
--
-- `remarks_enabled` was a switch: it decided whether a project's deliverable line carried a remarks
-- box at all, and every deliverable answered Yes to it. Settings → Project → Deliverables asks for
-- Remarks as a typed note now - "sent flat, do not roll", whatever is worth saying about the
-- deliverable - and it decides nothing. The line keeps its own remarks whatever is written here,
-- which is exactly what every deliverable already did, so no project line gains or loses its box.
--
-- Reading a note as an answer was the thing to remove. The rule was "an answer starting with 'no'
-- is No", so a perfectly ordinary note beginning "Not applicable" or "No frames for this one" would
-- have turned the remarks box off across every project using that deliverable, with nothing on
-- screen to say it had happened.
--
-- So the switch's own answers are cleared, and the box opens empty and ready to be written in.
-- Only the two words the dropdown could ever have written are cleared - a note somebody has since
-- typed is left exactly as it is - which is also what makes this safe to run twice: the second run
-- matches nothing.
--
-- No. of Count and Image Selection are untouched. Both are still answered Yes or No, both still
-- decide what they always did, and both keep every value they hold.
--
-- Written by hand and applied with `prisma migrate deploy`.

UPDATE `project_deliverable_definition`
SET `remarks_enabled` = NULL
WHERE `remarks_enabled` IN ('Yes', 'No');
