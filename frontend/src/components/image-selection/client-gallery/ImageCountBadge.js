import Collections from "@mui/icons-material/Collections";

export default function ImageCountBadge({ count }) {
  if (!Number.isFinite(count) || count < 0) return null;
  return <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-semibold tracking-[0.12em] text-slate-600 shadow-sm"><Collections style={{ fontSize: 15 }} aria-hidden="true" />{count.toLocaleString("en-IN")} TOTAL IMAGES</span>;
}
