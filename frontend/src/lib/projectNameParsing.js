const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

export function extractCoupleNames(projectName) {
  if (!projectName) return null;
  const match = projectName.match(/([A-Za-z][A-Za-z.'-]*)\s*&\s*([A-Za-z][A-Za-z.'-]*)/);
  if (!match) return null;
  return { bride: capitalize(match[1]), groom: capitalize(match[2]) };
}

function extractSoloName(projectName) {
  if (!projectName) return null;
  const match = projectName.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/);
  return match ? match[1] : null;
}

export function extractDisplayName(projectName) {
  const couple = extractCoupleNames(projectName);
  if (couple) return { type: "couple", ...couple };
  const solo = extractSoloName(projectName);
  if (solo) return { type: "solo", name: solo };
  return { type: "raw", name: projectName };
}