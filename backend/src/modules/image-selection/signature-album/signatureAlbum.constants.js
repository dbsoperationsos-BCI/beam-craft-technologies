/*
 * The Signature Album's vocabulary, in one place, so the validation, the service, the seed defaults
 * and the frontend's copies cannot drift apart. Every list here is closed: a value not on it is
 * refused at the edge rather than stored and drawn as nothing.
 */

// The first four of each list shipped first; the rest were added beside them. Nothing is ever
// renamed or removed from these lists, because every album row stores the value it was given.
const THEMES = ["CLASSIC", "EDITORIAL", "MINIMAL", "CINEMATIC", "ROMANTIC", "LUXURY", "MODERN", "VINTAGE"];
const COVER_STYLES = ["FULL_SCREEN", "SPLIT", "MINIMAL", "CENTERED_HERO", "EDITORIAL_OVERLAY", "FRAMED", "STORY"];
const LAYOUT_STYLES = ["EDITORIAL", "MASONRY", "GRID", "STORY", "SHOWCASE", "FILMSTRIP", "MIXED", "CURATED"];
const IMAGE_SPACINGS = ["TIGHT", "COMPACT", "STANDARD", "SPACIOUS", "AIRY"];
const BACKGROUNDS = ["WHITE", "CREAM", "DARK"];
const COVER_ALIGNMENTS = ["LEFT", "CENTER", "RIGHT"];
// DRAFT, READY and EXPIRED are what the studio reads; only DRAFT, PUBLISHED and EXPIRED are ever
// stored - READY is derived from the publish validation and never written.
const STATUSES = ["DRAFT", "READY", "PUBLISHED", "EXPIRED"];
const STORED_STATUSES = ["DRAFT", "PUBLISHED", "EXPIRED"];
const ITEM_SOURCES = ["SELECTED", "FOLDER", "MANUAL"];
// How a photo sits in a designed frame: FILL fills it and crops around the focal point, FIT shows
// the whole photograph. Null on a row means FILL, centred, 1× - what every frame did before.
const DISPLAY_MODES = ["FIT", "FILL"];
const TRANSFORM_LIMITS = { MIN_FOCAL: 0, MAX_FOCAL: 100, MIN_ZOOM: 1, MAX_ZOOM: 2 };
/*
 * Which of the studio's two Global Logos the album's pages draw. AUTO reads the album's effective
 * background - the dark-ground mark on a dark album, the light-ground mark on a light one - and
 * the other two pin the choice. Named after the *surface* the mark is drawn for, the way Settings
 * names its two uploads: DARK is the mark for a dark ground (light lettering), LIGHT the mark for
 * a light ground.
 */
const LOGO_VARIANTS = ["AUTO", "DARK", "LIGHT"];

/*
 * The fonts the Design panel offers. The client page loads the chosen pair from Google Fonts, so
 * the list is what that stylesheet can answer for; anything else would fall back to the browser's
 * serif or sans without saying so.
 */
// The first six of each were the original lists and stay, so a font an album already holds is
// still a value the validation accepts; the rest were added beside them. The frontend's copy
// (lib/signatureAlbum.mjs) names the Google Fonts axes each one is fetched with.
const HEADING_FONTS = ["Cormorant Garamond", "Playfair Display", "DM Serif Display", "Lora", "Montserrat", "Inter", "Libre Baskerville", "Merriweather", "Bodoni Moda", "Cinzel", "EB Garamond", "Crimson Pro", "Prata", "Noto Serif", "Manrope"];
const BODY_FONTS = ["Inter", "Lato", "Nunito Sans", "Source Sans 3", "Montserrat", "Lora", "Manrope", "Open Sans", "Work Sans", "Poppins", "Roboto", "Noto Sans", "DM Sans"];

/*
 * SIGNATURE_ALBUM_THEME_PRESETS - the one place a theme's look is written down.
 *
 * A theme is a smart default, never a lock: choosing one writes its five studio-editable values
 * (background, text, accent, heading font, body font) onto the album, which the studio may then
 * change one at a time, and supplies the rest (muted text, border, the overlay behind cover
 * words) whenever the album is drawn. "Customised" means the stored five differ from the preset.
 * The client page, the preview and the Design panel all read these same values through
 * `resolveDesign`; nothing else names a theme colour.
 *
 * An album from before these presets keeps the values it rendered with: migration
 * 20260924130000 wrote them onto every existing row, so only a new album, an explicit theme
 * choice or Reset to Theme Defaults ever sees a preset.
 *
 * `overlay` is a tone and a strength, not CSS: the page builds the gradient from it.
 */
