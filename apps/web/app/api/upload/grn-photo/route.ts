import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/lib/auth';
import { uploadToR2, isConfigured } from '@/lib/r2';
import { buildR2Key, isSafeR2KeyExt } from '@/lib/r2-key';
export const dynamic = 'force-dynamic';


const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

/**
 * The key's file segment must pass the builder's `[A-Za-z0-9_-]{1,64}` rule, so the stem is
 * narrowed to that alphabet (`.` from `sanitiseFilename` becomes `_`) and cut to fit beside the
 * 36-char uuid and the joining `-`. An empty stem drops the suffix entirely.
 */
const STEM_MAX_LENGTH = 27;

function buildFileSegment(uuid: string, filename: string, ext: string): string {
  const withoutExt = filename.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
    ? filename.slice(0, -(ext.length + 1))
    : filename;
  const stem = sanitiseFilename(withoutExt)
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, STEM_MAX_LENGTH);
  return stem ? `${uuid}-${stem}` : uuid;
}

/**
 * POST — upload one or more files to R2.
 * Accepts multipart/form-data with field name "files".
 * Returns { urls: string[] }.
 */
export async function POST(request: NextRequest) {
  try {
    /*
     * Authenticated callers only — defence in depth, NOT the only thing standing here.
     *
     * This handler had no auth check of its own, which initially looked like an open door. It was not:
     * `proxy.ts` matches every path except a short static allow-list (`/api/auth`, `/api/cron`,
     * `/api/health`, `_next`, static assets) and redirects any tokenless request to `/login`, so an
     * unauthenticated request never reached this code. The check below exists because a route should not
     * depend solely on middleware for its own authorisation — one edit to that allow-list, or one route
     * moved outside the matcher, and the handler is suddenly the last line rather than the second.
     *
     * The gate is authentication rather than a specific permission because four features share this
     * one endpoint — the GRN form, both stock-adjustment screens and vendor returns — and they do not
     * share a permission, so gating on any single one would break the other three. Sibling routes that
     * serve a SINGLE feature do check a permission (`item-image` takes `items:manage`, `payment-proof`
     * takes `payments:manage`); the shared PWA `visit-photo` route is authentication-only, same as this.
     * Tightening this to an any-of check, or splitting it per feature, is recorded in docs/FOLLOWUPS.md.
     */
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isConfigured()) {
      return NextResponse.json(
        { error: 'R2 storage is not configured' },
        { status: 503 }
      );
    }

    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const fileList = Array.isArray(files) ? files : files ? [files] : [];

    if (fileList.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    const urls: string[] = [];

    for (const file of fileList) {
      if (!ALLOWED_TYPES.has(file.type)) {
        return NextResponse.json(
          { error: `File type "${file.type}" is not allowed` },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 10 MB limit` },
          { status: 400 }
        );
      }

      const rawExt = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const ext = isSafeR2KeyExt(rawExt) ? rawExt : 'bin';
      const key = buildR2Key('uploads', [buildFileSegment(randomUUID(), file.name, rawExt)], ext);
      const buffer = Buffer.from(await file.arrayBuffer());

      const url = await uploadToR2(key, buffer, file.type);
      urls.push(url);
    }

    return NextResponse.json({ urls });
  } catch (err) {
    console.error('File upload error:', err);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}

/*
 * The DELETE handler that used to sit here was REMOVED, not gated.
 *
 * It took a public R2 URL, resolved it with `keyFromUrl` — which accepts ANY key under the bucket's
 * public prefix, not just this route's own uploads — and deleted it, checking nothing beyond that. The
 * edge gate in `proxy.ts` meant it was never reachable unauthenticated, so it was a bucket-wide delete
 * primitive available to ANY AUTHENTICATED USER regardless of permissions: item images, visit photos,
 * retur nota photos and payment proofs were all reachable by anyone with a session and a URL.
 *
 * Nothing called it. All four callers of this route use POST only (grep `api/upload/grn-photo`), so
 * deleting the handler removes the exposure without removing a capability anyone was using. If an
 * orphan-cleanup path is ever wanted, it belongs behind both authentication and a permission, and it
 * must constrain the key to a prefix this route actually owns rather than trusting `keyFromUrl`.
 */
