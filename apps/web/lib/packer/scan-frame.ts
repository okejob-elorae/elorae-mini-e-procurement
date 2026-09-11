import { extractTrackingCandidate, isAcceptableScanCode } from "@/lib/packer/barcode";

/**
 * Keep barcode bars sharp — Code128 on Shopee labels dies if we downscale too hard.
 * Target: reliable read in <2s on a focused webcam frame.
 */
const CROP_VARIANTS = [
  { w: 0.92, h: 0.32 }, // guide-box style (wide barcode strip)
  { w: 0.8, h: 0.22 }, // tighter on bars only
  { w: 0.98, h: 0.45 }, // looser fallback
] as const;

const MAX_DECODE_W = 1400;
const MAX_DECODE_H = 700;

type NativeDetector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type ZxingReader = {
  decodeFromCanvas: (canvas: HTMLCanvasElement) => { getText: () => string };
};

type ZbarSymbol = {
  decode: () => string;
  typeName?: string;
};

function createNativeDetector(): NativeDetector | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as Window & {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeDetector;
  }).BarcodeDetector;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor({
      formats: ["code_128", "code_39", "codabar", "itf"],
    });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

function toScanCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const token = extractTrackingCandidate(raw);
  if (!token || !isAcceptableScanCode(token)) return null;
  return token;
}

function pickBestRaw(values: Array<string | undefined | null>): string | null {
  let best: string | null = null;
  let bestDigits = 0;
  for (const raw of values) {
    const token = toScanCode(raw);
    if (!token) continue;
    const digits = (token.match(/\d/g) ?? []).length;
    if (!best || digits > bestDigits || (digits === bestDigits && token.length > best.length)) {
      best = token;
      bestDigits = digits;
    }
  }
  return best;
}

async function tryNative(
  detector: NativeDetector | null,
  source: ImageBitmapSource,
): Promise<string | null> {
  if (!detector) return null;
  try {
    const codes = await detector.detect(source);
    return pickBestRaw(codes.map((c) => c.rawValue));
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
    return toScanCode(result.getText()?.trim());
  } catch (e) {
    if (e instanceof NotFoundException) return null;
    return null;
  }
}

async function tryZbar(
  scanImageData: (data: ImageData) => Promise<ZbarSymbol[]>,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Promise<string | null> {
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const symbols = await scanImageData(imageData);
    return pickBestRaw(symbols.map((s) => {
      try {
        return s.decode();
      } catch {
        return null;
      }
    }));
  } catch {
    return null;
  }
}

function enhanceContrast(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) | 0;
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = (((d[i]! - min) * 255) / range) | 0;
    // Soft threshold helps Code128 under uneven light.
    const bin = v > 140 ? 255 : v < 90 ? 0 : v;
    d[i] = d[i + 1] = d[i + 2] = bin;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function drawCropVariant(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  ratioW: number,
  ratioH: number,
): boolean {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return false;

  const cw = Math.floor(vw * ratioW);
  const ch = Math.floor(vh * ratioH);
  const sx = Math.floor((vw - cw) / 2);
  const sy = Math.floor((vh - ch) / 2);

  // Preserve resolution — only shrink if larger than max.
  const outW = Math.min(MAX_DECODE_W, cw);
  const outH = Math.min(MAX_DECODE_H, ch);
  if (canvas.width !== outW) canvas.width = outW;
  if (canvas.height !== outH) canvas.height = outH;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, sx, sy, cw, ch, 0, 0, outW, outH);
  return outW > 40 && outH > 20;
}

async function loadZxingReader(): Promise<{
  reader: ZxingReader;
  NotFoundException: new (...args: never[]) => Error;
} | null> {
  try {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType, NotFoundException }] =
      await Promise.all([import("@zxing/browser"), import("@zxing/library")]);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODABAR,
      BarcodeFormat.ITF,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);

    return {
      reader: new BrowserMultiFormatReader(hints),
      NotFoundException,
    };
  } catch {
    return null;
  }
}

async function loadZbarScanner(): Promise<
  ((data: ImageData) => Promise<ZbarSymbol[]>) | null
> {
  try {
    // Inlined WASM build — avoids separate .wasm fetch issues under Next/Turbopack.
    const mod = await import("@undecaf/zbar-wasm/dist/inlined/index.mjs");
    return mod.scanImageData as (data: ImageData) => Promise<ZbarSymbol[]>;
  } catch {
    try {
      const mod = await import("@undecaf/zbar-wasm");
      return mod.scanImageData as (data: ImageData) => Promise<ZbarSymbol[]>;
    } catch {
      return null;
    }
  }
}

export async function createVideoBarcodeScanner(video: HTMLVideoElement) {
  const native = createNativeDetector();
  let zxing: {
    reader: ZxingReader;
    NotFoundException: new (...args: never[]) => Error;
  } | null = null;
  let zbarScan: ((data: ImageData) => Promise<ZbarSymbol[]>) | null = null;
  let zxingLoading: Promise<typeof zxing> | null = null;
  let zbarLoading: Promise<typeof zbarScan> | null = null;

  const crop = document.createElement("canvas");
  const cropCtx = crop.getContext("2d", { willReadFrequently: true });
  let busy = false;
  let variantIdx = 0;

  async function ensureZxing() {
    if (zxing) return zxing;
    if (!zxingLoading) {
      zxingLoading = loadZxingReader().then((loaded) => {
        zxing = loaded;
        return loaded;
      });
    }
    return zxingLoading;
  }

  async function ensureZbar() {
    if (zbarScan) return zbarScan;
    if (!zbarLoading) {
      zbarLoading = loadZbarScanner().then((loaded) => {
        zbarScan = loaded;
        return loaded;
      });
    }
    return zbarLoading;
  }

  // Preload both heavy decoders so first focused frame can hit <2s.
  void ensureZbar();
  void ensureZxing();

  return {
    async scan(): Promise<string | null> {
      if (busy || video.readyState < 2 || !video.videoWidth || !cropCtx) return null;
      busy = true;
      try {
        // Fast native pass on live video.
        const liveHit = await tryNative(native, video);
        if (liveHit) return liveHit;

        const variant = CROP_VARIANTS[variantIdx % CROP_VARIANTS.length]!;
        variantIdx += 1;
        if (!drawCropVariant(video, crop, cropCtx, variant.w, variant.h)) return null;

        const cropNative = await tryNative(native, crop);
        if (cropNative) return cropNative;

        // ZBar first — usually strongest on 1D Code128 shipping labels.
        const zbar = await ensureZbar();
        if (zbar) {
          const z1 = await tryZbar(zbar, crop, cropCtx);
          if (z1) return z1;

          // Contrast + soft threshold, then ZBar again.
          enhanceContrast(crop, cropCtx);
          const z2 = await tryZbar(zbar, crop, cropCtx);
          if (z2) return z2;
        }

        // ZXing last resort on the (possibly enhanced) canvas.
        const loaded = await ensureZxing();
        if (loaded) {
          const zx = tryZxing(loaded.reader, crop, loaded.NotFoundException);
          if (zx) return zx;
        }

        return null;
      } finally {
        busy = false;
      }
    },
    async stop() {
      // nothing persistent to tear down
    },
  };
}
