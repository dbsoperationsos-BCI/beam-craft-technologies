import { CATEGORY_LABELS, formatDay } from "@/lib/saleExtras.mjs";
import { Eyebrow } from "./quotationSheetParts";

/**
 * The client quotation's EXTRA section, between the quotation's own pricing card and the Updated
 * Total: every published addition and removal since the quotation was booked, from the latest
 * published revision only (`saleExtras` on the public answer), so a draft never shows. Never a price -
 * what the items cost is in the Updated Total alone. A group with nothing in it is not drawn, and with
 * nothing in either the section is not drawn at all.
 *
 * Four columns from `sm` up; below it each item stacks, its column names written beside the values.
 */

const COLUMNS = "sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]";

function ItemGroup({ title, items }) {
  if (!items?.length) return null;
  return <div className="q-inner rounded-2xl px-5 py-5 sm:px-6" style={{ background: "#fffefc", boxShadow: "0 0 0 1px rgba(28,28,28,0.03), 0 8px 24px -18px rgba(28,28,28,0.25)" }}>
    <Eyebrow size="text-[13px]" className="tracking-[0.22em]">{title}</Eyebrow>
    <div className={`q-label mt-3 hidden gap-4 pb-2 text-[11px] font-semibold text-slate-600 sm:grid ${COLUMNS}`}>
      <span>Item</span><span>Category</span><span>Related Shoot</span><span>Created Date</span>
    </div>
    <ul className="mt-2 sm:mt-0">
      {items.map((item, index) => <li key={`${item.item}-${index}`} className={`grid grid-cols-1 gap-0.5 border-t py-2.5 sm:items-baseline sm:gap-4 ${COLUMNS}`} style={{ borderColor: "#eee7d9", color: "#262626" }}>
        <span className="min-w-0 break-words text-[15px] font-semibold leading-snug">
          {item.item}
          {Boolean(item.detail) && <span className="block text-[12px] font-normal text-slate-500">{item.detail}</span>}
        </span>
        <span className="text-[13px] text-slate-600"><span className="sm:hidden">Category: </span>{CATEGORY_LABELS[item.category] || item.category || "Extra"}</span>
        <span className="min-w-0 break-words text-[13px] text-slate-600"><span className="sm:hidden">Related shoot: </span>{item.relatedShoot || "—"}</span>
        <span className="text-[13px] text-slate-600"><span className="sm:hidden">Created: </span>{formatDay(item.createdDate)}</span>
      </li>)}
    </ul>
  </div>;
}

export default function QuotationExtraSection({ extras }) {
  if (!extras?.added?.length && !extras?.removed?.length) return null;
  return <section className="q-card mx-[18px] mt-4 rounded-[24px] px-5 py-7 sm:mx-[45px] sm:px-7" aria-label="Extra">
    <h2 className="q-display text-[24px] font-semibold" style={{ color: "#1c1c1c" }}>Extra</h2>
    <div className="mt-5 space-y-5">
      <ItemGroup title="Added Items" items={extras.added} />
      <ItemGroup title="Removed Items" items={extras.removed} />
    </div>
  </section>;
}
