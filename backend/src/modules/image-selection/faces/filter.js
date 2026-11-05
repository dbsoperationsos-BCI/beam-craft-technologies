/**
 * The People filter as a Prisma `where` fragment on `ImageSelectionUpload`, spread into the
 * gallery's own listing beside its folder and selection conditions. Nothing is loaded and no
 * copy is made: "Person 1 in Reception" is the same photo query with one more condition.
 *
 * Takes one person id, or several - as an array or as the comma-separated string the query
 * carries - and answers photos that ANY of them is in. An empty object when no person is asked
 * for, so the listing is exactly what it always was.
 */
function personIds(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map((id) => String(id || "").trim()).filter(Boolean))];
}

function personWhere(value) {
  const ids = personIds(value);
  if (!ids.length) return {};
  return { faceMappings: { some: { personId: ids.length === 1 ? ids[0] : { in: ids } } } };
}

module.exports = { personWhere, personIds };
