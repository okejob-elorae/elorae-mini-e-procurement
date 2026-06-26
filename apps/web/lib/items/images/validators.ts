import { isTrustedHost } from "./trusted-hosts";
import type { ValidationResult } from "./types";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_GALLERY_COUNT = 20;

function fail(code: string, message: string): ValidationResult {
  return { ok: false, code, message };
}

export function validateMime(mime: string): ValidationResult {
  if (!ALLOWED_MIME.has(mime)) return fail("image_mime_invalid", `MIME ${mime} not allowed.`);
  return { ok: true };
}

export function validateSize(bytes: number): ValidationResult {
  if (bytes > MAX_BYTES) return fail("image_too_large", "Image exceeds 5 MB limit.");
  return { ok: true };
}

export function validateGalleryCount(count: number): ValidationResult {
  if (count > MAX_GALLERY_COUNT) return fail("image_count_exceeded", `Max ${MAX_GALLERY_COUNT} images per gallery.`);
  return { ok: true };
}

export function validateVariantSku(
  variantSku: string | null,
  parentVariants: Array<{ sku: string }>,
): ValidationResult {
  if (variantSku === null) return { ok: true };
  const known = new Set(parentVariants.map((v) => v.sku));
  if (!known.has(variantSku)) return fail("image_variant_unknown", `Variant SKU "${variantSku}" not on parent.`);
  return { ok: true };
}

export function validateUrlHost(url: string): ValidationResult {
  if (!isTrustedHost(url)) return fail("image_url_untrusted", "URL host not in the trust list.");
  return { ok: true };
}
