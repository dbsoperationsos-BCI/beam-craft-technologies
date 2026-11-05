/**
 * The bar under a table. By default its contents sit to the right, which suits a single note.
 *
 * `spread` is the layout every table with two notes wants — the first pushed left, the last
 * right, typically "Last updated" against "Total rows". It is a prop rather than something each
 * caller re-states, because they were all overriding `justify-end` with the same `!important`
 * class to get it.
 */
export default function TableFooter({ children, className = "z-10", contentClassName = "", spread = false }) {
  return <footer className={`${className} flex justify-end shrink-0 border-t border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 sm:px-4`}><div className={`flex flex-wrap items-end gap-3 ${spread ? "w-full justify-between" : "justify-end"} ${contentClassName}`}>{children}</div></footer>;
}
