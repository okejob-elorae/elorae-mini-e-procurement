/**
 * Shared sRGB ↔ CIE LAB (D65) helpers for client and server.
 */

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) {
    throw new Error('Invalid hex color');
  }
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

/** sRGB → CIE LAB (D65) */
export function rgbToLab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  let rs = r / 255;
  let gs = g / 255;
  let bs = b / 255;
  rs = rs > 0.04045 ? ((rs + 0.055) / 1.055) ** 2.4 : rs / 12.92;
  gs = gs > 0.04045 ? ((gs + 0.055) / 1.055) ** 2.4 : gs / 12.92;
  bs = bs > 0.04045 ? ((bs + 0.055) / 1.055) ** 2.4 : bs / 12.92;

  let x = (rs * 0.4124 + gs * 0.3576 + bs * 0.1805) / 0.95047;
  let y = rs * 0.2126 + gs * 0.7152 + bs * 0.0722;
  let z = (rs * 0.0193 + gs * 0.1192 + bs * 0.9505) / 1.08883;

  x = x > 0.008856 ? x ** (1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? z ** (1 / 3) : 7.787 * z + 16 / 116;

  return {
    L: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  };
}

export function labToHex(L: number, a: number, b: number): string {
  let y = (L + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;
  const y3 = y * y * y;
  const x3 = x * x * x;
  const z3 = z * z * z;
  y = y3 > 0.008856 ? y3 : (y - 16 / 116) / 7.787;
  x = x3 > 0.008856 ? x3 : (x - 16 / 116) / 7.787;
  z = z3 > 0.008856 ? z3 : (z - 16 / 116) / 7.787;
  x *= 0.95047;
  z *= 1.08883;
  const r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const bl = x * 0.0557 + y * -0.204 + z * 1.057;
  const toByte = (v: number) => {
    v = v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  const rr = toByte(r);
  const gg = toByte(g);
  const bb = toByte(bl);
  return `#${[rr, gg, bb].map((n) => n.toString(16).padStart(2, '0')).join('')}`.toLowerCase();
}

export function labChroma(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}

export function labHueRadians(a: number, b: number): number {
  return Math.atan2(b, a);
}
