/**
 * The small status pill's colours, by tone - one set, so a state reads the same in a dropdown row
 * (`Dropdown`'s `status` option) and as a badge (`StatusBadge`): green for what is settled and can be
 * acted on, grey for everything else.
 */
export const STATUS_TONES = Object.freeze({
  success: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200",
  neutral: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
});

export const statusToneClass = (tone) => STATUS_TONES[tone] || STATUS_TONES.neutral;
