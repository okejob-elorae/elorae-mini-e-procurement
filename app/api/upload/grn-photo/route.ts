import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { uploadToR2, deleteFromR2, keyFromUrl, isConfigured } from '@/lib/r2';

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
 * POST — upload one or more files to R2.
 * Accepts multipart/form-data with field name "files".
 * Returns { urls: string[] }.
 */
export async function POST(request: NextRequest) {
  try {
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

      const ext = file.name.split('.').pop() || 'bin';
      const key = `uploads/${randomUUID()}-${sanitiseFilename(file.name.replace(`.${ext}`, ''))}.${ext}`;
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

/**
 * DELETE — remove a file from R2 by its public URL.
 * Accepts JSON body { url: string }.
 */
export async function DELETE(request: NextRequest) {
  try {
    if (!isConfigured()) {
      return NextResponse.json(
        { error: 'R2 storage is not configured' },
        { status: 503 }
      );
    }

    const { url } = (await request.json()) as { url?: string };
    if (!url) {
      return NextResponse.json(
        { error: 'Missing "url" in request body' },
        { status: 400 }
      );
    }

    const key = keyFromUrl(url);
    if (!key) {
      return NextResponse.json(
        { error: 'URL does not match configured R2 public URL' },
        { status: 400 }
      );
    }

    await deleteFromR2(key);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('File delete error:', err);
    return NextResponse.json(
      { error: 'Delete failed' },
      { status: 500 }
    );
  }
}
