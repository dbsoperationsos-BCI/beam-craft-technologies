-- A Full Session is now 8-10 hours, not 10-12. The duration a service's Full Session pricing line
-- carries - and every quotation's saved copy of its lines and shoots - is the text
-- "10-12 Hours (Full)", written by the application as the Full Session default. That exact JSON
-- string value, quotes included, becomes "8-10 Hours (Full)"; nothing else in either document moves
-- (prices, sizes, shoot types, Half Session, notes). Only rows that hold it are touched, so running
-- this again changes nothing. To undo, run the same statements with the two strings swapped.
UPDATE `project_service_definition`
SET `pricing` = CAST(REPLACE(CAST(`pricing` AS CHAR CHARACTER SET utf8mb4), '"10-12 Hours (Full)"', '"8-10 Hours (Full)"') AS JSON)
WHERE CAST(`pricing` AS CHAR CHARACTER SET utf8mb4) LIKE '%"10-12 Hours (Full)"%';

UPDATE `sales_quotation`
SET `payload` = CAST(REPLACE(CAST(`payload` AS CHAR CHARACTER SET utf8mb4), '"10-12 Hours (Full)"', '"8-10 Hours (Full)"') AS JSON)
WHERE CAST(`payload` AS CHAR CHARACTER SET utf8mb4) LIKE '%"10-12 Hours (Full)"%';
