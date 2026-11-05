/*
 * The Signature Album's rules that need no component: what the closed lists are called, how a
 * chapter's photos fall into an editorial layout, what a status looks like, and the CSS the client
 * page draws a design with. Pure, so it is unit-tested on its own (test/signature-album.test.mjs)
 * and shared by the workspace, its live preview and the client page - one answer for all three.
 */

// The first entries of each list shipped first and are never renamed or removed: an album row
// holds the value it was given. Later entries were added beside them; the backend's
// signatureAlbum.constants.js holds the same lists and is what the API validates against.
export const THEME_OPTIONS = [
  { value: "CLASSIC", label: "Classic", description: "Large hero, cream tones, an elegant wedding feel" },
  { value: "EDITORIAL", label: "Editorial", description: "Magazine composition with large and small frames" },
  { value: "MINIMAL", label: "Minimal", description: "Clean white, the photographs and nothing else" },
  { value: "CINEMATIC", label: "Cinematic", description: "Dark, dramatic, photographs at full width" },
  { value: "ROMANTIC", label: "Romantic", description: "Soft warm neutrals and graceful spacing for a couple's story" },
  { value: "LUXURY", label: "Luxury", description: "High-end editorial: strong type, gold accent, generous room" },
  { value: "MODERN", label: "Modern", description: "Clean and contemporary, bold headings, balanced whitespace" },
  { value: "VINTAGE", label: "Vintage", description: "Timeless album feel in warm, muted tones" },
];
export const COVER_STYLE_OPTIONS = [
  { value: "FULL_SCREEN", label: "Full Screen" },
  { value: "SPLIT", label: "Split" },
  { value: "MINIMAL", label: "Minimal" },
  { value: "CENTERED_HERO", label: "Centered Hero" },
  { value: "EDITORIAL_OVERLAY", label: "Editorial Overlay" },
  { value: "FRAMED", label: "Framed Cover" },
  { value: "STORY", label: "Story Cover" },
];
export const LAYOUT_OPTIONS = [
  // First because it is what a new album starts on: each photo framed by its own shape.
  { value: "CURATED", label: "Curated" },
  { value: "EDITORIAL", label: "Editorial" },
  { value: "MASONRY", label: "Masonry" },
  { value: "GRID", label: "Grid" },
  { value: "STORY", label: "Story" },
  { value: "SHOWCASE", label: "Showcase" },
  { value: "FILMSTRIP", label: "Filmstrip" },
  { value: "MIXED", label: "Mixed" },
];
export const SPACING_OPTIONS = [
  { value: "TIGHT", label: "Tight" },
  { value: "COMPACT", label: "Compact" },
  { value: "STANDARD", label: "Standard" },
  { value: "SPACIOUS", label: "Spacious" },
  { value: "AIRY", label: "Airy" },
];
export const BACKGROUND_OPTIONS = [
  { value: "WHITE", label: "White" },
  { value: "CREAM", label: "Cream" },
  { value: "DARK", label: "Dark" },
];
// What the client's Download Album control is called in each of its states - an icon-only button,
// so this is its accessible name and its hover title, not text on it. "Preparing album..." lasts
// while the server prints the PDF; the file is then fetched by the browser itself, so "Downloading"
// is the hand-over to the browser's own download bar, not a progress the page can see.
export const DOWNLOAD_ALBUM_LABELS = { idle: "Download album", preparing: "Preparing album...", downloading: "Downloading…", error: "Retry Download" };
export const downloadAlbumLabel = (state) => DOWNLOAD_ALBUM_LABELS[state] || DOWNLOAD_ALBUM_LABELS.idle;
export const isDownloadAlbumBusy = (state) => state === "preparing" || state === "downloading";
export const ALIGNMENT_OPTIONS = [
  { value: "LEFT", label: "Left" },
  { value: "CENTER", label: "Center" },
  { value: "RIGHT", label: "Right" },
];
export const HEADING_FONTS = ["DM Serif Display", "Playfair Display", "Cormorant Garamond", "Libre Baskerville", "Lora", "Merriweather", "Bodoni Moda", "Cinzel", "EB Garamond", "Crimson Pro", "Prata", "Noto Serif", "Montserrat", "Inter", "Manrope"];
export const BODY_FONTS = ["Nunito Sans", "Inter", "Manrope", "Lato", "Open Sans", "Source Sans 3", "Work Sans", "Montserrat", "Poppins", "Roboto", "Noto Sans", "DM Sans", "Lora"];
/*
 * The Google Fonts axes each family is fetched with. The css2 endpoint refuses the whole request
 * when any weight named is one the family does not have - Prata is 400 alone, Lato has no 500 -
 * so each family names only what it ships, and one bad family can no longer take the other down.
 * A family not listed here is fetched at 400 only.
 */
