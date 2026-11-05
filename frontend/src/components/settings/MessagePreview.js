/*
 * A message's wording as its reader will see it, filled from sample details - what every Templates
 * editor shows under the wording being typed. Nothing is sent; it only renders the text it is given.
 */
export default function MessagePreview({ text, label = "Preview with sample details" }) {
  if (!text) return null;
  return <div>
    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</p>
    <p className="mt-1.5 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{text}</p>
  </div>;
}
