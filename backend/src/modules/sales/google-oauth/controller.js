const {
  buildFrontendRedirect,
  disconnectGoogleAccount,
  getConnectionForUser,
  getPickerAccessToken,
  getSpreadsheetTabsForUser,
  handleOAuthCallback,
  returnPathForState,
  startOAuth,
  mapConnection,
} = require("./service");

async function start(req, res) {
  try {
    const { authUrl } = await startOAuth(req.user);
    return res.json({ data: { authUrl } });
  } catch (error) {
    console.error("Unable to start Google OAuth:", error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to start Google OAuth." });
  }
}

async function callback(req, res) {
  try {
    const result = await handleOAuthCallback(req.query);
    return res.writeHead(302, {
      Location: result.redirectUrl,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Connection: "close",
    }).end();
  } catch (error) {
    console.error("Unable to complete Google OAuth:", error);
    // A refused consent goes back to the screen that asked for it, the same as a granted one.
    const path = await returnPathForState(req.query?.state);
    const redirectUrl = buildFrontendRedirect(`google=error&message=${encodeURIComponent(error.message || "Unable to complete Google OAuth.")}`, { path });
    return res.writeHead(302, {
      Location: redirectUrl,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Connection: "close",
    }).end();
  }
}

async function connection(req, res) {
  try {
    const record = await getConnectionForUser(req.user.id);
    return res.json({ data: mapConnection(record) });
  } catch (error) {
    console.error("Unable to load Google OAuth connection:", error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to load Google OAuth connection." });
  }
}

async function disconnect(req, res) {
  try {
    const result = await disconnectGoogleAccount(req.user.id);
    return res.json({
      message: result.disconnected ? `Disconnected ${result.googleEmail}.` : "No Google account was connected.",
      data: result,
    });
  } catch (error) {
    console.error("Unable to disconnect Google account:", error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to disconnect Google account." });
  }
}

async function pickerToken(req, res) {
  try {
    const payload = await getPickerAccessToken(req.user.id);
    return res.json({
      data: {
        accessToken: payload.accessToken,
        tokenExpiresAt: payload.tokenExpiresAt,
        connection: payload.connection,
      },
    });
  } catch (error) {
    console.error("Unable to load Google Picker token:", error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to load Google Picker token." });
  }
}

async function spreadsheetTabs(req, res) {
  try {
    const spreadsheetId = String(req.params.spreadsheetId || "").trim();
    const payload = await getSpreadsheetTabsForUser(req.user.id, spreadsheetId);
    return res.json({ data: payload });
  } catch (error) {
    console.error("Unable to load spreadsheet tabs:", error);
    return res.status(error.status || 500).json({
      code: error.code || undefined,
      message: error.message || "Unable to load spreadsheet tabs.",
    });
  }
}

module.exports = {
  callback,
  disconnect,
  connection,
  start,
  pickerToken,
  spreadsheetTabs,
};
