"use client";

import { useEffect, useRef } from "react";

/**
 * Kain yang bergerak pelan di panel merek halaman masuk.
 *
 * Satu shader WebGL yang ditulis tangan — tanpa pustaka 3D, jadi yang dimuat
 * hanya beberapa kilobita, dan dimuat SETELAH formulir tampil (lihat
 * `dynamic(..., { ssr: false })` di halaman masuk). Permukaannya medan tinggi
 * dari beberapa gelombang yang saling silang, diterangi dari kiri atas: lipatan
 * kain, bukan gradien abstrak — Elorae merek pakaian.
 *
 * KETERBACAAN DULU. Wordmark lime dan kalimat merek abu duduk di tengah-kiri
 * panel, dan label kecil di kiri atas: shader menyisakan pita tinta tepat di
 * belakang keduanya, jadi kontras teks tetap sama dengan panel tanpa kain.
 * Kilau kain hidup di sekelilingnya — kanan, atas, dan bawah.
 *
 * Hemat: dibatasi ~30 fps, berhenti saat tab tidak terlihat, dan hanya satu
 * bingkai diam kalau perangkat meminta gerak dikurangi. Tanpa WebGL, kanvasnya
 * tidak pernah tampil dan panelnya tetap tinta polos seperti sebelumnya.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uInk;
uniform vec3 uTint;

float h(vec2 p, float t) {
  // A diagonal drape that meanders, a cross fold, and a fine crease — the three
  // scales a hanging length of cloth shows.
  float v = 0.60 * sin(dot(p, vec2(0.90, 0.45)) * 1.3 + t * 0.30 + 0.8 * sin(p.y * 0.7 + t * 0.15));
  v += 0.30 * sin(dot(p, vec2(-0.35, 1.0)) * 2.2 + t * 0.22);
  v += 0.12 * sin(dot(p, vec2(1.0, 1.0)) * 4.1 - t * 0.40);
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y * 4.0;
  float t = uTime;
  float e = 0.015;
  vec3 n = normalize(vec3(
    h(p - vec2(e, 0.0), t) - h(p + vec2(e, 0.0), t),
    h(p - vec2(0.0, e), t) - h(p + vec2(0.0, e), t),
    e * 4.0
  ));
  vec3 L = normalize(vec3(-0.55, 0.65, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  // A tight highlight is what makes the surface read as silk rather than haze:
  // thin bright ridges along the folds, dark valleys between them.
  float ridge = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 30.0);
  float sheen = pow(clamp(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 6.0);
  float weave = sin(gl_FragCoord.x * 1.7) * sin(gl_FragCoord.y * 1.7);
  // Soft elliptical shelters keep ink behind the text — the wordmark and brand
  // line (centre left) and the eyebrow (top left). Elliptical, and wide in their
  // falloff, so the shelter is never seen as a box.
  vec2 dText = (uv - vec2(0.26, 0.52)) / vec2(0.62, 0.20);
  vec2 dEye = (uv - vec2(0.14, 0.965)) / vec2(0.32, 0.06);
  float shelter = max(1.0 - smoothstep(0.55, 1.25, length(dText)), 1.0 - smoothstep(0.6, 1.4, length(dEye)));
  float reach = 0.45 + 0.55 * uv.x;
  float glow = (0.05 * diff + 0.18 * sheen + 0.45 * ridge) * (1.0 - shelter) * reach;
  vec3 col = uInk + uTint * glow + vec3(0.008) * weave;
  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!m) return [0.78, 0.94, 0.29];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

export default function KainBergerak({ ink, tint }: { ink: string; tint: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl || gl.isContextLost()) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    gl.uniform3fv(gl.getUniformLocation(prog, "uInk"), hexToRgb(ink));
    gl.uniform3fv(gl.getUniformLocation(prog, "uTint"), hexToRgb(tint));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    let last = 0;
    let shown = false;

    const draw = (now: number) => {
      resize();
      gl.uniform1f(uTime, reduce ? 4.0 : (now - start) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!shown) {
        shown = true;
        canvas.style.opacity = "1";
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      draw(now);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) raf = requestAnimationFrame(loop);
    };

    if (reduce) {
      draw(performance.now());
    } else {
      raf = requestAnimationFrame(loop);
      document.addEventListener("visibilitychange", onVisibility);
    }
    window.addEventListener("resize", resize);

    // Free what this run created, but never `loseContext()`: React runs this
    // effect twice in development, and a canvas hands back the SAME context on
    // the second `getContext` — a lost one, so the kain would never draw.
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", resize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [ink, tint]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full opacity-0 transition-opacity duration-1000"
    />
  );
}
