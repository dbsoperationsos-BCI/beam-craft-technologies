/**
 * A project's shoots in date order: the earliest first, and a shoot with no date yet after every dated
 * one. MySQL sorts NULL first in an ascending order, which put the undated shoots at the head of every
 * list of a project's shoots - before the shoots that are actually coming up. Used as
 * `orderBy: { dateCreated: SHOOT_DATE_ASC }` (or under `shoot:` for a row joined to its shoot).
 */
const SHOOT_DATE_ASC = { sort: "asc", nulls: "last" };

module.exports = { SHOOT_DATE_ASC };
