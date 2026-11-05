import { Cormorant_Garamond, Plus_Jakarta_Sans } from "next/font/google";
import { ClientCurtainProvider } from "@/components/client/ClientCurtain";

/*
 * The client's own pages - their sign-in and their project - in the two faces the client's copy of
 * a quotation already uses (`app/q/[token]/layout.js`), so what a client is sent and where they
 * follow their project read as one studio: Plus Jakarta Sans for everything read, Cormorant
 * Garamond (`--client-serif`) for the few lines that are the page's voice - the project's name, a
 * stage's name, the sign-in's line. Self-hosted by `next/font` at build time; no studio screen
 * uses either here.
 */
const clientFace = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap" });
const clientSerif = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], style: ["normal", "italic"], variable: "--client-serif", display: "swap" });

/*
 * The client pages' palette, defined once here and read everywhere below as `var(--client-…)`:
 *
 *   --client-primary  #D6B11A  gold - the actions, the stage being worked on, the progress fill
 *   --client-sand     #E4C9B0  sand - developed frames, soft fills, the page's warmth
 *   --client-earth    #856B50  earth - text and marks on white, the sign-in's panel
 *
 * Gold is too light to carry white text (about 2:1), so on gold the text is `--client-ink`, the earth
 * taken most of the way to black (about 7:1), and gold is never thin text on white - earth is, at
 * about 5:1. `--client-film` is the film strip's own stock, the ink a shade deeper. A status pill
 * keeps its own colours (`PROGRESS_COLORS`): those mean the same thing across the application.
 */
const CLIENT_PALETTE = {
  "--client-primary": "#D6B11A",
  "--client-sand": "#E4C9B0",
  "--client-earth": "#856B50",
  "--client-ink": "color-mix(in srgb, #856B50 45%, black)",
  "--client-film": "color-mix(in srgb, #856B50 32%, black)",
  "--client-primary-hover": "color-mix(in srgb, #D6B11A 88%, #856B50)",
};

// The curtain lives here, above both pages, because this layout stays put as the client moves
// between them: drawn over the one they leave, drawn off the one they arrive at.
export default function ClientLayout({ children }) {
  return <div className={`${clientFace.className} ${clientSerif.variable}`} style={CLIENT_PALETTE}>
    <ClientCurtainProvider>{children}</ClientCurtainProvider>
  </div>;
}
