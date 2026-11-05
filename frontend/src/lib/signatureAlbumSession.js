/*
 * The client's album session, in this browser only: what the PIN bought, kept per album, so a
 * second album on the same device asks for its own PIN.
 */
const sessionKey = (code) => `dbs_signature_album_session_${code}`;

const storage = () => (typeof window === "undefined" ? null : window.localStorage);

export function getAlbumSession(code) {
  try { return storage()?.getItem(sessionKey(code)) || null; } catch { return null; }
}
export function setAlbumSession(code, sessionToken) {
  try { storage()?.setItem(sessionKey(code), sessionToken); } catch { /* private mode: the PIN is asked again next time */ }
}
export function clearAlbumSession(code) {
  try { storage()?.removeItem(sessionKey(code)); } catch { /* nothing to clear */ }
}
