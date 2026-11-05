-- Who a shoot is for: the groom's side, the bride's side, or both.
--
-- Required on every new shoot from now on, and nullable here because the shoots already booked were
-- never asked. A blank means "not recorded", which is the truth about them - it does not mean the
-- shoot covers nobody, and backfilling a guess would be worse than leaving the question open.
SET @column_exists := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'project_shoot'
     AND column_name = 'preference'
);
SET @statement := IF(
  @column_exists = 0,
  'ALTER TABLE `project_shoot` ADD COLUMN `preference` VARCHAR(20) NULL',
  'DO 0'
);
PREPARE add_column FROM @statement;
EXECUTE add_column;
DEALLOCATE PREPARE add_column;
