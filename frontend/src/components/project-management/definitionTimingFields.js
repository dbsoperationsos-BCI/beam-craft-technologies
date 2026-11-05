/*
 * The vocabulary a service's timing and shoot type are stored in, shared by the Add / Edit Service
 * dialog and the Services table.
 *
 * This module once drew the Shoot Type radio, the Session Timing tick boxes and the Duration field
 * for the service and deliverable dialogs. Neither dialog asks those questions any more - a
 * service answers them line by line in its Pricing section, and a deliverable is not asked - so
 * only the constants the remaining screens read are left.
 */

/** The timing typed in hours and minutes, as the record spells it. */
export const HOURS_MINUTES = "HOURS_MINUTES";

/** Whether the service is booked in the studio's sessions, which is what a timing option set names. */
export function sessionsTicked(timingModes) {
  return timingModes.includes("HALF_SESSION") || timingModes.includes("FULL_SESSION");
}

/*
 * The shoot types a service can be offered for, worded as the Add Shoot dialog words them so the
 * two screens are plainly talking about the same thing.
 */
export const SHOOT_TYPE_OPTIONS = [
  { label: "Studio / In-House", value: "STUDIO" },
  { label: "Outdoor / On-Location", value: "OUTDOOR" },
];
