/**
 * The title bar of a module page: the heading on the left, the page's actions on the right.
 *
 * It wraps rather than stacking. A page with one short action — Add Role, Add Vendor — keeps it up
 * beside the title on a phone, which is where there is room for it and where a reader looks for it.
 * A page with three, like Employee Repository, runs out of room and the actions drop to a line of
 * their own exactly as they used to. Which of the two happens is decided by the content at the
 * width it is being drawn at, not by a breakpoint guessing on its behalf.
 */
/**
 * `px-6` on a phone, not `px-3`, because the header above it is pulled out by `-mx-3` to span the
 * full width — the first 12px of this padding is spent undoing that, and only what is left of it
 * shows. At `px-3` nothing was left: the title started at the very edge of the screen and the last
 * button ended at it. The `sm` and `lg` values already allowed for their own negative margins,
 * which is why this only ever looked wrong on a phone.
 */
export default function PageHeaderTopRow({ children }) {
  return <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-6 py-2 sm:flex-nowrap sm:gap-3 sm:px-8 lg:px-9">{children}</div>;
}
