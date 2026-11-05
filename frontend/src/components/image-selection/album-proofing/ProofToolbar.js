"use client";

import BrushRounded from "@mui/icons-material/BrushRounded";
import ChatBubbleOutlineRounded from "@mui/icons-material/ChatBubbleOutlineRounded";
import RadioButtonUncheckedRounded from "@mui/icons-material/RadioButtonUncheckedRounded";
import UndoRounded from "@mui/icons-material/UndoRounded";
import { PAINT_COLORS } from "@/lib/proofPaint.mjs";
import { PROOF_GLASS } from "./proofGlass";

/**
 * How a correction is marked, along the top edge of the proof: circle an area, or paint on the
 * spread.
 *
 * Neither was reachable before. An area was a drag and a drawing was impossible — a gesture nobody
 * is told about, on a picture that also pans and zooms. Naming them as tools makes the choice
 * visible, gives painting somewhere to live, and means a drag can only ever do the one thing the
 * reviewer has asked for.
 *
 * There is deliberately no pin tool. A bare point says where something is wrong without saying
 * what, and every correction worth sending already marks its own extent — the circle draws it, the
 * pen traces it. Corrections pinned as points before this still show, and are still read and
 * edited the same way; the point simply cannot be the whole of a new one.
 *
 * The pen carries what a pen needs and nothing else: the colours to mark in, and undo. Both appear
 * only while the pen is the chosen tool — a palette beside the circle tool is a control that does
 * nothing, which is worse than a control that is absent.
 *
 * It is **always open**, along the top right of the spread. It used to fold away behind a chevron
 * and start folded, which put every tool one press behind a control that said nothing about what
 * was inside it — on the screen whose whole purpose is marking corrections, marking was the one
 * thing not on screen. Folding was there to save room, and there was never much to save: the bar is
 * a row of 28px buttons along the top edge, and a proof is taller than it is wide far more often
 * than the other way about — an album page, a portrait spread — so the height is the scarce
 * direction and the top is the cheap one. It sits at the same place, on the same frosted pill, and
 * scrolls sideways within its own width rather than growing on a narrow screen.
 *
 * It is deliberately **translucent** — a wash at 35% over the photograph rather than a solid slab,
 * firming up to 75% under the pointer: it sits on top of the very thing being reviewed, so it is
 * barely there while the reviewer is looking and solid while they are using it. `backdrop-blur` is
 * what keeps the icons legible over a busy picture at that opacity.
 *
 * ── Blue means the tool, and only the tool ──
 *
 * Two different kinds of state live on this bar and they used to wear one costume. The corrections
 * button is an independent **toggle** — the rail is showing, or it is not. The circle and the pen
 * are a **radio group** — exactly one is chosen, always. Both drew their active state as the same
 * `bg-blue-100 text-blue-700`, so in the ordinary case — rail open, circle in hand — two buttons
 * looked equally chosen and the bar read as though two tools were active at once.
 *
 * So blue is now reserved for the tool: whatever else is going on, exactly one button on this bar
 * is blue and it is the one a drag will use. The corrections toggle says "on" in neutral instead —
 * a soft dark wash, pressed *into* the glass, where the hover state lifts *out* of it toward white.
 * A rule between the two groups says the same thing a second way, for anyone who reads shape before
 * colour.
 *
 * The same toolbar serves the QC Lead and the client.
 */
const TOOLS = [
  { id: "circle", label: "Circle an area", Icon: RadioButtonUncheckedRounded, hint: "Drag on the spread" },
  { id: "pen", label: "Paint on the spread", Icon: BrushRounded, hint: "Drag to draw" },
];