const THEME_PRESETS = {
  CLASSIC: { backgroundColor: "#f7f1e7", textColor: "#3b2a20", mutedTextColor: "#77675c", accentColor: "#a67c52", headingFont: "DM Serif Display", bodyFont: "Nunito Sans", borderColor: "#e4d8c8", overlay: { color: "#2a1d12", from: 0.66, to: 0.14 } },
  EDITORIAL: { backgroundColor: "#f8f8f6", textColor: "#181818", mutedTextColor: "#6b6b68", accentColor: "#8a7254", headingFont: "Bodoni Moda", bodyFont: "Inter", borderColor: "#deded9", overlay: { color: "#141414", from: 0.7, to: 0.18 } },
  MINIMAL: { backgroundColor: "#ffffff", textColor: "#171717", mutedTextColor: "#737373", accentColor: "#a3a3a3", headingFont: "Libre Baskerville", bodyFont: "Inter", borderColor: "#eaeaea", overlay: { color: "#000000", from: 0.38, to: 0.04 } },
  CINEMATIC: { backgroundColor: "#111111", textColor: "#f5f5f3", mutedTextColor: "#aaa7a0", accentColor: "#c6a86a", headingFont: "Cormorant Garamond", bodyFont: "Manrope", borderColor: "#2b2b2b", overlay: { color: "#000000", from: 0.86, to: 0.3 } },
  ROMANTIC: { backgroundColor: "#fbf2f0", textColor: "#4d3135", mutedTextColor: "#8f7175", accentColor: "#c58a92", headingFont: "Playfair Display", bodyFont: "Lato", borderColor: "#ecd8d8", overlay: { color: "#4d3135", from: 0.62, to: 0.14 } },
  LUXURY: { backgroundColor: "#12100d", textColor: "#f4ebdd", mutedTextColor: "#b7aa96", accentColor: "#c9a35d", headingFont: "Prata", bodyFont: "DM Sans", borderColor: "#40382d", overlay: { color: "#0a0805", from: 0.86, to: 0.3 } },
  MODERN: { backgroundColor: "#f4f5f4", textColor: "#1c2524", mutedTextColor: "#66706d", accentColor: "#5c7c76", headingFont: "Manrope", bodyFont: "Inter", borderColor: "#dde2df", overlay: { color: "#1c2524", from: 0.6, to: 0.14 } },
  VINTAGE: { backgroundColor: "#efe4d0", textColor: "#49382d", mutedTextColor: "#796758", accentColor: "#9a7254", headingFont: "EB Garamond", bodyFont: "Source Sans 3", borderColor: "#d8c5a9", overlay: { color: "#3b2a1a", from: 0.64, to: 0.14 } },
};
// The five the studio edits and the album stores; the rest are the theme's alone.
const THEME_EDITABLE_KEYS = ["backgroundColor", "textColor", "accentColor", "headingFont", "bodyFont"];
// Kept under its old name for the callers that only need a palette and fonts.
const THEME_DEFAULTS = THEME_PRESETS;
// The global "Default Background" setting is a starting colour for a new album, read through the
// same three names the panel offers; the theme's own answer is what a null column falls back to.
const BACKGROUND_COLORS = { WHITE: "#ffffff", CREAM: "#faf7f2", DARK: "#0b0b0d" };

const LIMITS = {
  MAX_CHAPTERS: 60,
  MAX_ITEMS_PER_REQUEST: 2000,
  // One web derivative as the browser built it: the same ceiling the project upload takes.
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024,
  MAX_HIGHLIGHTS: 30,
  RECOMMENDED_HIGHLIGHTS_MIN: 10,
  MIN_EXPIRY_MONTHS: 1,
  MAX_EXPIRY_MONTHS: 60,
  MIN_PIN_LENGTH: 4,
  MAX_PIN_LENGTH: 6,
  MIN_BATCH: 10,
  MAX_BATCH: 120,
  MAX_TITLE: 191,
  MAX_SUBTITLE: 191,
  MAX_ENDING: 2000,
  // Download Album's PDF: how many albums the headless browser prints at once (each is a page
  // holding every photo, so a couple is the server's worth), how long one may take, and how long a
  // finished PDF is kept for the client to fetch before its file is deleted.
  PDF_MAX_RENDERING: 2,
  PDF_RENDER_TIMEOUT_MS: 10 * 60 * 1000,
  PDF_KEEP_MS: 30 * 60 * 1000,
};

const DEFAULT_ENDING_MESSAGE = "Thank you for letting us capture your story.";
const DEFAULT_FOOTER_TEXT = "Captured & preserved by {studioName}";

// Public identifiers and sessions. The scope names this album's sessions apart from the gallery's
// and the proof's, so a token minted for one can never open another.
const SESSION_SCOPE = "signature-album-session";
const SESSION_TTL = "30d";
// A download ticket: minted for a session that may download, carried in the PDF's URL because a
// browser download cannot send a header, and good for minutes rather than days for that reason.
const DOWNLOAD_TICKET_SCOPE = "signature-album-download";
const DOWNLOAD_TICKET_TTL = "5m";
// The session the server's own print of the album opens it with - as long as a print may take.
const PRINT_SESSION_TTL = "15m";

module.exports = {
  THEMES, COVER_STYLES, LAYOUT_STYLES, IMAGE_SPACINGS, BACKGROUNDS, COVER_ALIGNMENTS,
  STATUSES, STORED_STATUSES, ITEM_SOURCES, DISPLAY_MODES, TRANSFORM_LIMITS, LOGO_VARIANTS, HEADING_FONTS, BODY_FONTS, THEME_DEFAULTS, THEME_PRESETS, THEME_EDITABLE_KEYS, BACKGROUND_COLORS,
  LIMITS, DEFAULT_ENDING_MESSAGE, DEFAULT_FOOTER_TEXT, SESSION_SCOPE, SESSION_TTL, DOWNLOAD_TICKET_SCOPE, DOWNLOAD_TICKET_TTL, PRINT_SESSION_TTL,
};
