/**
 * A captured position as a link that opens it on the map - Google Maps, which every phone and
 * desktop in the studio opens - or null where there is no position to show. Pure: no request, no
 * state; the coordinates go in the address as numbers and nothing else.
 */
export function mapLinkFor(position) {
  // A missing coordinate is no position - not 0, which is somewhere in the Atlantic.
  if (!position || position.latitude === null || position.latitude === undefined || position.latitude === ""
    || position.longitude === null || position.longitude === undefined || position.longitude === "") return null;
  const latitude = Number(position.latitude);
  const longitude = Number(position.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}
