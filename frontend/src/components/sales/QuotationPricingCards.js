import { formatDay, formatRupees } from "@/lib/saleExtras.mjs";
import { Eyebrow, GOLD } from "./quotationSheetParts";

/**
 * The money on the client's quotation: the dark pricing card, and - once the studio has published the
 * project's extras - the Updated Total card that follows the EXTRA section.
 *
 * `QuotationPricingCard` is the card the sheet always drew, moved here unchanged so the quotation's own
 * figure prints exactly as before; the Updated Total reuses it rather than drawing a look-alike.
 */

/** The link, not the account: set the way the terms link is set - small, underlined, gold on navy. */
function PaymentLink({ href, label }) {
  return <p className="mt-4">
    <a href={href} className="text-[12.5px] font-semibold underline underline-offset-4" style={{ color: GOLD, letterSpacing: ".04em" }}>{label}</a>
  </p>;
}

export function QuotationPricingCard({ label, amountText, caption, gstLine, paymentHref, paymentLabel, validityText, className = "mt-7", children }) {
  return <section className={`q-navy mx-[18px] rounded-[26px] px-6 py-8 text-center text-white sm:mx-[45px] sm:px-10 ${className}`}>
    <Eyebrow color={GOLD} size="text-[12px]" className="tracking-[0.32em]">{label}</Eyebrow>
    <p className="mt-3 text-[48px] font-semibold leading-none tracking-tight sm:text-[64px]">{amountText}</p>
    {Boolean(caption) && <p className="mt-3 text-[13px] font-medium" style={{ color: "#e8ecf3" }}>{caption}</p>}
    {Boolean(gstLine) && <p className="q-label mt-3 text-[13px] font-medium tracking-[0.12em]" style={{ color: GOLD }}>{gstLine}</p>}
    {children}
    {Boolean(paymentLabel) && <PaymentLink href={paymentHref} label={paymentLabel} />}
    {Boolean(validityText) && <>
      <div className="mx-auto mt-6 h-px w-full max-w-3xl" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)" }} />
      <p className="mt-4 text-[13px]" style={{ color: "#e8ecf3" }}>{validityText}</p>
    </>}
  </section>;
}


/**
 * The Updated Total, after the EXTRA section and in the pricing card's own design: the saved total of
 * the latest published revision and the day it was published. Nothing else - not how it was reached,
 * not the revision - and the GST line only where the quotation's own card shows one.
 */
export function UpdatedTotalCard({ extras, gstLine }) {
  const updated = extras.publishedAt ? formatDay(extras.publishedAt) : "";
  return <QuotationPricingCard className="mt-4" label="Updated Total Amount" amountText={formatRupees(extras.updatedTotal)} gstLine={gstLine}>
    {Boolean(updated) && <p className="mt-3 text-[13px]" style={{ color: "#e8ecf3" }}>Updated {updated}</p>}
  </QuotationPricingCard>;
}
