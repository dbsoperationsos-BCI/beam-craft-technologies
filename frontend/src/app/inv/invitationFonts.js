import { Cormorant_Garamond, Fredoka, Great_Vibes, Noto_Serif_Tamil, Poppins } from "next/font/google";

/*
 * The invitation's faces, served with the page (`next/font` self-hosts them at build time), so a
 * guest on a slow phone network never sees the names in a fallback face first. Each design picks the
 * face its names are set in (script, serif, playful, modern); the stylesheet reads these variables.
 * Tamil names fall through to Noto Serif Tamil, placed after each face in the stacks.
 */
const script = Great_Vibes({ subsets: ["latin"], weight: "400", variable: "--inv-font-script", display: "swap" });
const serif = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--inv-font-serif", display: "swap" });
// Fredoka is loaded as its variable font (weights 300-700, which covers the 400-600 the designs
// use). Asked for fixed weights, Google Fonts now answers with extension-less `/l/font?kit=` URLs
// that `next/font` cannot read, and the production build fails.
const playful = Fredoka({ subsets: ["latin"], weight: "variable", variable: "--inv-font-playful", display: "swap" });
const modern = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600"], variable: "--inv-font-modern", display: "swap" });
const tamil = Noto_Serif_Tamil({ subsets: ["tamil"], weight: ["400", "600"], variable: "--inv-font-tamil", display: "swap" });

export const invitationFontVariables = [script, serif, playful, modern, tamil].map((face) => face.variable).join(" ");
