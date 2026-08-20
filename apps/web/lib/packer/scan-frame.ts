/** Match the white overlay box in PackerCameraKiosk (86% × 38%, centered). */
const CROP_WIDTH_RATIO = 0.86;
const CROP_HEIGHT_RATIO = 0.38;
const UPSCALE = 3;

type NativeDetector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type ZxingReader = {
  decodeFromCanvas: (canvas: HTMLCanvasElement) => { getText: () => string };
};

function createNativeDetector(): NativeDetector | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as Window & {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetector;
  }).BarcodeDetector;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor({
      formats: [
        "code_128",
        "code_39",
        "ean_13",
        "ean_8",
        "upc_a",
        "upc_e",
        "codabar",
        "itf",
        "qr_code",
        "pdf417",
        "data_matrix",
      ],
    });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

function drawVideoToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  crop: boolean,
): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  if (!crop) {
    canvas.width = Math.min(1920, vw);
    canvas.height = Math.min(1080, vh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, canvas.width, canvas.height);
    return;
  }

  const cw = Math.floor(vw * CROP_WIDTH_RATIO);
  const ch = Math.floor(vh * CROP_HEIGHT_RATIO);
  const sx = Math.floor((vw - cw) / 2);
  const sy = Math.floor((vh - ch) / 2);
  canvas.width = Math.min(1920, cw * UPSCALE);
  canvas.height = Math.min(1080, ch * UPSCALE);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
}

/** Grayscale + contrast stretch helps barcodes on glossy phone screens. */
function enhanceForBarcode(source: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  const outCtx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx || !outCtx) return source;

  const img = ctx.getImageData(0, 0, source.width, source.height);
  const d = img.data;
  let min = 255;
  let max = 0;

  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = (((d[i]! - min) * 255) / range) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }

  outCtx.putImageData(img, 0, 0);
  return out;
}

async function tryNative(
  detector: NativeDetector | null,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  if (!detector) return null;
  try {
    const codes = await detector.detect(canvas);
    const value = codes[0]?.rawValue?.trim();
    return value || null;
  } catch {
    return null;
  }
}

function tryZxing(
  reader: ZxingReader,
  canvas: HTMLCanvasElement,
  NotFoundException: new (...args: never[]) => Error,
): string | null {
  try {
    const result = reader.decodeFromCanvas(canvas);
    const text = result.getText()?.trim();
    return text || null;
  } catch (e) {
    if (e instanceof NotFoundException) return null;
    return null;
  }
}

async function decodeCanvas(
  native: NativeDetector | null,
  zxing: ZxingReader,
  NotFoundException: new (...args: never[]) => Error,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  const plain =
    (await tryNative(native, canvas)) || tryZxing(zxing, canvas, NotFoundException);
  if (plain) return plain;

  const enhanced = enhanceForBarcode(canvas);
  return (
    (await tryNative(native, enhanced)) ||
    tryZxing(zxing, enhanced, NotFoundException)
  );
}

async function loadZxingReader(): Promise<{
  reader: ZxingReader;
  NotFoundException: new (...args: never[]) => Error;
}> {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType, NotFoundException }] =
    await Promise.all([import("@zxing/browser"), import("@zxing/library")]);

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
    BarcodeFormat.PDF_417,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);

  return {
    reader: new BrowserMultiFormatReader(hints),
    NotFoundException,
  };
}

export async function createVideoBarcodeScanner(video: HTMLVideoElement) {
  const native = createNativeDetector();
  const { reader, NotFoundException } = await loadZxingReader();
  const crop = document.createElement("canvas");
  const full = document.createElement("canvas");
  let busy = false;

  return {
    async scan(): Promise<string | null> {
      if (busy || video.readyState < 2 || !video.videoWidth) return null;
      busy = true;
      try {
        drawVideoToCanvas(video, crop, true);
        if (crop.width > 0 && crop.height > 0) {
          const cropHit = await decodeCanvas(native, reader, NotFoundException, crop);
          if (cropHit) return cropHit;
        }

        drawVideoToCanvas(video, full, false);
        if (full.width > 0 && full.height > 0) {
          return decodeCanvas(native, reader, NotFoundException, full);
        }
        return null;
      } finally {
        busy = false;
      }
    },
    stop() {
      // decodeFromCanvas is stateless per frame; no continuous stream to tear down.
    },
  };
}
