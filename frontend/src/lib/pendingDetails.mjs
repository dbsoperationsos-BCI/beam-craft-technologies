/**
 * What a shoot tile says of the answers still owed for it to be Planned - "4 details pending", or
 * "All details filled" - in one wording on Pre Production's tiles and Production's plan alike, so the
 * two boards read the same.
 */
export function pendingDetailsText(pending) {
  return pending === 0 ? "All details filled" : `${pending} ${pending === 1 ? "detail" : "details"} pending`;
}
