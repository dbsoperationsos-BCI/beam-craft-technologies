-- The heading over a Signature Album's photos on the client page is its chapter's name, and the
-- chapter every upload goes into was made as "Gallery". It is now made as "Album"
-- (`UPLOAD_CHAPTER_NAME`); this renames the ones already made so existing albums read the same.
-- Uploads find that chapter by position, not by name, so nothing else depends on the text.
--
-- Only the chapter the server made: the album's sole chapter, holding nothing but the album's own
-- uploads. A chapter the studio named "Gallery" itself - one of several, or holding project photos -
-- keeps its name. The chapter count goes through a derived table because MySQL will not read the
-- table an UPDATE is writing in a plain subquery. Replayable: a second run finds no "Gallery" left.
UPDATE `signature_album_chapter`
SET `name` = 'Album'
WHERE `name` = 'Gallery'
  AND `album_id` IN (
    SELECT `album_id` FROM (
      SELECT `album_id` FROM `signature_album_chapter` GROUP BY `album_id` HAVING COUNT(*) = 1
    ) AS `sole_chapter`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `signature_album_item` AS `item`
    WHERE `item`.`chapter_id` = `signature_album_chapter`.`id` AND `item`.`image_id` IS NOT NULL
  );
