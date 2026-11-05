// The guest's session for one event link, kept in localStorage so a returning guest lands straight
// in the gallery. Keyed by the link's code; a guest of two events holds two.
const keyFor = (code) => `dbs_ai_event_guest_${code}`;
export function getGuestSession(code) { if (typeof window === "undefined") return null; try { return window.localStorage.getItem(keyFor(code)); } catch { return null; } }
export function setGuestSession(code, session) { if (typeof window === "undefined") return; try { window.localStorage.setItem(keyFor(code), session); } catch { /* private mode */ } }
export function clearGuestSession(code) { if (typeof window === "undefined") return; try { window.localStorage.removeItem(keyFor(code)); } catch { /* private mode */ } }