export default function ProofToolbar({
  tool,
  onToolChange,
  penColor,
  onPenColorChange,
  onUndo,
  canUndo = false,
  commentsOpen = false,
  onToggleComments,
  canMark = true,
  className = "",
}) {
  /*
   * A room nobody may mark still has corrections to read.
   *
   * The marking tools belong to whoever may rule on the album — the QC Lead while it is in QC
   * review, the client while their round is open — but the list of what has already been said
   * belongs to anyone looking. Gating the whole bar on the right to mark took the corrections rail
   * with it, because the button that opens it lives here: a reader could see a spread and had no
   * way left to see what was written on it.
   */
  if (!canMark && !onToggleComments) return null;

  /*
   * The focus ring is stated rather than left to the browser.
   *
   * Chrome's default is `outline: auto 1px rgb(35,40,48)` — a near-black ring, and on a round button
   * it is drawn as a black circle. On a pale bar over a photograph that reads as part of the icon
   * rather than as focus, and on the circle tool it reads as a second, wrong-coloured ring around
   * the right one. Blue says the same thing in the application's own colour. It stays `focus-visible`
   * rather than `focus`, so it answers the keyboard and does not ring every button that is clicked.
   */
  const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500";
  const round = `grid h-7 w-7 shrink-0 place-items-center rounded-full transition ${focusRing}`;
  // The frosted wash the bar is drawn on. Shared with the zoom pill on the same screen — see
  // proofGlass.js for why it is blur rather than a plain transparent fill.
  const pill = PROOF_GLASS;

  return (
    <div className={`absolute right-2 top-2 z-20 flex max-w-[calc(100%-1rem)] justify-end ${canMark ? "" : "max-lg:hidden"} ${className}`}>
      {/* The scrolling belongs to the pill, not to a box around it. A wrapper with `overflow-x-auto`
          clips everything drawn outside its own edges — the pill's shadow and its rounded ends with
          it — which read on screen as a hard grey band cutting the toolbar off. */}
      <div className={`group flex min-w-0 items-center gap-1 overflow-x-auto rounded-full p-1 ${pill} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
        {/* Only where there is a rail for it to open. Below `lg` the spread's corrections are listed
            under the proof instead, so a button promising to show them would promise nothing. */}
        {onToggleComments && <button
          type="button"
          aria-label={commentsOpen ? "Hide the corrections" : "Show the corrections"}
          aria-pressed={commentsOpen}
          title={commentsOpen ? "Hide the corrections" : "Show the corrections"}
          onClick={() => onToggleComments(!commentsOpen)}
          className={`${round} hidden lg:grid ${commentsOpen ? "bg-slate-900/10 text-slate-900 hover:bg-slate-900/15" : "text-slate-600 hover:bg-white/70 hover:text-slate-900"}`}
        >
          <ChatBubbleOutlineRounded style={{ fontSize: 16 }} />
        </button>}

        {/* The panel toggle is one group and the tools are another; this is where one ends.
            Hidden exactly where the button before it is hidden — that button is `lg` and up only,
            so below `lg` this would be a rule with nothing on its left, opening the bar on a line.
            Drawn only when there is something on *both* sides of it. */}
        {onToggleComments && canMark && <span aria-hidden="true" className="mx-0.5 hidden h-5 w-px shrink-0 bg-slate-300/70 lg:block" />}

        {canMark && TOOLS.map(({ id, label, Icon, hint }) => <button
          key={id}
          type="button"
          aria-label={label}
          aria-pressed={tool === id}
          title={`${label} — ${hint}`}
          onClick={() => onToolChange(id)}
          className={`${round} ${tool === id ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-white/70 hover:text-slate-900"}`}
        >
          <Icon style={{ fontSize: 16 }} />
        </button>)}

        {canMark && tool === "pen" && <>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-slate-300/70" />
          {PAINT_COLORS.map((color) => <button
            key={color}
            type="button"
            aria-label={`Paint in ${color}`}
            aria-pressed={penColor === color}
            onClick={() => onPenColorChange(color)}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition hover:bg-white/70 ${focusRing} ${penColor === color ? "ring-2 ring-blue-400" : ""}`}
          >
            <span className="h-4 w-4 rounded-full border border-black/15" style={{ backgroundColor: color }} />
          </button>)}
          <button
            type="button"
            aria-label="Undo the last stroke"
            title="Undo the last stroke"
            onClick={onUndo}
            disabled={!canUndo}
            className={`${round} text-slate-600 hover:bg-white/70 hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent`}
          >
            <UndoRounded style={{ fontSize: 16 }} />
          </button>
        </>}
      </div>
    </div>
  );
}
