import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

function isConfigured(): boolean {
  return !!(accountId && accessKeyId && secretAccessKey);
}

function getClient(): S3Client {
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY."
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const BUCKET = process.env.R2_BUCKET_NAME || "elorae-erp";
const PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

let _client: S3Client | null = null;

function client(): S3Client {
  if (!_client) _client = getClient();
  return _client;
}

/**
 * Upload a file buffer to R2 and return its public URL.
 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

/**
 * Delete a file from R2 by its key.
 */
export async function deleteFromR2(key: string): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}

/**
 * Fetch an object from R2 by key (for authenticated download proxies).
 */
export async function getObjectFromR2(key: string): Promise<GetObjectCommandOutput> {
  return client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Extract the R2 object key from a public URL.
 * Returns null if the URL doesn't match the configured public URL.
 */
export function keyFromUrl(url: string): string | null {
  if (!PUBLIC_URL || !url.startsWith(PUBLIC_URL)) return null;
  return url.slice(PUBLIC_URL.length + 1); // +1 for the trailing "/"
}

/**
 * Reconstructs the public URL for an already-uploaded object key — the inverse of `keyFromUrl`,
 * and the same formula `uploadToR2` itself returns. Any writer that trusts a caller-supplied key
 * (already validated against its own prefix/uniqueness rules) should derive the URL from it
 * rather than accept a second, independently-supplied URL field: a raw caller could otherwise
 * pair a valid key with an arbitrary URL and have a downstream screen render the attacker's URL
 * while the audited key points elsewhere.
 */
export function urlFromKey(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}

export { isConfigured };