export const FONT_AXES = {
  "DM Serif Display": "ital,wght@0,400;1,400",
  "Playfair Display": "ital,wght@0,400;0,500;0,600;1,400",
  "Cormorant Garamond": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  "Libre Baskerville": "ital,wght@0,400;0,700;1,400",
  Lora: "ital,wght@0,400;0,500;0,600;1,400",
  Merriweather: "ital,wght@0,300;0,400;0,700;1,400",
  "Bodoni Moda": "ital,wght@0,400;0,500;0,600;1,400",
  Cinzel: "wght@400;500;600",
  "EB Garamond": "ital,wght@0,400;0,500;0,600;1,400",
  "Crimson Pro": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  Prata: "",
  "Noto Serif": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  Montserrat: "ital,wght@0,300;0,400;0,500;0,600;1,400",
  Inter: "wght@300;400;500;600",
  "Nunito Sans": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  Manrope: "wght@300;400;500;600",
  Lato: "ital,wght@0,300;0,400;0,700;1,400",
  "Open Sans": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  "Source Sans 3": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  "Work Sans": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  Poppins: "ital,wght@0,300;0,400;0,500;0,600;1,400",
  Roboto: "ital,wght@0,300;0,400;0,500;0,600;1,400",
  "Noto Sans": "ital,wght@0,300;0,400;0,500;0,600;1,400",
  "DM Sans": "ital,wght@0,300;0,400;0,500;0,600;1,400",
};
/** Optional presets that set both fonts at once; the two dropdowns stay for choosing by hand. */
export const FONT_PAIRINGS = [
  { value: "ELEGANT", label: "Elegant", headingFont: "Playfair Display", bodyFont: "Inter" },
  { value: "LUXURY", label: "Luxury", headingFont: "Cormorant Garamond", bodyFont: "Manrope" },
  { value: "CLASSIC", label: "Classic", headingFont: "DM Serif Display", bodyFont: "Nunito Sans" },
  { value: "MODERN", label: "Modern", headingFont: "Bodoni Moda", bodyFont: "DM Sans" },
  { value: "MINIMAL", label: "Minimal", headingFont: "Libre Baskerville", bodyFont: "Inter" },
];
/** Which pairing a heading and body font are, or "" when the pair is the studio's own. */
export const pairingFor = (headingFont, bodyFont) => FONT_PAIRINGS.find((pair) => pair.headingFont === headingFont && pair.bodyFont === bodyFont)?.value || "";
export const EXPIRY_OPTIONS = [1, 3, 6, 12, 24].map((months) => ({ value: months, label: months === 1 ? "1 Month" : `${months} Months` }));
export const MAX_HIGHLIGHTS = 30;

export const optionLabel = (options, value) => options.find((option) => option.value === value)?.label || String(value || "");

/** The status chip: colour and wording for each of the four states the studio reads. */
export const STATUS_PRESENTATION = {
  DRAFT: { label: "Draft", tone: "slate" },
  READY: { label: "Ready", tone: "amber" },
  PUBLISHED: { label: "Published", tone: "emerald" },
  EXPIRED: { label: "Expired", tone: "red" },
};
export const statusPresentation = (status) => STATUS_PRESENTATION[status] || STATUS_PRESENTATION.DRAFT;

/*
 * The spacing scale, in pixels. One number per option so the gutter between frames, the space
 * between rows and the breathing room around a chapter heading all move together.
 */
const SPACING_PX = { TIGHT: 2, COMPACT: 4, STANDARD: 12, SPACIOUS: 28, AIRY: 48 };
export const spacingPx = (imageSpacing) => SPACING_PX[imageSpacing] ?? SPACING_PX.STANDARD;

/*
 * The Google Fonts stylesheet for a design: the two chosen families, each at the weights the
 * page uses. Built here so the client page and the live preview load the same file.
 */
