const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : "");

function coupleFromProjectName(projectName) {
  const match = text(projectName).match(/([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?)\s*&\s*([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*)?)/);
  return match ? `${match[1]} & ${match[2]}` : "";
}

export function getGalleryDisplayName(gallery = {}) {
  const type = text(gallery.projectType).toUpperCase();
  const groomName = text(gallery.groomName);
  const brideName = text(gallery.brideName);
  const clientName = text(gallery.clientName);
  const companyName = text(gallery.companyName);
  if (type === "DUM_DUM") return [groomName, brideName].filter(Boolean).join(" & ") || coupleFromProjectName(gallery.projectName);
  if (type === "QUA_QUA") return clientName;
  if (type === "CORP") return companyName || clientName;
  return text(gallery.projectName);
}
