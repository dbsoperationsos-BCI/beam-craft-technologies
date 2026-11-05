const POSTAL_API_URL = "https://api.postalpincode.in";

function normalizeResponse(payload) {
  const result = Array.isArray(payload) ? payload[0] : null;
  if (result?.Status !== "Success" || !Array.isArray(result.PostOffice)) return [];
  return result.PostOffice.map((office) => ({ branchName: office.Name || "", city: office.Block || office.Division || "", district: office.District || "", state: office.State || "", country: office.Country || "India", pincode: String(office.Pincode || ""), branchType: office.BranchType || "" })).filter((office) => office.branchName && office.district && office.state && office.pincode);
}

async function postalRequest(path, signal) {
  const response = await fetch(`${POSTAL_API_URL}${path}`, { signal });
  if (!response.ok) throw new Error("Postal address lookup is unavailable.");
  return normalizeResponse(await response.json());
}

export function searchPostOffices(query, signal) {
  const value = String(query || "").trim();
  if (/^\d{6}$/.test(value)) return postalRequest(`/pincode/${value}`, signal);
  if (value.length < 3) return Promise.resolve([]);
  return postalRequest(`/postoffice/${encodeURIComponent(value)}`, signal);
}

export function formatPostalAddress(office) { return `${office.branchName} - ${office.pincode}`; }
