-- A comp-off is granted as an **amount** - 0, 0.5, 1, 1.5 … - rather than yes or no.
--
-- A day worked on a weekly off or a holiday earned exactly one day off, and approving it was a yes or
-- a no. The studio wants to grant half a day for a short day worked, and an amount for a run of days
-- worked back to back: Saturday, Sunday and a holiday together are one ask of "how much was that
-- worth", answered once, not three times.
--
-- Three columns, and each is the honest home for one of those:
--
--   * `attendance_request.worked_to_date` - the last day of the run a credit covers, so three days
--     worked back to back are one request. Null where the run is a single day.
--   * `attendance_request.granted_days` - what the request was granted in the end. **This is what the
--     balance counts**, instead of counting worked days. `0` is a refusal with a number on it.
--   * `attendance_request_approval.granted_days` - what **each** approver would grant. All of them
--     must still approve, and the request takes the **lowest**, so an approver who thinks the run is
--     worth less says so without refusing it outright.
--
--   * `attendance_request.worked_pair_date` - the **second** worked day a comp-off claim draws its
--     other half from. A day off cannot be taken as two halves on two different days, so two half
--     credits buy one whole day off together, and the claim has to name both days it spent. Its own
--     column rather than reusing `worked_to_date`: the two halves need not be next to each other, and
--     a reader taking `worked_date`..`worked_to_date` as a continuous run would read two days six
--     weeks apart as six weeks worked.
--
-- And on the ledger:
--
--   * `comp_off_ledger.earned_days` - what that worked day earned. Defaults to **1.0**, which is what
--     every day in the table earned under the old rule, so nothing anybody has already been shown
--     changes. Always 1, 0.5 or 0 - a run's grant is shared out in half days rather than divided
--     evenly, so two halves always make exactly one day and never leave a quarter nobody can spend.
--
-- Nullable or defaulted throughout, so every request and every ledger row already written keeps
-- reading exactly as it does today.
--
-- Cost: four nullable columns and one defaulted one. Instant.

ALTER TABLE `attendance_request` ADD COLUMN `worked_to_date` DATE NULL,
    ADD COLUMN `worked_pair_date` DATE NULL,
    ADD COLUMN `granted_days` DECIMAL(4, 1) NULL;

ALTER TABLE `attendance_request_approval` ADD COLUMN `granted_days` DECIMAL(4, 1) NULL;

ALTER TABLE `comp_off_ledger` ADD COLUMN `earned_days` DECIMAL(4, 1) NOT NULL DEFAULT 1.0;
