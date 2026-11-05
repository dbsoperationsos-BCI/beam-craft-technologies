-- Signature Album: every existing album keeps the look it has.
--
-- The theme presets are changing - new palettes, new fonts, a muted tone, a border and an overlay
-- per theme - and an album stored only the colours and fonts the studio chose, reading the rest
-- from its theme. Left as it was, an album that never chose a colour would be redrawn in the new
-- preset the moment the code shipped. So the values each album renders with today are written
-- onto it where it holds none: the old default of its theme, per column. From here on a theme's
-- preset reaches an album only when it is created, when the studio applies a theme, or on Reset
-- to Theme Defaults.
--
-- Presentation columns on `signature_album` only. Cost: one UPDATE per column. Instant.
--
-- Written by hand and applied with `prisma migrate deploy`.

UPDATE `signature_album` SET `background_color` = CASE `theme`
  WHEN 'CLASSIC' THEN '#faf7f2' WHEN 'EDITORIAL' THEN '#ffffff' WHEN 'MINIMAL' THEN '#ffffff' WHEN 'CINEMATIC' THEN '#0b0b0d'
  WHEN 'ROMANTIC' THEN '#fbf6f3' WHEN 'LUXURY' THEN '#f7f5f0' WHEN 'MODERN' THEN '#ffffff' WHEN 'VINTAGE' THEN '#f3ead9' ELSE '#ffffff' END
WHERE `background_color` IS NULL;

UPDATE `signature_album` SET `text_color` = CASE `theme`
  WHEN 'CLASSIC' THEN '#2b2620' WHEN 'EDITORIAL' THEN '#111111' WHEN 'MINIMAL' THEN '#1f2937' WHEN 'CINEMATIC' THEN '#f5f5f4'
  WHEN 'ROMANTIC' THEN '#3d3232' WHEN 'LUXURY' THEN '#171513' WHEN 'MODERN' THEN '#0f172a' WHEN 'VINTAGE' THEN '#4a3b2a' ELSE '#111111' END
WHERE `text_color` IS NULL;

UPDATE `signature_album` SET `accent_color` = CASE `theme`
  WHEN 'CLASSIC' THEN '#b08d57' WHEN 'EDITORIAL' THEN '#1f1f1f' WHEN 'MINIMAL' THEN '#6b7280' WHEN 'CINEMATIC' THEN '#c9a86a'
  WHEN 'ROMANTIC' THEN '#b76e79' WHEN 'LUXURY' THEN '#a67c37' WHEN 'MODERN' THEN '#0f766e' WHEN 'VINTAGE' THEN '#8c6a3f' ELSE '#1f1f1f' END
WHERE `accent_color` IS NULL;

UPDATE `signature_album` SET `heading_font` = CASE `theme`
  WHEN 'CLASSIC' THEN 'Cormorant Garamond' WHEN 'EDITORIAL' THEN 'Playfair Display' WHEN 'MINIMAL' THEN 'Inter' WHEN 'CINEMATIC' THEN 'DM Serif Display'
  WHEN 'ROMANTIC' THEN 'Cormorant Garamond' WHEN 'LUXURY' THEN 'Bodoni Moda' WHEN 'MODERN' THEN 'Montserrat' WHEN 'VINTAGE' THEN 'EB Garamond' ELSE 'Playfair Display' END
WHERE `heading_font` IS NULL;

UPDATE `signature_album` SET `body_font` = CASE `theme`
  WHEN 'CLASSIC' THEN 'Lato' WHEN 'EDITORIAL' THEN 'Inter' WHEN 'MINIMAL' THEN 'Inter' WHEN 'CINEMATIC' THEN 'Nunito Sans'
  WHEN 'ROMANTIC' THEN 'Lato' WHEN 'LUXURY' THEN 'Manrope' WHEN 'MODERN' THEN 'DM Sans' WHEN 'VINTAGE' THEN 'Source Sans 3' ELSE 'Inter' END
WHERE `body_font` IS NULL;
