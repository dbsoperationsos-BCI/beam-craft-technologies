/*
 * The animated themes an invitation plays in. A design (Client Management -> Invitation Cards) names
 * one; the guest's page (`frontend/src/components/invitations/`) draws it - the opening, how each
 * section comes in, and what floats over the page. New artwork on an existing theme needs no code; a
 * new theme is a new entry here and its drawing there.
 */
const STYLES = [
  { key: "royal", label: "Royal", about: "Gold sparkles and a slow, grand reveal - weddings and receptions." },
  { key: "floral", label: "Floral", about: "Falling petals and soft fades - engagements, haldi, mehandi." },
  { key: "playful", label: "Playful", about: "Floating balloons and bouncy entrances - baby, kids and naming." },
  { key: "classic", label: "Classic", about: "Clean lines and gentle slides - corporate and formal events." },
];

const STYLE_KEYS = STYLES.map((style) => style.key);

// The typeface the names are set in; the rest of the words follow it.
const FONTS = [
  { key: "script", label: "Script", about: "Flowing handwriting - Great Vibes." },
  { key: "serif", label: "Elegant", about: "Fine serif capitals - Cormorant." },
  { key: "playful", label: "Playful", about: "Round and friendly - for little ones." },
  { key: "modern", label: "Modern", about: "Clean and simple - Poppins." },
];
const FONT_KEYS = FONTS.map((font) => font.key);

module.exports = { STYLES, STYLE_KEYS, FONTS, FONT_KEYS };
