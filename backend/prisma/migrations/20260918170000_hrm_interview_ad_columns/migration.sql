-- Which paid ad an interview application came from.
--
-- A studio running hiring ads on Meta exports its leads with the ad hierarchy beside each row -
-- Campaign Name, Adset Name, Ad Name - and those three answer a question the register could not
-- answer before: not only that an application came from Meta Ads, which the `source` column already
-- says, but which push, which audience and which creative brought it in. That is what decides what
-- keeps running, so it belongs on the candidate rather than in a spreadsheet beside the register.
--
-- Three columns rather than one string, because they are read at three different widths and a
-- studio filters the table by one of them at a time.
--
-- Nullable text, like every column beside them: only a linked sheet or a CSV ever fills them in -
-- nobody types an ad name by hand - so every row already written stays valid, and a candidate typed
-- in through Add Application simply leaves them empty.
--
-- No permission changes: these are columns on a table that already answers to `HRM / Interview`.
--
-- Cost: one ALTER adding three nullable columns. Instant, and it takes no lock worth planning for.

ALTER TABLE `hrm_interview_candidate`
  ADD COLUMN `campaign_name` VARCHAR(191) NULL,
  ADD COLUMN `adset_name` VARCHAR(191) NULL,
  ADD COLUMN `ad_name` VARCHAR(191) NULL;