export function fontStylesheetUrl(design) {
  const families = [...new Set([design?.headingFont, design?.bodyFont].filter(Boolean))];
  if (!families.length) return "";
  const params = families.map((family) => { const axes = FONT_AXES[family] ?? "wght@400"; return `family=${encodeURIComponent(family).replace(/%20/g, "+")}${axes ? `:${axes}` : ""}`; }).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/** A hex colour at an opacity, as CSS. */
export function withAlpha(hex, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return `rgba(0,0,0,${alpha})`;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

/**
 * The CSS custom properties the album's markup reads, from a resolved design. The muted tone,
 * the border and the overlay come from the theme's preset with the design; an older design
 * without them is answered from the background's darkness, as before.
 */
export function designVariables(design) {
  const dark = isDark(design?.backgroundColor);
  const overlay = design?.overlay;
  return {
    "--album-bg": design?.backgroundColor || "#ffffff",
    "--album-text": design?.textColor || "#111111",
    "--album-accent": design?.accentColor || "#1f1f1f",
    "--album-muted": design?.mutedTextColor || (dark ? "rgba(255,255,255,0.62)" : "rgba(17,17,17,0.6)"),
    "--album-line": design?.borderColor || (dark ? "rgba(255,255,255,0.14)" : "rgba(17,17,17,0.12)"),
    // The tone behind cover words on a photo: the theme's colour, strong at the foot and gone at
    // the top, so the title reads on any picture.
    "--album-overlay": overlay?.color ? `linear-gradient(to top, ${withAlpha(overlay.color, overlay.from ?? 0.7)}, ${withAlpha(overlay.color, overlay.to ?? 0.2)} 55%, ${withAlpha(overlay.color, 0.05)})` : "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.25) 55%, rgba(0,0,0,0.1))",
    "--album-frame": dark ? "#17171a" : "#f1f0ee",
    "--album-heading-font": design?.headingFont ? `"${design.headingFont}", Georgia, serif` : "Georgia, serif",
    "--album-body-font": design?.bodyFont ? `"${design.bodyFont}", system-ui, sans-serif` : "system-ui, sans-serif",
    "--album-gap": `${spacingPx(design?.imageSpacing)}px`,
  };
}

/*
 * WCAG contrast between two hex colours, 1 to 21. The Design panel says "Low contrast" under 3,
 * which is where body text stops being comfortably readable; it never changes the choice.
 */
export function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!match) return null;
    const value = parseInt(match[1], 16);
    const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
  };
  const a = luminance(foreground); const b = luminance(background);
  if (a === null || b === null) return null;
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}
export const LOW_CONTRAST = 3;

/*
 * Which of the studio's two Global Logos the album draws. The server decides this for every page
 * (`logo` on the content and the PIN meta: tone, url, whether the mark was uploaded for that
 * ground); the rule is repeated here only so the page can answer for a payload that predates it.
 * The tones are named after the ground the mark is drawn for, as Settings names its uploads.
 */
export const LOGO_VARIANT_OPTIONS = [
  { value: "AUTO", label: "Auto", description: "Matches the album background" },
  { value: "DARK", label: "Dark", description: "The dark-mode Global Logo" },
  { value: "LIGHT", label: "Light", description: "The light-mode Global Logo" },
];
/** The bundled mark in each tone: the artwork lettered for a dark ground, and for a light one. */
export const BUNDLED_MARKS = { DARK: "/brand/beam-craft-white-text.svg", LIGHT: "/brand/beam-craft-black-text.svg" };
export function logoToneFor(design) {
  if (design?.logoVariant === "DARK" || design?.logoVariant === "LIGHT") return design.logoVariant;
  const dark = typeof design?.darkSurface === "boolean" ? design.darkSurface : isDark(design?.backgroundColor);
  return dark ? "DARK" : "LIGHT";
}

/** Whether a hex colour reads as dark, which decides the muted text and the frame placeholders. */
export function isDark(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return false;
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255; const g = (value >> 8) & 255; const b = value & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}

/*
 * How a run of photos falls into rows for the Editorial layout.
 *
 * The pattern is what makes a chapter read as a story rather than a contact sheet: one large
 * frame, then a pair, then a large frame, then a trio, and round again. It is decided from the
 * position alone, so it is the same for the live preview and the client page and stays stable as
 * more photos arrive - a row already laid out never changes shape when the next batch loads.
 * A photo's orientation nudges the choice: a portrait never stands alone at full width, and a
 * landscape is never squeezed into a trio when it could open a row.
 */
