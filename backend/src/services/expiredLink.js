/**
 * What an expired client link answers, the same way for every kind of link - a quotation, a
 * Photo Selection gallery, a Signature Album, an album proof, an event gallery.
 *
 * The status is the 410 each of them already answered, and beside the message an `expiredLink`
 * that is deliberately empty. An expired link tells whoever holds it that it has expired and
 * nothing more: not what it was for, not whose it was, not when it lapsed - the client's page
 * says only "This link has expired" and whom to ask. The key stays so every caller and every
 * client reads the one shape it always has. A token that names nothing still answers each
 * module's own 404 and never reaches this.
 */
function expiredLink() {
  return {};
}

/**
 * The one message every expired link answers with. Not "This quotation link..." or "This gallery
 * link...": the words would name the kind of document behind the token as plainly as a `type`
 * field did, and each module's own phrasing told the kinds apart even where it did not.
 */
const EXPIRED_LINK_MESSAGE = "This link has expired. Please contact the studio for a new link.";

/** The error a service throws for a link that has lapsed; its controller sends `expiredLinkBody`. */
function expiredLinkError() {
  return Object.assign(new Error(EXPIRED_LINK_MESSAGE), { status: 410, expiredLink: expiredLink() });
}

/** What a controller adds to an error's JSON: the expired link's answer, when it is one. */
const expiredLinkBody = (error) => (error?.expiredLink ? { expiredLink: error.expiredLink } : {});

module.exports = { EXPIRED_LINK_MESSAGE, expiredLink, expiredLinkError, expiredLinkBody };
