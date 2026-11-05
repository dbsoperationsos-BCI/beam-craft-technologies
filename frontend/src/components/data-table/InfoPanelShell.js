import ChevronIcon from "@/components/ui/ChevronIcon";
import CloseIcon from "@/components/ui/CloseIcon";

/**
 * `header` replaces the panel's title bar for a consumer that has something better to put
 * there - the CRM panel puts its tabs in the band, so the panel is not topped by a heading
 * that only repeats the tab beneath it. Leaving it out keeps the default title bar, and
 * passing `null` drops the band entirely.
 *
 * `title` is still required either way: it names the panel for the collapse and expand
 * controls, which are the only handle on it once the panel is shut.
 *
 * The collapse and expand control keeps its circle deliberately. It is not an icon button
 * sitting in a toolbar with a tinted fill on hover - it is a handle that straddles the
 * panel's edge, half over the table and half over the panel, and the white disc with its
 * ring is what separates it from the rows running underneath. Stripped back to a bare
 * chevron it loses its hit target and reads as a stray glyph. Every module's info panel
 * uses this same handle; leave it alone.
 *
 * Its ring and chevron are the module's own `border-slate-200` and `text-slate-700` - the
 * same tokens the CRM's cards, table edges and body text use. It is a handle, not something
 * to be noticed: a blue ring made it look active and a black one made it look drawn on.
 *
 * The chevron is `ChevronIcon`, not a `‹` or `›` character. Those are text: they carry the
 * font's own side bearings, which are not equal left and right, and they sit on a baseline
 * rather than in the middle of their line box. Centred by flexbox they still looked a pixel
 * or two off in the disc, and by how much depended on the font that had loaded. The icons are
 * symmetric paths in a square viewBox, so centring the box centres the mark.
 *
 * Below `sm` the panel is a full-screen sheet with its own `×` in the corner rather than a
 * drawer with a handle hanging off the edge, because at ~360px there is no table left
 * beside it for the handle to straddle.
 *
 * OPENING AND CLOSING
 *
 * One element in both states, which is what lets it animate. It used to be two asides picked
 * by `state`, and swapping one element for a differently sized one is a change CSS has
 * nothing to interpolate - the panel appeared and vanished on the spot.
 *
 * The two states differ by breakpoint, so the animation does too. From `lg` up the panel is a
 * column in the layout and collapsing narrows it to the 14 rail, so the width is what moves and
 * the table beside it widens in step. Below that it is an overlay with nothing to give room to,
 * so it slides off the right edge instead - cheaper to animate than width, and the honest gesture
 * for a drawer. `html` and `body` are `overflow-x: hidden`, which is what stops the parked panel
 * from widening the page.
 *
 * The body is faded rather than unmounted. Unmounted, closing would empty the panel on the first
 * frame and animate a blank white box; kept and faded, what you are closing is on screen for as
 * long as it takes to close. It is `aria-hidden` and inert to the pointer while shut, so a
 * screen reader and a stray click both see a panel that is closed - only the handle outside it
 * stays live, since that is the one control that reopens it.
 */
// The open and closed widths live in the two state strings below, never here. Both would be
// `lg:w-*` utilities of equal specificity, and Tailwind picks between them by its own ordering
// rather than by the order they are written — the same trap `Button` documents for its radius.
const PANEL_POSITION = "fixed inset-0 z-[80] flex h-dvh w-full flex-col bg-white sm:absolute sm:inset-y-0 sm:left-auto sm:right-0 sm:z-40 sm:h-full sm:w-[min(400px,92vw)] sm:border-l sm:border-slate-200 sm:shadow-[-3px_0_10px_rgba(15,23,42,0.035)] lg:relative lg:z-20 lg:shrink-0";
// Width and transform both, because which of the two moves depends on the breakpoint. Anyone who
// has asked the system to stop animating gets the old instant swap, which was never broken - only
// abrupt.
const PANEL_MOTION = "transition-[width,transform] duration-200 ease-out motion-reduce:transition-none";
// Parked off the right edge below `lg`, narrowed to the rail at `lg` — and pointer-events restored
// there, because at that width the rail is a real control rather than a panel in hiding.
const PANEL_CLOSED = "pointer-events-none translate-x-full lg:pointer-events-auto lg:w-14 lg:translate-x-0";
const PANEL_OPEN = "translate-x-0 lg:w-[360px]";

export default function InfoPanelShell({ title, state, onToggle, children, header, headerActions }) {
  const collapsed = state === "collapsed";

  return <aside className={`group ${PANEL_POSITION} ${PANEL_MOTION} ${collapsed ? PANEL_CLOSED : PANEL_OPEN}`}>
    {/* Shown only once the panel is down to the rail, where it is the only thing naming what the
        rail is. Below `lg` there is no rail — the panel has left the screen entirely. */}
    {collapsed && <span aria-hidden="true" className="absolute left-1/2 top-4 hidden -translate-x-1/2 text-xl text-slate-700 lg:block">ⓘ</span>}

    {/* Shut, the handle is always on show: it is the one control that reopens the panel, and a
        rail with nothing on it gives no hint that it opens. Open, the collapse handle shows
        itself only while the pointer is over the panel (or the handle itself — it is a child, so
        its own hover counts), so at rest the disc is not the one thing straddling a quiet edge.
        Keyboard focus reveals it too, and the mobile × is exempt — a touch screen has no hover to
        summon it with. */}
    {collapsed
      ? <button type="button" onClick={onToggle} aria-label={`Expand ${title.toLowerCase()}`} className="absolute top-1/2 -left-4 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 lg:flex"><ChevronIcon direction="left" size={20} /></button>
      : <button type="button" onClick={onToggle} aria-label={`Collapse ${title.toLowerCase()}`} className="absolute right-2 top-1.5 z-10 flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 focus-visible:opacity-100 sm:left-[-1.25rem] sm:right-auto sm:top-1/2 sm:-translate-y-1/2 sm:border sm:border-slate-200 sm:bg-white sm:opacity-0 sm:shadow-sm sm:hover:bg-slate-50 sm:group-hover:opacity-100"><span className="sm:hidden"><CloseIcon /></span><span className="hidden sm:inline"><ChevronIcon direction="right" size={20} /></span></button>}

    {/* Clipped, and held at the open width inside the clip, so narrowing the panel slides the
        contents out of view instead of reflowing every line of them on the way down to 14. */}
    <div
      aria-hidden={collapsed || undefined}
      className={`flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-150 ease-out motion-reduce:transition-none ${collapsed ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <div className="flex h-full min-h-0 w-full flex-col lg:w-[360px]">
        {header === undefined ? <header className="flex min-h-13 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 pr-14 sm:min-h-0 sm:px-3 sm:py-2.5 sm:pr-3"><h2 className="text-base text-slate-900">ⓘ&nbsp; {title}</h2>{headerActions}</header> : header}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  </aside>;
}
