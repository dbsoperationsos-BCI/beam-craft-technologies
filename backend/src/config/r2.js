const { S3Client } = require("@aws-sdk/client-s3");

const accountId = (process.env.R2_ACCOUNT_ID || "").trim();
const accessKeyId = (process.env.R2_ACCESS_KEY_ID || "").trim();
const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
const bucket = (process.env.R2_BUCKET_NAME || "").trim();
const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
/**
 * Where objects go that must not be reachable by link.
 *
 * `R2_PUBLIC_BASE_URL` serves the *whole* of `R2_BUCKET_NAME`, so an attendance selfie written
 * there is fetchable by anybody who learns its key — the key is a UUID and so unguessable, but
 * unguessable is not the same as protected. Point `R2_PRIVATE_BUCKET_NAME` at a second bucket with
 * no public access and the object becomes genuinely unreachable without the account's credentials;
 * the application then serves it through a permission-checked endpoint and never hands out a link.
 *
 * Falls back to the main bucket when unset, so the feature works on day one and a deployment that
 * has not made the second bucket yet is degraded rather than broken. `privateBucketIsPublic` is
 * what says which of the two situations a server is actually in.
 */
const privateBucket = (process.env.R2_PRIVATE_BUCKET_NAME || "").trim() || bucket;
const privateBucketIsPublic = privateBucket === bucket;

const isConfigured = Boolean(accountId && accessKeyId && secretAccessKey && bucket && publicBaseUrl);

let client = null;

function r2Client() {
  if (!isConfigured) throw Object.assign(new Error("Cloudflare R2 storage is not configured."), { status: 500 });
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

function missingKeys() {
  return Object.entries({ R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET_NAME: bucket, R2_PUBLIC_BASE_URL: publicBaseUrl })
    .filter(([, value]) => !value)
    .map(([key]) => key);
}

module.exports = { r2Client, bucket, privateBucket, privateBucketIsPublic, publicBaseUrl, isConfigured, missingKeys };
