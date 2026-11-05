/**
 * The People filter as a Prisma `where` fragment on `ImageSelectionUpload`, spread into the
 * gallery's own listing beside its folder and selection conditions. Nothing is loaded and no
 * copy is made: "Person 1 in Reception" is the same photo query with one more condition.
 *
 * Takes one person id, or several - as an array or as the comma-separated string the query
 * carries - and answers photos that EVERY one of them is in together: Person 1 and Person 2 means
 * the frames holding both, never the frames holding either. One condition per person, so a photo
 * mapped to the same person twice still counts once. An empty object when no person is asked for,
 * so the listing is exactly what it always was.
 */
// How many people may be asked for together. Each is its own condition on the query, and a frame
// holding more than ten people who were all singled out is not a thing anyone looks for; the
// gallery's rail refuses the eleventh with the same number.
const MAX_PEOPLE = 10;

function personIds(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(list.map((id) => String(id || "").trim()).filter(Boolean))];
}

function personWhere(value) {
  const ids = personIds(value);
  if (!ids.length) return {};
  const inPhoto = (personId) => ({ faceMappings: { some: { personId } } });
  return ids.length === 1 ? inPhoto(ids[0]) : { AND: ids.map(inPhoto) };
}

module.exports = { personWhere, personIds, MAX_PEOPLE };
