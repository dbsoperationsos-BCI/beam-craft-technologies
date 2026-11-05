"use client";

import { createContext } from "react";

/*
 * Present only in the album's print view (Download Album's PDF, `SignatureAlbumPrint`). Every
 * `AlbumImage` inside it loads at once rather than as it scrolls into view, and reports when its
 * photo has arrived (`add` when it starts, `settle` when it has loaded or failed), so the view can
 * say when the whole album is on the page. The client's page and the studio's preview have none.
 */
const AlbumPrintContext = createContext(null);

export default AlbumPrintContext;
