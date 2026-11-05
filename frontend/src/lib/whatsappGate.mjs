/**
 * Whether this session is one the application should be held shut for.
 *
 * Every account that is not an administrator must have WhatsApp paired before it may use the
 * application: a CRM working a morning of leads with the one channel the client is answering on
 * disconnected is the fault this exists to stop, and a notice that can be dismissed is one people
 * learn to dismiss unread.
 *
 * Answered from the session endpoint's reply alone, and every way it says *no* is deliberate:
 *
 *   * **An administrator is told nothing about WhatsApp at all.** They do not work leads, so a
 *     dialog about a channel they do not use is noise on every screen they open - and they are the
 *     people who have to reach Settings and Login Credentials to put somebody *else's* WhatsApp
 *     right, which a dialog in the way does not help with. The server decides who is one, because
 *     "administrator" means a Super Admin or any role carrying the Administrator tick.
 *   * **Somebody who is not allowed to link is never asked to.** The studio-wide WhatsApp switch and
 *     the account's own are both read as off *only when the server actually said off*, so a reply
 *     that carries neither leaves the rule working rather than silently lifting it. Holding somebody
 *     at a door they have no key to would be worse than not holding them at all.
 *   * **A session that is already linked needs nothing.**
 *   * **`null` - which is what a failed read gives - is not an answer either way, and says no.**
 *     Locking somebody out of the application on the strength of a request that did not come back is
 *     the one failure this must never have.
 *
 * Free of React and of the browser so `test/whatsapp-gate.test.mjs` can hold the rules.
 */
export function whatsappLinkNeeded(session) {
  if (!session) return false;
  if (session.isAdmin === true) return false;
  if (session.chatEnabled === false || session.userChatEnabled === false) return false;
  // Anything that is not a live link is one worth holding for - pairing included, since a code
  // somebody walked away from leaves them just as unreachable as never having started.
  return session.status !== "connected";
}
