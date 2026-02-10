import { NextRequest, NextResponse } from 'next/server';

/**
 * Accepts multipart/form-data with one or more image files.
 * Returns an array of URLs (stub: placeholder URLs; replace with R2 upload when configured).
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const fileList = Array.isArray(files) ? files : files ? [files] : [];

    if (fileList.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    // Stub: return placeholder URLs. Replace with actual R2 upload when configured.
    const baseUrl = request.nextUrl.origin;
    const urls = fileList.map((_, i) =>
      `${baseUrl}/api/upload/grn-photo/placeholder-${Date.now()}-${i}.jpg`
    );

    return NextResponse.json({ urls });
  } catch (err) {
    console.error('GRN photo upload error:', err);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}
