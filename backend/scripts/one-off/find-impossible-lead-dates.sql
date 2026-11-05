-- Which leads hold a date that is the right shape but not a real day.
--
-- These are the rows the `20260917120000` migration clears, and the reason it has to: while such a
-- value sits in the row, MySQL cannot recompute that lead's stored generated date columns, so **no
-- update to the lead can succeed at all** - not a migration, not the lead popup, not a bulk edit.
--
-- Run this before deploying if you want to keep a record of what is about to be cleared. It reads
-- and changes nothing.
--
--   mysql -h127.0.0.1 -P3307 -u<user> -p <database> < find-impossible-lead-dates.sql
--
SELECT 'created_date' AS column_name, `enquiry_id`, `assigned_branch`, `created_date` AS impossible_value
  FROM `sales_crm_lead`
 WHERE
  (
    `created_date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    AND (
      CAST(SUBSTRING(`created_date`,6,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`created_date`,9,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`created_date`,6,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`created_date`,1,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`created_date`,1,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`created_date`,1,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
  OR (
    `created_date` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    AND (
      CAST(SUBSTRING(`created_date`,4,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`created_date`,1,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`created_date`,4,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`created_date`,7,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`created_date`,7,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`created_date`,7,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
UNION ALL
SELECT 'next_follow_up_date' AS column_name, `enquiry_id`, `assigned_branch`, `next_follow_up_date` AS impossible_value
  FROM `sales_crm_lead`
 WHERE
  (
    `next_follow_up_date` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    AND (
      CAST(SUBSTRING(`next_follow_up_date`,6,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`next_follow_up_date`,9,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`next_follow_up_date`,6,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`next_follow_up_date`,1,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`next_follow_up_date`,1,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`next_follow_up_date`,1,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
  OR (
    `next_follow_up_date` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    AND (
      CAST(SUBSTRING(`next_follow_up_date`,4,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`next_follow_up_date`,1,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`next_follow_up_date`,4,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`next_follow_up_date`,7,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`next_follow_up_date`,7,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`next_follow_up_date`,7,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
UNION ALL
SELECT 'date_of_birth_or_edod' AS column_name, `enquiry_id`, `assigned_branch`, `date_of_birth_or_edod` AS impossible_value
  FROM `sales_crm_lead`
 WHERE
  (
    `date_of_birth_or_edod` REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    AND (
      CAST(SUBSTRING(`date_of_birth_or_edod`,6,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`date_of_birth_or_edod`,9,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`date_of_birth_or_edod`,6,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`date_of_birth_or_edod`,1,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`date_of_birth_or_edod`,1,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`date_of_birth_or_edod`,1,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  )
  OR (
    `date_of_birth_or_edod` REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    AND (
      CAST(SUBSTRING(`date_of_birth_or_edod`,4,2) AS UNSIGNED) NOT BETWEEN 1 AND 12
      OR CAST(SUBSTRING(`date_of_birth_or_edod`,1,2) AS UNSIGNED) NOT BETWEEN 1 AND (
            CASE CAST(SUBSTRING(`date_of_birth_or_edod`,4,2) AS UNSIGNED)
              WHEN 2 THEN CASE WHEN CAST(SUBSTRING(`date_of_birth_or_edod`,7,4) AS UNSIGNED) % 4 = 0 AND (CAST(SUBSTRING(`date_of_birth_or_edod`,7,4) AS UNSIGNED) % 100 <> 0 OR CAST(SUBSTRING(`date_of_birth_or_edod`,7,4) AS UNSIGNED) % 400 = 0) THEN 29 ELSE 28 END
              WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30
              ELSE 31
            END
          )
    )
  );