const EDITORIAL_PATTERN = [1, 2, 1, 3, 2, 1, 3];
export function editorialRows(items) {
  const rows = [];
  let index = 0;
  let step = 0;
  while (index < items.length) {
    let size = EDITORIAL_PATTERN[step % EDITORIAL_PATTERN.length];
    const first = items[index];
    if (size === 1 && isPortrait(first) && items[index + 1]) size = 2;
    if (size === 3 && isLandscape(first) && !isLandscape(items[index + 1])) size = 2;
    const row = items.slice(index, index + size);
    rows.push(row);
    index += row.length;
    step += 1;
  }
  return rows;
}
/*
 * Rows by a fixed pattern, for the layouts added after Editorial: Story alternates one wide frame
 * with a pair, Mixed runs full width, two columns, three columns, two columns. Decided from the
 * position alone, like `editorialRows`, so a row never changes shape as the next batch arrives.
 */
export function patternRows(items, pattern) {
  const rows = [];
  let index = 0;
  let step = 0;
  while (index < items.length) {
    const row = items.slice(index, index + pattern[step % pattern.length]);
    rows.push(row);
    index += row.length;
    step += 1;
  }
  return rows;
}
export const storyRows = (items) => patternRows(items, [1, 2]);
export const mixedRows = (items) => patternRows(items, [1, 2, 3, 2]);

/*
 * Curated: the photo's own shape decides the frame's. A photo is Landscape, Portrait or Square by
 * its stored width and height - the decoded image's, so already turned upright by its EXIF
 * rotation at upload (`buildDerivatives`) - with anything within 10% of square counted square.
 * Each orientation has one designed frame (3:2, 2:3, 1:1); a photo with no dimensions is drawn as
 * the commonest case, a landscape.
 */
export const ORIENTATION_FRAMES = { LANDSCAPE: 3 / 2, PORTRAIT: 2 / 3, SQUARE: 1 };
export const ORIENTATION_FRAME_CSS = { LANDSCAPE: "3 / 2", PORTRAIT: "2 / 3", SQUARE: "1 / 1" };
export function orientationOf(item) {
  const width = Number(item?.width);
  const height = Number(item?.height);
  if (!(width > 0) || !(height > 0)) return "LANDSCAPE";
  const ratio = width / height;
  if (ratio < 0.9) return "PORTRAIT";
  if (ratio > 1.1) return "LANDSCAPE";
  return "SQUARE";
}
export const frameWeight = (item) => ORIENTATION_FRAMES[orientationOf(item)];
/** The widest a curated row may get - two landscapes, or three squares - before frames turn small. */
export const CURATED_MAX_ROW_WEIGHT = 3.2;
/** The lightest a row may be - one full-width landscape - before it would stand taller than the hero. */
export const CURATED_MIN_ROW_WEIGHT = ORIENTATION_FRAMES.LANDSCAPE;
export const rowWeight = (row) => row.reduce((sum, item) => sum + frameWeight(item), 0);
/*
 * How a run of photos falls into Curated rows. The rhythm is Editorial's - one, two, three, two -
 * but each row is shaped by what lands in it: only a landscape stands alone as a full-width frame
 * (a portrait or square opening a single row takes the next photo beside it), and a row stops
 * growing once its frames would turn small, so three landscapes become a pair and a landscape
 * with two squares a landscape and one. A row lighter than a full-width landscape - a pair of
 * portraits - takes the next photo too, up to three, so it does not tower over the page; one still
 * that light (only ever at the very end) is drawn narrower by the layout. Photos are never reordered - the album reads in the order
 * the studio gave it - and, like the other layouts, the rows come from the photos alone, so the
 * preview, the client page and the PDF draw the same rows.
 */
const CURATED_PATTERN = [1, 2, 3, 2];
export function curatedRows(items) {
  const rows = [];
  let index = 0;
  let step = 0;
  while (index < items.length) {
    let size = CURATED_PATTERN[step % CURATED_PATTERN.length];
    if (size === 1 && orientationOf(items[index]) !== "LANDSCAPE" && items[index + 1]) size = 2;
    const row = items.slice(index, index + size);
    while (row.length > 1 && rowWeight(row) > CURATED_MAX_ROW_WEIGHT) row.pop();
    while (row.length < 3 && rowWeight(row) < CURATED_MIN_ROW_WEIGHT && items[index + row.length] && rowWeight(row) + frameWeight(items[index + row.length]) <= CURATED_MAX_ROW_WEIGHT) row.push(items[index + row.length]);
    rows.push(row);
    index += row.length;
    step += 1;
  }
  return rows;
}

