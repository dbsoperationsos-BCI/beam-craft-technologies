import { quotationFontVariables } from "../quotationFonts";

// The studio's Preview of an unsaved quotation is the client's sheet, so it is set in the same
// faces and laid out at the same sheet width as `/q/<token>` - see that layout for why.
export { viewport } from "../[token]/layout";

export default function QuotationPreviewLayout({ children }) {
  return <div className={quotationFontVariables}>{children}</div>;
}
