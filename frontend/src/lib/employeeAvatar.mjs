/**
 * The `avatar` a picker option carries for a person - `{ name, photoUrl, seed }`, which `Dropdown`,
 * `MultiSelectField` and `EmailChipsField` draw with `EmployeeAvatar` beside the label.
 *
 * One function so every employee list builds it the same way. Accepts an Employee row
 * (`employeeName`) or a User row (`name`); the id seeds the initials' colour so the same person wears
 * the same colour on every screen. No photo, or a list endpoint that withheld one, falls back to
 * initials.
 */
export function avatarOf(person) {
  if (!person) return undefined;
  const name = String(person.employeeName ?? person.name ?? "");
  return { name, photoUrl: person.profilePhotoUrl || null, seed: person.id ?? name };
}

/** A `{ label, value }` option for a person, with their avatar on it. */
export function personOption(person, label, value) {
  return { label, value, avatar: avatarOf(person) };
}
