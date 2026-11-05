/*
 * What moving a lead off each vertical clears - the fields only that vertical asks, as the server's
 * `VERTICAL_ONLY_COLUMNS` (crmLeadService.js) clears them, plus that vertical's custom fields. Said in
 * Bulk Update's warning and the lead popup's Vertical field before a move is confirmed.
 */
export const VERTICAL_MOVE_CLEARS = {
  "Dum Dum": "relationship, the groom's and bride's names, contacts and locations, and the reference",
  "Qua Qua": "the baby or mother's name, the date of birth / EDOD, shoot type, IH/OH, shoot ID and contact repeated, and its newborn and birthday occasions",
  Corp: "the company details - company, decision-maker, designation, contact number, alternate mobile, official email, website, company type and size, branches, project type, shoot city, expected budget and competitions",
};
export const MOVE_TARGETS = ["Dum Dum", "Qua Qua", "Corp"];

/** The warning a move carries, in one sentence - the same words on Bulk Update and in the lead popup. */
export function verticalMoveWarning(from, to) {
  return `Data may be lost. Moving from ${from} to ${to} permanently clears ${VERTICAL_MOVE_CLEARS[from] || "what only that vertical asks"}, and ${from}'s custom fields - moving it back does not bring them back.`;
}
