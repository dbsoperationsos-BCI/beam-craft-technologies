"use client";

import { useEffect } from "react";
import IconButton from "@/components/shared/IconButton";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useFocusTrap from "@/components/shared/useFocusTrap";
import CloseIcon from "@/components/ui/CloseIcon";
import { layers } from "@/constants/layers";

const sizes = {
  xs: "max-w-xs",
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-5xl",
  form: "max-w-[61.5rem]",
  wide: "max-w-[88rem]",
};

/**
 * The card is as tall as what it holds by default, which is right for a form or a confirmation.
 * A dialog showing a list wants the other behaviour: one height whatever is in it, so the card does
 * not resize as rows load, are filtered, or are cancelled. The viewport cap below still applies, so
 * a fixed height is a floor and a ceiling on a big screen and only a ceiling on a small one.
 */
const heights = {
  auto: "",
  // For the short list that still wants a steady card — a handful of roles, say. `tall` is for the
  // list long enough that a card this size would be mostly scrollbar.
  mid: "h-[30rem]",
  tall: "h-[42rem]",
};

/**
 * Everything that opens over the page and is not a full-screen form: confirmations, small forms,
 * and the lists a page shows on demand. It owns the behaviour each of those was repeating on its
 * own — the backdrop and the click that dismisses it, Escape, the locked page behind, and the roles
 * that make it a dialog to a screen reader.
 *
 * `layer` names where it stacks rather than taking a number; see `constants/layers`. A dialog opened
 * from inside a form panel passes "dialogOverPanel" so it clears the panel it was opened from.
 */
export default function Dialog({
  title,
  description,
  onClose,
  footer,
  headerActions,
  size = "sm",
  height = "auto",
  layer = "dialog",
  busy = false,
  bodyClassName = "",
  toolbar,
  onSubmit,
  children,
  // A back arrow before the title, for a dialog opened from a chooser of its own - the same "return
  // to where I was" SchemaFormPanel already offers a full-screen form. Back and the × can do the
  // same thing; they still both belong, because "return to where I was" and "dismiss this" are
  // different intents even when the destination is the same.
  onBack,
  backAriaLabel,
}) {
  // A dialog that collects something is the form itself, so its footer buttons submit it the way
  // they would anywhere else.
  const Card = onSubmit ? "form" : "section";
  /*
   * Escape closes it, unless something is on top of it or it is busy.
   *
   * Through the shared arbiter rather than a listener of its own: a dialog with a dropdown open
   * inside it used to hear the same Escape the dropdown did, so one press closed the list *and* the
   * dialog under it, losing whatever was being filled in. See `useEscapeKey` for the whole of it.
   *
   * `!busy` is passed as `enabled`, so a dialog mid-save is not on the stack at all and Escape falls
   * through to whatever is underneath. That is the honest behaviour - the save is not cancellable,
   * so the key is not about this dialog.
   */
  useEscapeKey(() => onClose?.(), !busy);

  /*
   * Focus goes into the dialog, stays in it, and goes back to whatever opened it.
   *
   * All three used to be missing except the last, which this file did for itself. A dialog left
   * focus on the button behind it, so the first Tab walked the page the dialog was covering rather
   * than the dialog's own fields - on a form dialog that is most of the way to unusable without a
   * mouse, and it made `aria-modal="true"` above a claim that was not true. `useFocusTrap` owns the
   * whole of it now, including the restore, so there is one answer rather than one per overlay.
   *
   * On the dialog itself rather than on the backdrop around it: the backdrop is not part of the
   * dialog, and nothing in it is meant to be reached by Tab.
   */
  const dialogRef = useFocusTrap();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  return <div
    // Dismissed by pressing the backdrop itself, never by a drag that started inside the dialog and
    // happened to end out here.
    onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose?.(); }}
    className={`fixed inset-0 ${layers[layer] || layers.dialog} flex items-center justify-center bg-slate-950/40 p-3 sm:p-4`}
  >
    <Card
      ref={dialogRef}
      onSubmit={onSubmit}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className={`flex ${heights[height] || heights.auto} max-h-[calc(100dvh-1.5rem)] w-full ${sizes[size] || sizes.sm} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl`}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {onBack && <IconButton onClick={onBack} disabled={busy} label={backAriaLabel || "Back"} size="sm" className="text-slate-500 hover:bg-slate-50 hover:text-slate-700">←</IconButton>}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
            {description && <p className="mt-1.5 text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">{description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {headerActions}
          {/* No handler, no button.
              *
              * Every other way out of a dialog is already `onClose?.()` - Escape, the backdrop - so
              * a caller that passes none has deliberately made one that cannot be dismissed. The x
              * was drawn anyway, which left a control that looks like the way out and does nothing:
              * worse than no control at all, because it reads as broken rather than as closed. The
              * WhatsApp gate on Leads & Followups is the first dialog to need this. */}
          {onClose && <IconButton onClick={() => onClose()} label={`Close ${title}`} className="text-slate-500 hover:bg-slate-100 hover:text-slate-700"><CloseIcon /></IconButton>}
        </div>
      </header>
      {/* Stays put while the body scrolls under it — a search box for a long list, say. */}
      {toolbar && <div className="shrink-0 border-b border-slate-200 px-5 py-3 sm:px-6">{toolbar}</div>}
      {children !== undefined && <div className={`min-h-0 flex-1 overflow-y-auto px-5 pt-4 ${footer ? "" : "pb-5"} sm:px-6 ${bodyClassName}`}>{children}</div>}
      {footer && <footer className="flex shrink-0 flex-col-reverse gap-3 px-5 py-5 sm:flex-row sm:justify-end sm:px-6">{footer}</footer>}
    </Card>
  </div>;
}
