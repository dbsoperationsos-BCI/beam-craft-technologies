/**
 * The client quotation sheet's smallest shared pieces - its two golds and its small-caps label - in a
 * module of their own, so the pricing cards (`QuotationPricingCards.js`) can use them without
 * importing the page that renders them. `PublicQuotationPage` re-exports both for its other readers.
 */

export const GOLD = "#b9974f";
export const GOLD_DEEP = "#8a7a4a";

/** A small label in gold small caps: "CEREMONIAL ITINERARY", "SERVICES", "EVENT DATE". Shared with the payment page. */
export function Eyebrow({ children, className = "", color = GOLD_DEEP, size = "text-[11px]" }) {
  return <p className={`q-label ${size} font-semibold ${className}`} style={{ color }}>{children}</p>;
}