export const isPortrait = (item) => Boolean(item?.width && item?.height && item.height > item.width * 1.05);
export const isLandscape = (item) => Boolean(item?.width && item?.height && item.width > item.height * 1.05);

/*
 * The frame a row of photos shares, chosen from what is in it so the crop is the smallest it can
 * be: a row of landscapes gets a landscape frame, a row of portraits a portrait one, and a row
 * that mixes the two a frame between them. Every frame in the row is the same shape, which is
 * what keeps the row's edges aligned; the photo inside is placed by its own focal point.
 */
export function rowAspect(row) {
  const known = (row || []).filter((item) => item?.width && item?.height);
  if (!known.length) return "3 / 2";
  const portraits = known.filter(isPortrait).length;
  const landscapes = known.filter(isLandscape).length;
  if (portraits === known.length) return "2 / 3";
  if (landscapes === known.length) return "3 / 2";
  if (!portraits && !landscapes) return "1 / 1";
  // Mixed: nearer to square, so neither orientation loses much.
  return portraits >= landscapes ? "4 / 5" : "5 / 4";
}

/** The aspect ratio a frame reserves before its photo arrives, so nothing jumps as it loads. */
export function aspectRatio(item, fallback = "3 / 2") {
  return item?.width && item?.height ? `${item.width} / ${item.height}` : fallback;
}

/** The cover's text position as flexbox alignment and text-align. */
export function coverAlignmentClasses(alignment) {
  if (alignment === "LEFT") return { align: "items-start", text: "text-left" };
  if (alignment === "RIGHT") return { align: "items-end", text: "text-right" };
  return { align: "items-center", text: "text-center" };
}

/** "12 February 2026" from a stored instant, in the studio's time zone; blank for none. */
export function formatEventDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" }).format(date);
}
export function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(date);
}
/** A stored instant as the calendar field writes it ("2027-03-23"), in the studio's own day. */
export function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/*
 * What an ending link is called: the site's own name for a website ("dontblinkstudioz.com"), the
 * handle for an Instagram address ("@dontblinkstudioz"). Read off the address so the studio types
 * a link once and the album says whose it is; an address that cannot be read falls back to the
 * plain word.
 */
export function linkLabel(url, kind = "website") {
  const value = String(url || "").trim();
  if (!value) return "";
  let parsed;
  try { parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return kind === "instagram" ? "Instagram" : "Website"; }
  const host = parsed.hostname.replace(/^www\./i, "");
  if (kind === "instagram") {
    const handle = parsed.pathname.split("/").filter(Boolean)[0];
    if (/instagram\.com$/i.test(host) && handle) return `@${handle.replace(/^@/, "")}`;
    return host || "Instagram";
  }
  return host || "Website";
}

/** Chapter numbers read "01", "02" under a heading. */
export const chapterNumber = (index) => String(index + 1).padStart(2, "0");

/** The form state the cover card edits, from an album, so a save can compare against it. */
export function coverFormState(album) {
  return { title: album?.title || "", subtitle: album?.subtitle || "", eventDate: toDateInput(album?.eventDate), coverAlignment: album?.coverAlignment || "CENTER", endingMessage: album?.endingMessage || "" };
}
export const hasFormChanges = (initial, current) => Object.keys(initial).some((key) => initial[key] !== current[key]);

/** The problems list as the rail reads it: the first message alone, or a count. */
export function publishBlocker(problems) {
  if (!problems?.length) return "";
  return problems.length === 1 ? problems[0].message : `${problems[0].message} (${problems.length - 1} more)`;
}

/** The recommended-range remark under Highlights. */
export function highlightsRemark(count) {
  if (!count) return "Mark 10 to 30 photos to open the album with your favourite moments.";
  if (count < 10) return `${count} marked - 10 to 30 is recommended.`;
  if (count >= MAX_HIGHLIGHTS) return `${count} marked - that is the most the section holds.`;
  return `${count} marked.`;
}

/** The studio's preview is editable only when the Design tab asked for it and the viewer may write the album. */
export const previewEditable = (requested, canWrite) => requested === true && canWrite === true;
