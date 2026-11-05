export const AUTO_DELIVERABLES_BY_SERVICE = {
  "Indoor Photo Only": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Signature Album (Soft copy)", "Final Files Out"],
  "Outdoor Photo Only": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Signature Album (Soft copy)", "Final Files Out"],
  "Indoor Photo Shoot + Reels": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Outdoor Photo + Reels": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Traditional Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Bulk Edited Images", "Signature Album (Soft copy)", "Album Printing", "Final Files Out"],
  "Traditional Video": ["Raw - File IN", "Traditional Full Length", "Traditional Highlights", "Final Files Out"],
  "Candid Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Bulk Edited Images", "Retouches", "Signature Album (Soft copy)", "Album Printing", "Final Files Out"],
  "Candid Video": ["Raw - File IN", "Reels", "Cinematic Teaser", "Cinematic Highlights", "Cinematic Full Length", "Final Files Out"],
  Drone: ["Raw - File IN", "Final Files Out"],
  "Al Feature": ["QR Genration", "QR Publishing"],
  "Semi Candid Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Bulk Edited Images", "Retouches", "Signature Album (Soft copy)", "Album Printing", "Final Files Out"],
  "Semi Candid Video": ["Raw - File IN", "Reels", "Cinematic Teaser", "Cinematic Highlights", "Cinematic Full Length", "Final Files Out"],
  "360 Video Camera": ["Raw - File IN", "Full length", "Final Files Out"],
  "Pre/ Post Wedding Photography": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Pre/ Post Wedding Videography": ["Raw - File IN", "Reels", "Cinematic Highlights", "Final Files Out"],
  "Pre/ Post Wedding Candid Photography": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Pre/ Post Wedding Candid Videography": ["Raw - File IN", "Reels", "Cinematic Highlights", "Final Files Out"],
  "Corporate Video": ["Raw - File IN", "Final Files Out"],
  "Corporate Photo": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Final Files Out"],
  Headshots: ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Product Photography": ["Raw - File IN", "Photo Selection", "Retouches", "Final Files Out"],
  "Product Videography": ["Raw - File IN", "Final Files Out"],
  "Semi Candid Photo + reel": ["Unlimited Soft Copies", "Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Candid Photo + Reels": ["Raw - File IN", "Photo Selection", "Retouches", "Reels", "Signature Album (Soft copy)", "Final Files Out"],
  "Complementary Drone": ["Raw - File IN", "Final Files Out"],
  "Comp Drone": ["Raw - File IN", "Final Files Out"],
  "Only Post Production": ["Raw - File IN", "Final Files Out"],
};

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const autoDeliverablesByServiceKey = new Map(Object.entries(AUTO_DELIVERABLES_BY_SERVICE).map(([serviceName, deliverables]) => [normalizeName(serviceName), deliverables]));
const autoDeliverableNameKeys = new Set(Object.values(AUTO_DELIVERABLES_BY_SERVICE).flat().map(normalizeName));

export function autoDeliverableNamesForService(serviceName) {
  return autoDeliverablesByServiceKey.get(normalizeName(serviceName)) || [];
}

export function autoDeliverableNamesForServices(serviceNames) {
  const seen = new Set();
  const names = [];
  (serviceNames || []).forEach((serviceName) => {
    autoDeliverableNamesForService(serviceName).forEach((name) => {
      const key = normalizeName(name);
      if (seen.has(key)) return;
      seen.add(key);
      names.push(name);
    });
  });
  return names;
}

export function blockedDeliverableNamesForServices(serviceNames) {
  const selected = new Set((serviceNames || []).filter(Boolean).map(normalizeName));
  const blocked = new Set();
  if (selected.has("traditional video") && selected.has("candid video")) {
    blocked.add("Traditional Full Length");
    blocked.add("Traditional Highlights");
  }
  if (selected.has("traditional video") && selected.has("traditional photo")) {
    blocked.add("Traditional Highlights");
  }
  return blocked;
}

export function isAutoDeliverableName(name) {
  return autoDeliverableNameKeys.has(normalizeName(name));
}

export function findDeliverableDefinitionByName(definitions, name) {
  const normalized = normalizeName(name);
  return (definitions || []).find((definition) => normalizeName(definition.name) === normalized) || null;
}

export function deliverableExistsForShoot(rows, shootId, definition) {
  const normalizedName = normalizeName(definition.name);
  return (rows || []).some((row) => row.shootId === shootId && (row.deliverableDefinitionId === definition.id || normalizeName(row.deliverableName) === normalizedName));
}
