/**
 * The first letters of the first two words of a name - what stands in for a photo wherever an
 * avatar has nothing to show, and for the name itself where there is no room for it.
 */
export function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
  return letters || "?";
}
