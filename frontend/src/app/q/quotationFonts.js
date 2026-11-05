import { Cormorant_Garamond, Great_Vibes, Noto_Sans_Tamil, Noto_Serif_Tamil, Oswald, Plus_Jakarta_Sans, Poppins } from "next/font/google";

/*
 * The client's copy sets its own type, and it is served with the page rather than fetched at the
 * moment the PDF renderer loads it: `next/font` self-hosts these at build time, so a heading is
 * never printed in a fallback face because the webfont arrived a beat late. Each is exposed as a
 * variable the template's stylesheet reads; nothing else in the application uses them.
 *
 * Shared by the quotation's own layout (`/q/<token>` and its Terms & Conditions and payment pages)
 * and the studio's Preview of an unsaved quotation (`/q/preview/<key>`), so the preview is set in
 * exactly the faces the client and the PDF get.
 */
const display = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--q-font-display", display: "swap" });
const body = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--q-font-body", display: "swap" });
const script = Great_Vibes({ subsets: ["latin"], weight: "400", variable: "--q-font-script", display: "swap" });
const condensed = Oswald({ subsets: ["latin"], weight: ["400", "500"], variable: "--q-font-condensed", display: "swap" });
const footer = Poppins({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--q-font-footer", display: "swap" });
/*
 * Tamil - a couple's names, an event like "Suvarna Daanam (சுவர்ண தானம்)", a note to the family.
 *
 * None of the faces above has a Tamil letter, so Tamil used to fall through to whatever font the
 * machine had: Nirmala UI on Windows, which is why the page looked right on a laptop - and nothing
 * on the Linux server that prints the PDF, which is why the PDF did not. These carry it with the
 * page instead (SIL Open Font License), each placed straight after the face it partners in the
 * stylesheet's stacks: the browser takes a letter from the first face that has it, so English stays
 * in the design's faces and only the Tamil comes from here. Serif beside the serif display face,
 * sans beside the rest.
 */
const tamilSerif = Noto_Serif_Tamil({ subsets: ["tamil"], weight: ["400", "500", "600", "700"], variable: "--q-font-tamil-serif", display: "swap" });
const tamilSans = Noto_Sans_Tamil({ subsets: ["tamil"], weight: ["400", "500", "600", "700"], variable: "--q-font-tamil-sans", display: "swap" });

export const quotationFontVariables = [display, body, script, condensed, footer, tamilSerif, tamilSans].map((font) => font.variable).join(" ");
