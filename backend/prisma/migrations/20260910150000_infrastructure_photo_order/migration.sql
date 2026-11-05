-- The two tall photographs in an eight-picture collage move from positions 3 and 4 to 7 and 8.
--
-- The client's copy lays a branch's collage out from how many photographs it has, and for eight it
-- prints the reference mosaic: two wide frames across the top left, four small ones beneath them,
-- and two tall portraits standing the full height down the right. Which picture goes where is its
-- position in the stored list, and that list used to read
--
--     1 wide, 2 wide, 3 tall, 4 tall, 5-8 small
--
-- with the tall pair in the middle of it. It now reads
--
--     1 wide, 2 wide, 3-6 small, 7 tall, 8 tall
--
-- which is the order the studio arranges towards - down the collage and then across to the right -
-- and the order the settings screen numbers the frames in.
--
-- Without this, every branch already holding eight photographs would reshuffle the moment the new
-- layout shipped: its two portraits would drop into the small row and two landscapes would be
-- stretched into the tall frames. So the stored lists are rewritten once, into the new order, and
-- every one of those collages prints exactly as it did the day before.
--
-- Only groups holding exactly eight photographs are touched - the layouts for one through seven
-- read the list straight through and were never in this order - and only the `photos` list within
-- them, so a branch's name, its state and everything else in the column is left as it stands.
-- Group positions past the end of a shorter list resolve to nothing and are ignored by JSON_SET,
-- which is why every one of the twenty a settings row may hold can be named unconditionally.
--
-- `sales_quotation_brand.pdf_assets` is deliberately not touched. A brand row from before the
-- studio took the collages over may still hold one, but the shared settings row is laid over it for
-- that key on every read, so nothing there has been printed since - see `combinePdfAssets`.

-- ── The studio's collages, which every quotation raised from now on prints ──
UPDATE `sales_quotation_settings`
SET `pdf_assets` = JSON_SET(`pdf_assets`,
    '$.infrastructure[0].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[0].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[0].photos'), JSON_ARRAY()) END,

    '$.infrastructure[1].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[1].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[1].photos'), JSON_ARRAY()) END,

    '$.infrastructure[2].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[2].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[2].photos'), JSON_ARRAY()) END,

    '$.infrastructure[3].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[3].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[3].photos'), JSON_ARRAY()) END,

    '$.infrastructure[4].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[4].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[4].photos'), JSON_ARRAY()) END,

    '$.infrastructure[5].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[5].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[5].photos'), JSON_ARRAY()) END,

    '$.infrastructure[6].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[6].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[6].photos'), JSON_ARRAY()) END,

    '$.infrastructure[7].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[7].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[7].photos'), JSON_ARRAY()) END,

    '$.infrastructure[8].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[8].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[8].photos'), JSON_ARRAY()) END,

    '$.infrastructure[9].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[9].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[9].photos'), JSON_ARRAY()) END,

    '$.infrastructure[10].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[10].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[10].photos'), JSON_ARRAY()) END,

    '$.infrastructure[11].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[11].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[11].photos'), JSON_ARRAY()) END,

    '$.infrastructure[12].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[12].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[12].photos'), JSON_ARRAY()) END,

    '$.infrastructure[13].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[13].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[13].photos'), JSON_ARRAY()) END,

    '$.infrastructure[14].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[14].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[14].photos'), JSON_ARRAY()) END,

    '$.infrastructure[15].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[15].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[15].photos'), JSON_ARRAY()) END,

    '$.infrastructure[16].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[16].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[16].photos'), JSON_ARRAY()) END,

    '$.infrastructure[17].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[17].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[17].photos'), JSON_ARRAY()) END,

    '$.infrastructure[18].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[18].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[18].photos'), JSON_ARRAY()) END,

    '$.infrastructure[19].photos', CASE WHEN JSON_LENGTH(pdf_assets, '$.infrastructure[19].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[0]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[1]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[4]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[5]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[6]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[7]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[2]'), JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(pdf_assets, '$.infrastructure[19].photos'), JSON_ARRAY()) END
  )
WHERE `pdf_assets` IS NOT NULL AND JSON_LENGTH(`pdf_assets`, '$.infrastructure') > 0;

-- ── The collages frozen onto quotations already raised, so a version keeps the page it was sent as ──
UPDATE `sales_quotation`
SET `payload` = JSON_SET(`payload`,
    '$.brandSnapshot.presentation.assets.infrastructure[0].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[0].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[1].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[1].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[2].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[2].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[3].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[3].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[4].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[4].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[5].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[5].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[6].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[6].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[7].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[7].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[8].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[8].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[9].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[9].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[10].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[10].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[11].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[11].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[12].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[12].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[13].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[13].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[14].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[14].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[15].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[15].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[16].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[16].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[17].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[17].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[18].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[18].photos'), JSON_ARRAY()) END,

    '$.brandSnapshot.presentation.assets.infrastructure[19].photos', CASE WHEN JSON_LENGTH(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos') = 8
      THEN JSON_ARRAY(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[0]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[1]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[4]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[5]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[6]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[7]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[2]'), JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos[3]'))
      ELSE COALESCE(JSON_EXTRACT(payload, '$.brandSnapshot.presentation.assets.infrastructure[19].photos'), JSON_ARRAY()) END
  )
WHERE `payload` IS NOT NULL AND JSON_LENGTH(`payload`, '$.brandSnapshot.presentation.assets.infrastructure') > 0;
