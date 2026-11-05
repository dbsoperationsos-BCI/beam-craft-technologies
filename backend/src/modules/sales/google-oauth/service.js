const { google } = require("googleapis");
const prisma = require("../../../config/db");
const { encryptText, decryptText, generateStateToken, hashState } = require("./crypto");

// One consent covers every Google feature the CRM uses. `calendar.events` was added for
// Meet scheduling and is purely additive: an account connected before it keeps working for
// Sheets on its existing grant, and only needs reconnecting to gain Calendar. Nothing here
// narrows or replaces the Sheets scopes.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.file",
  CALENDAR_SCOPE,
];

// Whether a stored connection may touch Calendar. Read from the scopes granted at consent
// rather than assumed, so an older connection is told to reconnect instead of failing with
// a raw Google 403 the user cannot act on.
function connectionHasCalendarScope(connection) {
  return String(connection?.scopes || "").split(/[\s,]+/).filter(Boolean).includes(CALENDAR_SCOPE);
}

const CREATE_CONNECTION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_google_account_connection\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`user_id\` INTEGER NOT NULL,
  \`google_account_id\` VARCHAR(191) NOT NULL,
  \`google_email\` VARCHAR(191) NOT NULL,
  \`google_display_name\` VARCHAR(191) NULL,
  \`access_token_encrypted\` TEXT NULL,
  \`refresh_token_encrypted\` TEXT NULL,
  \`token_expires_at\` DATETIME(3) NULL,
  \`scopes\` TEXT NOT NULL,
  \`status\` VARCHAR(30) NOT NULL DEFAULT 'CONNECTED',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`sales_google_account_connection_userId_key\` (\`user_id\`),
  INDEX \`sales_google_account_connection_googleAccountId_idx\` (\`google_account_id\`),
  INDEX \`sales_google_account_connection_googleEmail_idx\` (\`google_email\`),
  INDEX \`sales_google_account_connection_status_idx\` (\`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const CREATE_OAUTH_STATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`sales_google_oauth_state\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`state_hash\` CHAR(64) NOT NULL,
  \`user_id\` INTEGER NOT NULL,
  \`purpose\` VARCHAR(30) NOT NULL DEFAULT 'connect',
  \`expires_at\` DATETIME(3) NOT NULL,
  \`consumed_at\` DATETIME(3) NULL,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`sales_google_oauth_state_stateHash_key\` (\`state_hash\`),
  INDEX \`sales_google_oauth_state_userId_expiresAt_idx\` (\`user_id\`, \`expires_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

let connectionTableReadyPromise = null;
let oauthStateTableReadyPromise = null;

async function ensureConnectionTableExists() {
  if (!connectionTableReadyPromise) {
    connectionTableReadyPromise = prisma.$executeRawUnsafe(CREATE_CONNECTION_TABLE_SQL).catch((error) => {
      connectionTableReadyPromise = null;
      throw error;
    });
  }
  return connectionTableReadyPromise;
}

async function ensureOAuthStateTableExists() {
  if (!oauthStateTableReadyPromise) {
    oauthStateTableReadyPromise = prisma.$executeRawUnsafe(CREATE_OAUTH_STATE_TABLE_SQL).catch((error) => {
      oauthStateTableReadyPromise = null;
      throw error;
    });
  }
  return oauthStateTableReadyPromise;
}

function getOAuthClient() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENTID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENTSECRET || "").trim();
  const redirectUri = String(process.env.GOOGLE_OAUTH_REDIRECT_URI || process.env.GOOGLE_OAUTH_CALLBACK_URL || process.env.GOOGLE_OAUTH_REDIRECTURL || "").trim();
  if (!clientId || !clientSecret || !redirectUri) {
    const missing = [];
    if (!clientId) missing.push("GOOGLE_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
    if (!redirectUri) missing.push("GOOGLE_OAUTH_REDIRECT_URI");
    const error = new Error(`Google OAuth is not configured. Missing: ${missing.join(", ") || "unknown"}.`);
    error.status = 500;
    throw error;
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getFrontendRedirectUrl() {
  return String(process.env.GOOGLE_OAUTH_FRONTEND_REDIRECT_URI || process.env.FRONTEND_URL || "http://localhost:3000/sales/crm").trim();
}

/*
 * Where each consent flow lands when Google sends the person back.
 *
 * The callback is one fixed URL, so which screen started the flow has to travel in the OAuth
 * state's `purpose`: the CRM's own "connect" comes back to the configured redirect (the CRM page),
 * and a flow started from Settings → Integrations → Interview comes back to the Interview screen -
 * an HR role need not hold `SALES / CRM Leads`, and landing them on a page the route guard refuses
 * would leave the "Google account connected" notice on a screen they cannot read.
 */
const OAUTH_PURPOSE_INTERVIEW = "connect:interview";
const OAUTH_RETURN_PATHS = { [OAUTH_PURPOSE_INTERVIEW]: "/hrm/interview" };

/**
 * The frontend URL Google hands the person back to, with the outcome in its query.
 *
 * `path` swaps the configured page for another on the same origin, for the flows that did not
 * start on the CRM. Kept on the same origin on purpose: the redirect setting is what says which
 * deployment this backend belongs to, and only the page within it varies.
 */
function buildFrontendRedirect(query = "google=connected", { path = "" } = {}) {
  let base = getFrontendRedirectUrl();
  if (path) {
    try {
      const url = new URL(base);
      url.pathname = path;
      url.search = "";
      url.hash = "";
      base = url.toString();
    } catch {
      // A redirect setting that is not a whole URL is left exactly as it is.
    }
  }
  return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
}

/** The page a flow with this purpose returns to, or "" for the configured default. */
function returnPathForPurpose(purpose) {
  return OAUTH_RETURN_PATHS[String(purpose || "").trim()] || "";
}

/**
 * The page the flow behind this `state` token should return to, read off the stored state.
 *
 * For the failure path: the callback's catch has no validated state record to hand, only the raw
 * query, and a refused consent started from Interview should still land on Interview. Never
 * throws - a token that matches nothing answers the default, which is what the error page needs.
 */
async function returnPathForState(state) {
  const token = String(state || "").trim();
  if (!token) return "";
  try {
    await ensureOAuthStateTableExists();
    const record = await prisma.salesGoogleOAuthState.findUnique({ where: { stateHash: hashState(token) }, select: { purpose: true } });
    return returnPathForPurpose(record?.purpose);
  } catch {
    return "";
  }
}

async function createOAuthState(userId, purpose = "connect") {
  await ensureConnectionTableExists();
  await ensureOAuthStateTableExists();
  const state = generateStateToken();
  await prisma.salesGoogleOAuthState.create({
    data: {
      stateHash: hashState(state),
      userId,
      purpose,
      expiresAt: new Date(Date.now() + Math.max(5, Number(process.env.GOOGLE_OAUTH_STATE_TTL_MINUTES || 15)) * 60 * 1000),
    },
  });
  return state;
}

function serializeScopes(scopes = []) {
  return Array.isArray(scopes) ? [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))].join(" ") : String(scopes || "").trim();
}

async function getConnectionForUser(userId) {
  await ensureConnectionTableExists();
  const connection = await prisma.salesGoogleAccountConnection.findUnique({ where: { userId } });
  if (!connection) {
    return null;
  }

  try {
    const { connection: refreshedConnection } = await getAuthorizedGoogleClientForUser(userId);
    return refreshedConnection;
  } catch (error) {
    if (error?.code === "GOOGLE_RECONNECT_REQUIRED" || error?.status === 401) {
      return null;
    }
    throw error;
  }
}

// Extracts the reason Google actually gave. Its errors bury the useful part in
// response.data, so without this every failure surfaces as an opaque string.
function describeGoogleAuthError(error) {
  const data = error?.response?.data;
  const parts = [
    data?.error_description,
    typeof data?.error === "string" ? data.error : data?.error?.message,
    error?.message,
  ].filter((part) => part && String(part).trim());
  return parts.length ? [...new Set(parts.map(String))].join(" | ") : "Unknown Google error.";
}

async function refreshAccessToken(connection) {
  if (!connection?.refreshTokenEncrypted) {
    const error = new Error("Google account connection does not have a refresh token.");
    error.status = 400;
    throw error;
  }

  const refreshToken = decryptText(connection.refreshTokenEncrypted);
  if (!refreshToken) {
    const error = new Error("Stored Google refresh token could not be decrypted. GOOGLE_OAUTH_ENCRYPTION_KEY may have changed since this account was connected.");
    error.status = 400;
    throw error;
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const response = await oauth2Client.getAccessToken();
  const token = response?.token || oauth2Client.credentials?.access_token || "";
  const expiryDate = oauth2Client.credentials?.expiry_date ? new Date(oauth2Client.credentials.expiry_date) : null;
  if (!token) {
    const error = new Error("Unable to refresh Google access token.");
    error.status = 400;
    throw error;
  }

  const updated = await prisma.salesGoogleAccountConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptText(token),
      tokenExpiresAt: expiryDate,
      status: "CONNECTED",
    },
  });

  return {
    connection: updated,
    accessToken: token,
    tokenExpiresAt: expiryDate,
  };
}

async function getAuthorizedGoogleClientForUser(userId) {
  await ensureConnectionTableExists();
  const connection = await prisma.salesGoogleAccountConnection.findUnique({ where: { userId } });
  if (!connection) {
    const error = new Error("No connected Google account found.");
    error.status = 404;
    throw error;
  }

  const currentToken = decryptText(connection.accessTokenEncrypted);
  const tokenExpiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  let accessToken = currentToken;
  let refreshedConnection = connection;

  if (!accessToken || (tokenExpiresAt && tokenExpiresAt.getTime() - 60_000 <= Date.now())) {
    try {
      const refreshed = await refreshAccessToken(connection);
      accessToken = refreshed.accessToken;
      refreshedConnection = refreshed.connection;
    } catch (refreshError) {
      const reason = describeGoogleAuthError(refreshError);
      console.error(`Google token refresh failed for user ${userId}:`, reason);
      const error = new Error("Google authorization has expired. Please reconnect your Google account.");
      error.code = "GOOGLE_RECONNECT_REQUIRED";
      error.status = 401;
      error.reason = reason;
      error.cause = refreshError;
      throw error;
    }
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken });
  return { oauth2Client, connection: refreshedConnection, accessToken };
}

async function getPickerAccessToken(userId) {
  await ensureConnectionTableExists();
  const connection = await prisma.salesGoogleAccountConnection.findUnique({ where: { userId } });
  if (!connection) {
    const error = new Error("No connected Google account found.");
    error.status = 404;
    throw error;
  }

  const currentToken = decryptText(connection.accessTokenEncrypted);
  const tokenExpiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  if (currentToken && (!tokenExpiresAt || tokenExpiresAt.getTime() - 60_000 > Date.now())) {
    return {
      accessToken: currentToken,
      tokenExpiresAt,
      connection: mapConnection(connection),
    };
  }

  const refreshed = await refreshAccessToken(connection);
  return {
    accessToken: refreshed.accessToken,
    tokenExpiresAt: refreshed.tokenExpiresAt,
    connection: mapConnection(refreshed.connection),
  };
}

async function getGoogleSheetConnectionForUser(userId) {
  await ensureConnectionTableExists();
  const connection = await prisma.salesGoogleAccountConnection.findUnique({ where: { userId } });
  if (!connection) {
    const error = new Error("No connected Google account found.");
    error.status = 404;
    throw error;
  }

  const currentToken = decryptText(connection.accessTokenEncrypted);
  const tokenExpiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  let accessToken = currentToken;
  let currentConnection = connection;

  if (!accessToken || (tokenExpiresAt && tokenExpiresAt.getTime() - 60_000 <= Date.now())) {
    try {
      const refreshed = await refreshAccessToken(connection);
      accessToken = refreshed.accessToken;
      currentConnection = refreshed.connection;
    } catch (refreshError) {
      const reason = describeGoogleAuthError(refreshError);
      console.error(`Google token refresh failed for user ${userId}:`, reason);
      const error = new Error("Google authorization has expired. Please reconnect your Google account.");
      error.code = "GOOGLE_RECONNECT_REQUIRED";
      error.status = 401;
      error.reason = reason;
      error.cause = refreshError;
      throw error;
    }
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken });
  return { oauth2Client, connection: currentConnection, accessToken };
}

async function getSpreadsheetTabsForUser(userId, spreadsheetId) {
  const sheetId = String(spreadsheetId || "").trim();
  if (!sheetId) {
    const error = new Error("Missing spreadsheet id.");
    error.status = 400;
    throw error;
  }

  const { oauth2Client } = await getAuthorizedGoogleClientForUser(userId);
  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  try {
    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title,index)",
    });
    const data = response?.data || {};
    const tabs = Array.isArray(data.sheets)
      ? data.sheets
          .map((item) => item?.properties || {})
          .filter((item) => Number.isInteger(item.sheetId) && typeof item.title === "string")
          .map((item) => ({
            sheetId: item.sheetId,
            title: item.title,
            index: Number.isInteger(item.index) ? item.index : 0,
          }))
      : [];

    return {
      spreadsheetId: String(data.spreadsheetId || sheetId),
      spreadsheetName: String(data.properties?.title || ""),
      tabs,
    };
  } catch (error) {
    const isReconnectRequired = error?.response?.status === 401 || error?.response?.status === 403 || error?.code === 401;
    const isNotFound = error?.response?.status === 404 || error?.code === 404;
    const isRateLimited = error?.response?.status === 429;
    const mapped = new Error(
      isReconnectRequired
        ? "Google authorization has expired. Please reconnect your Google account."
        : isNotFound
          ? "Spreadsheet could not be found or you do not have permission to access it."
          : isRateLimited
            ? "Google API rate limit reached. Please try again."
            : "Unable to load spreadsheet tabs.",
    );
    mapped.status = isReconnectRequired ? 401 : 400;
    if (isReconnectRequired) mapped.code = "GOOGLE_RECONNECT_REQUIRED";
    throw mapped;
  }
}

/**
 * Forgets the Google account this user connected.
 *
 * The stored tokens are what every Google feature runs on, so this is the sign-out for the
 * integration as a whole - Sheets syncing included. The row is deleted rather than flagged,
 * because a refresh token that is not going to be used again should not be sitting in the
 * database encrypted or otherwise.
 *
 * Linked sheets are left alone: they name a spreadsheet and a tab, which stay meaningful,
 * and reconnecting the same account should not mean setting them all up again.
 */
async function disconnectGoogleAccount(userId) {
  await ensureConnectionTableExists();
  const connection = await prisma.salesGoogleAccountConnection.findUnique({ where: { userId } });
  if (!connection) return { disconnected: false };
  await prisma.salesGoogleAccountConnection.delete({ where: { userId } });
  return { disconnected: true, googleEmail: connection.googleEmail };
}

function mapConnection(connection) {
  if (!connection) return null;
  return {
    id: connection.id,
    userId: connection.userId,
    googleAccountId: connection.googleAccountId,
    googleEmail: connection.googleEmail,
    googleDisplayName: connection.googleDisplayName || "",
    scopes: connection.scopes,
    // Lets the CRM tell "not connected" from "connected before Meet existed", so it can
    // offer Reconnect rather than a dead Schedule button.
    hasCalendarScope: connectionHasCalendarScope(connection),
    status: connection.status,
    tokenExpiresAt: connection.tokenExpiresAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

/**
 * The consent URL to send the person to.
 *
 * `purpose` names which screen started the flow, so the callback knows where to send them back -
 * see `OAUTH_RETURN_PATHS`. The CRM's own callers pass nothing and keep the "connect" they always
 * had; the Interview integration passes `OAUTH_PURPOSE_INTERVIEW`.
 */
async function startOAuth(user, { purpose = "connect" } = {}) {
  const oauth2Client = getOAuthClient();
  const state = await createOAuthState(user.id, purpose);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    // "select_account" always shows the account chooser so a different Google account
    // can be picked; "consent" keeps Google returning a refresh token on every pass.
    prompt: "select_account consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
  return { authUrl };
}

async function fetchGoogleProfile(accessToken) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken });
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const response = await oauth2.userinfo.get();
  const data = response?.data || {};
  return {
    googleAccountId: String(data.id || ""),
    googleEmail: String(data.email || ""),
    googleDisplayName: String(data.name || data.given_name || ""),
  };
}

async function handleOAuthCallback(query) {
  await ensureConnectionTableExists();
  await ensureOAuthStateTableExists();
  const code = String(query.code || "").trim();
  const state = String(query.state || "").trim();
  const error = String(query.error || "").trim();

  if (error) {
    const err = new Error(`Google OAuth denied: ${error}`);
    err.status = 400;
    throw err;
  }
  if (!code) {
    const err = new Error("Missing Google authorization code.");
    err.status = 400;
    throw err;
  }
  if (!state) {
    const err = new Error("Missing OAuth state.");
    err.status = 400;
    throw err;
  }

  const stateHash = hashState(state);
  const stateRecord = await prisma.salesGoogleOAuthState.findUnique({ where: { stateHash } });
  if (!stateRecord) {
    const err = new Error("Invalid or expired OAuth state.");
    err.status = 400;
    throw err;
  }
  if (stateRecord.consumedAt || stateRecord.expiresAt.getTime() <= Date.now()) {
    const err = new Error("Invalid or expired OAuth state.");
    err.status = 400;
    throw err;
  }

  const oauth2Client = getOAuthClient();
  const tokenResponse = await oauth2Client.getToken(code);
  const tokens = tokenResponse?.tokens || {};
  const accessToken = String(tokens.access_token || "");
  const refreshToken = String(tokens.refresh_token || "");
  if (!accessToken) {
    const err = new Error("Google OAuth did not return an access token.");
    err.status = 400;
    throw err;
  }

  const profile = await fetchGoogleProfile(accessToken);
  if (!profile.googleEmail) {
    const err = new Error("Google account email could not be determined.");
    err.status = 400;
    throw err;
  }

  const existing = await prisma.salesGoogleAccountConnection.findUnique({ where: { userId: stateRecord.userId } });
  const nextGoogleAccountId = profile.googleAccountId || profile.googleEmail;
  // Only carry a stored refresh token forward when this is the SAME Google account.
  // Reusing it after signing in as someone else would keep refreshing the previous
  // account's tokens while the row claims to be the new one.
  const isSameGoogleAccount =
    Boolean(existing) &&
    (String(existing.googleAccountId || "") === String(nextGoogleAccountId) ||
      String(existing.googleEmail || "").toLowerCase() === profile.googleEmail.toLowerCase());
  const carriedRefreshToken = isSameGoogleAccount ? decryptText(existing.refreshTokenEncrypted) : "";
  const nextRefreshToken = refreshToken || carriedRefreshToken;
  if (!nextRefreshToken) {
    const err = new Error("Google did not return a refresh token. Remove this app's access at myaccount.google.com/permissions and connect again.");
    err.status = 400;
    throw err;
  }
  const nextScopes = serializeScopes(tokens.scope ? String(tokens.scope).split(/\s+/) : GOOGLE_SCOPES);

  const connectionPayload = {
    userId: stateRecord.userId,
    googleAccountId: nextGoogleAccountId,
    googleEmail: profile.googleEmail,
    googleDisplayName: profile.googleDisplayName || profile.googleEmail.split("@")[0] || "",
    accessTokenEncrypted: encryptText(accessToken),
    refreshTokenEncrypted: encryptText(nextRefreshToken),
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scopes: nextScopes,
    status: "CONNECTED",
  };

  const connection = await prisma.salesGoogleAccountConnection.upsert({
    where: { userId: stateRecord.userId },
    update: connectionPayload,
    create: connectionPayload,
  });

  await prisma.salesGoogleOAuthState.update({
    where: { stateHash },
    data: { consumedAt: new Date() },
  });

  return {
    connection: mapConnection(connection),
    // Back to whichever screen started the flow - the CRM by default, Interview for its own.
    redirectUrl: buildFrontendRedirect("google=connected", { path: returnPathForPurpose(stateRecord.purpose) }),
  };
}

module.exports = {
  CALENDAR_SCOPE,
  OAUTH_PURPOSE_INTERVIEW,
  disconnectGoogleAccount,
  buildFrontendRedirect,
  returnPathForPurpose,
  returnPathForState,
  connectionHasCalendarScope,
  createOAuthState,
  getAuthorizedGoogleClientForUser,
  getGoogleSheetConnectionForUser,
  getConnectionForUser,
  getOAuthClient,
  getPickerAccessToken,
  getSpreadsheetTabsForUser,
  handleOAuthCallback,
  mapConnection,
  serializeScopes,
  startOAuth,
};
