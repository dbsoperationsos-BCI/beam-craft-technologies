/**
 * Which way a figure moved against the period before, and the signed number that says so.
 *
 * Shared because two dashboards draw the same arrow - Image Selection's and the administrator's
 * attendance Dashboard - and the rule for it is one rule: nought is flat rather than up or down,
 * and a rise carries its plus sign so "+3" and "3" are never mistaken for each other.
 */
export function trendOf(delta) {
  const change = Number(delta || 0);
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return { direction, text: change > 0 ? `+${change.toLocaleString("en-IN")}` : change.toLocaleString("en-IN") };
}
