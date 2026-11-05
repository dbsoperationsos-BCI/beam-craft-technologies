"use client";

import { initialsOf } from "@/lib/initials";
import { timeAgo } from "@/lib/relativeTime.mjs";

/**
 * The comments panel beside a proof, in both review rooms.
 *
 * A row reads the way the pin on the spread does, and the way a comment reads anywhere else: the
 * author's initial, their name, how long ago, then what they said — rather than a number the
 * reader has to carry back to the photograph. Selecting a row opens that pin on the spread, and
 * the row the pin belongs to is the one highlighted.
 *
 * Both rooms draw the same list, which is why it is one component: the QC Lead and the client
 * read a correction the same way, and only what may be done to it differs.
 */

// The avatar's colour follows the correction's state, exactly as the pin's does.
const AVATARS = { RESOLVED: "bg-emerald-600", REOPENED: "bg-violet-600", DEFAULT: "bg-slate-700" };

export default function ProofCommentList({
  title, hint, comments = [], activeId, onSelect, emptyLabel = "No corrections on this spread.",
}) {
  return <>
    <div className="border-b border-slate-200 px-4 py-4">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {comments.length === 0 && <p className="py-12 text-center text-xs text-slate-500">{emptyLabel}</p>}
      <ul className="space-y-3">
        {comments.map((item) => {
          const author = item.author || "Comment";
          return <li key={item.id} className={`rounded-lg border p-3 transition ${item.id === activeId ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
            {/* One control for the whole card, holding only phrasing content so the markup stays
                valid — the note and the actions below carry buttons of their own. */}
            <button type="button" onClick={() => onSelect?.(item.id)} className="block w-full text-left">
              <span className="flex items-start gap-2.5">
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold uppercase text-white ${AVATARS[item.status] || AVATARS.DEFAULT}`}>{item.initial || initialsOf(author).slice(0, 1)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-xs font-semibold text-slate-900">{author}</span>
                    {item.createdAt && <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(item.createdAt)}</span>}
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap wrap-break-word text-xs leading-5 text-slate-600">{item.comment}</span>
                </span>
                {item.badge && <span className="shrink-0">{item.badge}</span>}
              </span>
            </button>
            {item.resolutionNote && <p className="mt-2 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">Resolution: {item.resolutionNote}</p>}
            {item.actions?.length > 0 && <div className="mt-2.5 flex flex-wrap gap-3 text-xs font-medium">
              {item.actions.map((action) => <button
                key={action.label}
                type="button"
                disabled={action.disabled}
                onClick={action.onSelect}
                className={`hover:underline disabled:opacity-50 ${action.tone === "danger" ? "text-rose-600" : action.tone === "reopen" ? "text-violet-700" : "text-blue-600"}`}
              >{action.label}</button>)}
            </div>}
          </li>;
        })}
      </ul>
    </div>
  </>;
}
