/**
 * Who covers for somebody who is away.
 *
 * Every employee may name two alternatives (`alternative1EmployeeId`, `alternative2EmployeeId`).
 * Together those make a directed graph - Vijay → Abi, Vijay → Kishore - and the CRM walks it to
 * decide who a lead goes to when the person it was meant for is on leave.
 *
 * **Any shape is allowed.** The studio arranges cover however it wants: a chain, a ring of three, or
 * two people who cover only each other. There used to be a rule refusing that last one - a direct
 * pair was rejected on save, and the employee form asked the server which ids to drop from its two
 * menus - on the grounds that a pair has nobody outside itself to hand the work to on a day both are
 * away. That was true but it was not worth a refusal: `availableCover` already answers "nobody" for
 * that day, which is the same answer the rule was protecting, and the rule cost every studio with
 * two people in a role a pairing it had every reason to want.
 *
 * So nothing here judges the graph. `alternativesProblem` in the employees controller still refuses
 * the two faults that are faults in a single row - naming yourself, and filling both slots with one
 * person - and that is the whole of it.
 *
 * Because any shape is allowed, `availableCover` below must never assume the walk ends on its own.
 * Its `seen` set is what guarantees termination, and is load-bearing rather than defensive.
 *
 * Nothing in this module reads a database. `leadCover.js` loads the graph and answers who is away;
 * this decides what those two facts mean.
 */

/**
 * The alternatives graph, from rows of `{ id, alternative1EmployeeId, alternative2EmployeeId }`.
 *
 * Order is kept - alternative 1 before alternative 2 - because it is the order work is offered in,
 * and the studio chose it.
 */
function buildChain(employees = []) {
  const next = new Map();
  for (const employee of employees) {
    const id = Number(employee?.id);
    if (!Number.isInteger(id)) continue;
    const alternatives = [employee?.alternative1EmployeeId, employee?.alternative2EmployeeId]
      .map((value) => (value === null || value === undefined ? null : Number(value)))
      .filter((value) => Number.isInteger(value) && value !== id);
    // The same person named in both slots is one alternative, not two.
    next.set(id, [...new Set(alternatives)]);
  }
  return { next };
}

/** The alternatives this employee names, in the order the studio put them. */
function alternativesOf(chain, employeeId) {
  return chain?.next?.get(Number(employeeId)) || [];
}

/**
 * Who can actually take this employee's work today, in the order it should be offered.
 *
 * **The nearest ring of cover that has anybody in it, and no further.** The two people the employee
 * named are asked first; only if *both* of them are also away does the search move out to whoever
 * they in turn named.
 *
 * That stopping rule is the point, not an optimisation. Vijay names Abi and Kishore; Abi is away
 * and Kishore is free. Carrying on outward would hand some of Vijay's leads to Abi's alternative -
 * somebody Vijay never nominated - while a person he did nominate sits free. So the ring is taken
 * whole or not at all, and the work is shared between whoever in it is available.
 *
 * Duplicates are dropped: if Abi and Kishore both name Priya and both are away, Priya appears once
 * and takes one share rather than two.
 *
 * An **empty list is a real answer**, not a failure: the whole chain is away, the employee is the
 * end of the line and named nobody, or they and their alternative cover only each other and both
 * are out. The lead stays unassigned, which is visible and recoverable; inventing a recipient is
 * not.
 *
 * Terminates because of `seen`, not because the graph is acyclic - no shape is refused any more, so
 * this walk genuinely can come back to where it started, by a ring or by a pair. Every employee is
 * visited at most once, so the worst case is one pass over the roster.
 */
function availableCover(chain, employeeId, isAway) {
  const start = Number(employeeId);
  if (!Number.isInteger(start)) return [];
  if (!isAway(start)) return [start];

  const seen = new Set([start]);
  let ring = alternativesOf(chain, start);
  while (ring.length) {
    const found = [];
    const nextRing = [];
    for (const candidate of ring) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (!isAway(candidate)) found.push(candidate);
      // Somebody away still passes the work on, which is what makes a chain a chain - but only
      // once nobody in their own ring can take it.
      else nextRing.push(...alternativesOf(chain, candidate));
    }
    if (found.length) return found;
    ring = nextRing;
  }
  return [];
}

module.exports = {
  buildChain,
  alternativesOf,
  availableCover,
};
