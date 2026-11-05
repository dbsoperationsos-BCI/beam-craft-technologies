const variants = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-60",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  /*
   * No colours at all: the caller supplies them.
   *
   * For a control that has to take its colour from what it sits on — the edit disc on a tinted
   * money row — where any variant's own `hover:bg-*` would win over the caller's base colour and
   * turn it grey on hover. A tinted `hover:bg-*` cannot answer that either: hover utilities compile
   * to their own class names, which the dark themes do not repaint, so the disc would flash light
   * on a dark page. With nothing to fight, the caller can change state with opacity instead, which
   * means the same thing in either theme.
   */
  plain: "",
};

const sizes = {
  none: "",
  sm: "min-h-9 px-3 py-1.5",
  md: "min-h-10 px-4 py-2",
  lg: "min-h-11 px-5 py-2",
};

/**
 * What a button says while its request is in flight, worked out from what it says when it is not.
 *
 * One rule in one place, because the alternative is what the application had: some buttons greyed
 * and said nothing, some greyed and said "Saving...", and a reader could not tell the two apart from
 * "this is broken". A greyed button with no word is the worst of the three - it reads as *refused*
 * rather than *working*, which is the reading that makes somebody press again.
 *
 * Matched on the verb the button already leads with, so `Add Lead` becomes `Adding...` and
 * `Send Screening Form` becomes `Sending...` without either being written twice. A button whose
 * label this cannot read - an icon, an element, a word not on the list - says `Saving...`, which is
 * true of nearly every write and is the application's most common word for it by far. `busyLabel`
 * overrides any of it where the honest word is not the obvious one.
 */
const BUSY_WORDS = [
  [/^save\b/i, "Saving..."],
  [/^update\b/i, "Updating..."],
  [/^add\b/i, "Adding..."],
  [/^(re)?send\b/i, "Sending..."],
  [/^create\b/i, "Creating..."],
  [/^delete\b/i, "Deleting..."],
  [/^remove\b/i, "Removing..."],
  [/^cancel\b/i, "Cancelling..."],
  [/^submit\b/i, "Submitting..."],
  [/^(re)?schedule\b/i, "Scheduling..."],
  [/^approve\b/i, "Approving..."],
  [/^reject\b/i, "Rejecting..."],
  [/^invite\b/i, "Inviting..."],
  [/^link\b/i, "Linking..."],
  [/^disconnect\b/i, "Disconnecting..."],
  [/^verify\b/i, "Verifying..."],
  [/^raise\b/i, "Raising..."],
  [/^import\b/i, "Importing..."],
  [/^upload\b/i, "Uploading..."],
  [/^apply\b/i, "Applying..."],
  [/^move\b/i, "Moving..."],
  [/^convert\b/i, "Converting..."],
  [/^generate\b/i, "Generating..."],
  [/^restore\b/i, "Restoring..."],
  [/^archive\b/i, "Archiving..."],
];

function busyTextFor(children) {
  // Only a plain string can be read. An element or a fragment is a button drawing something of its
  // own, and guessing a verb out of it would be guessing.
  const label = typeof children === "string" ? children.trim() : "";
  const match = label && BUSY_WORDS.find(([pattern]) => pattern.test(label));
  return match ? match[1] : "Saving...";
}

export default function Button({
  children,
  variant = "secondary",
  size = "md",
  className = "",
  ariaLabel,
  /*
   * **The one guard every button that writes should wear.**
   *
   * `busy` disables the button *and* changes what it says, because those are two halves of one
   * message and the application had them apart: a button that only greys says "you may not do this",
   * which is a different thing from "this is happening", and is the reading that makes somebody
   * press again. Pair it with `useSubmitOnce`, which is what actually stops the second press - a
   * `disabled` applied on the next render is still one render too late for a double-click.
   *
   * `aria-busy` goes with it, so a screen reader is told the same thing the colour says.
   */
  busy = false,
  busyLabel,
  ...props
}) {
  const buttonProps = { ...props };
  const isBusy = Boolean(busy);
  // A caller's own `disabled` still stands: a button held shut by a missing field does not open
  // because nothing is in flight.
  if (isBusy) buttonProps.disabled = true;
  if (isBusy && buttonProps["aria-busy"] === undefined) buttonProps["aria-busy"] = "true";

  if (ariaLabel && buttonProps["aria-label"] === undefined) {
    buttonProps["aria-label"] = ariaLabel;
  }

  // The default radius is dropped when the caller supplies one of their own. Both would be
  // border-radius utilities of equal specificity, and Tailwind decides between them by its
  // own ordering rather than by the order they appear here - `rounded-md` was winning, so a
  // button asked for the module's `rounded-[14px]` corners quietly rendered at 6px.
  const radius = /(?:^|\s)!?rounded(?:-|\s|$)/.test(className) ? "" : "rounded-md";

  return (
    <button
      className={`inline-flex items-center justify-center ${radius} text-xs font-medium transition sm:text-sm disabled:cursor-not-allowed ${variants[variant]} ${sizes[size] ?? sizes.md} ${className}`}
      {...buttonProps}
    >
      {isBusy ? (busyLabel || busyTextFor(children)) : children}
    </button>
  );
}
