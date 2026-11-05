import { quotationFontVariables } from "../quotationFonts";

// The sheet's faces - the design's five and the Tamil beside them - live in `../quotationFonts`,
// shared with the studio's Preview so both are set alike.

/*
 * The client's copy is one 1080px sheet, and it is the same sheet on a phone as on a laptop.
 *
 * Without this the page reflowed: 360px on a phone, 736px on a tablet, 1080px on a laptop - three
 * layouts, only the last of which is the one printed into the PDF. So a client opening the link on
 * their phone and the PDF they were sent were visibly different documents, which is not what a
 * quotation should be.
 *
 * Declaring the viewport as the sheet's own width hands the whole design to the browser and lets it
 * scale to fit - a tablet lands near full size, a phone at about a third, and pinch-zoom reads the
 * rest. That is how a PDF behaves on a phone, which is what this is. `initialScale` is deliberately
 * not set: the browser's own fit-to-width is what makes the sheet whole on screen, and pinning it
 * to 1 would leave the reader panning sideways instead. Nothing caps the zoom, so it stays readable.
 *
 * The PDF is untouched by this. Its renderer sets an explicit 1080px viewport with no mobile
 * emulation, and Chrome only honours a meta viewport when emulating a device - see
 * `backend/src/services/quotationPdfService.js`.
 *
 * On the layout, so the quotation and its Terms & Conditions page - the same sheet - agree.
 */
/** The sheet itself, and the frame the page sets it in (`sm:px-4` on the page's own `main`). */
const SHEET_WIDTH_PX = 1080;
const SHEET_FRAME_PX = 16;
/*
 * Both, because the viewport has to hold the frame as well as the sheet. Declared at 1080 alone the
 * frame ate into it and the sheet came out 1048 wide on a phone against 1080 on a laptop - the same
 * design, but 32px narrower, which is enough to wrap a line somewhere else. Named rather than
 * written as 1112 so the next person can see where the number comes from.
 */
export const viewport = {
  width: SHEET_WIDTH_PX + SHEET_FRAME_PX * 2,
  /*
   * Null rather than absent, and it matters: Next's own default is `initial-scale=1`, and left in
   * place beside a width this wide it tells the browser to draw the sheet at 1:1 and let the reader
   * pan sideways - the opposite of what is wanted. Next omits the property entirely when it is null
   * (`if (viewport.initialScale != null)` in `next/dist/lib/metadata/metadata.js`), which leaves the
   * browser to do what it does with a width and no scale: fit it to the screen.
   */
  initialScale: null,
};

export default function QuotationPublicLayout({ children }) {
  return <div className={quotationFontVariables}>{children}</div>;
}
