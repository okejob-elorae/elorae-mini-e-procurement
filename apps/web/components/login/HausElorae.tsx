"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  campurHex,
  DURASI_HAUS_MS,
  fase,
  jarakKamera,
  lerp,
  LEWATI_KE_MS,
  LEWATI_TAMPIL_MS,
  pelan,
  rgbKeHex,
  WAKTU,
  warnaRuang,
  type TemaHaus,
  type WarnaRuang,
} from "@/lib/login/haus-elorae";

/**
 * Pertunjukan 3D "HAUS ELORAÉ" sesudah masuk — lihat `lib/login/haus-elorae.ts`.
 *
 * Three.js dimuat dinamis DI SINI saja, jadi hanya diunduh tepat sesudah masuk,
 * tidak membebani halaman lain. Font 3D-nya disimpan sendiri di
 * `public/vendor/three-0.160.0/` (bukan CDN). Kalau apa pun gagal (WebGL mati,
 * jaringan putus), pertunjukannya selesai seketika — aplikasi tidak pernah
 * tertahan di balik tirai.
 *
 * Warna ruangan dibaca dari variabel CSS tema yang dipasang
 * `ThemeColorProvider`, dan dibaca ULANG selama enam detik pertama: pada masuk
 * pertama di perangkat baru, tema pengguna baru tiba dari server sesudah
 * pertunjukan mulai.
 */

const FONT_3D = "/vendor/three-0.160.0/helvetiker_bold.typeface.json";

type Props = {
  /** Bingkai pertama kanvas sudah terlukis — tirai statis boleh dilepas. */
  onSiap: () => void;
  /** Aplikasi mulai tampil (angka beranda boleh mulai naik). */
  onBuka: () => void;
  /** Selesai; komponen ini boleh dilepas. */
  onSelesai: () => void;
};

/** Warna CSS apa pun (heks, oklch, rgb…) → heks, lewat kanvas peramban. */
function cssKeHex(nilai: string, cadangan: string): string {
  const v = nilai.trim();
  if (!v) return cadangan;
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const x = c.getContext("2d", { willReadFrequently: true });
    if (!x) return cadangan;
    x.fillStyle = "#010203";
    x.fillStyle = v;
    if (x.fillStyle === "#010203") return cadangan; // tidak dikenali
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return rgbKeHex(`rgb(${d[0]}, ${d[1]}, ${d[2]})`) ?? cadangan;
  } catch {
    return cadangan;
  }
}

function bacaTema(): TemaHaus {
  const g = getComputedStyle(document.documentElement);
  const gelap = document.documentElement.classList.contains("dark");
  return {
    latar: cssKeHex(g.getPropertyValue("--background"), gelap ? "#0b0b0d" : "#ffffff"),
    teks: cssKeHex(g.getPropertyValue("--foreground"), gelap ? "#f1f5f9" : "#0f172a"),
    redup: cssKeHex(g.getPropertyValue("--muted-foreground"), gelap ? "#94a3b8" : "#475569"),
    utama: cssKeHex(g.getPropertyValue("--primary"), "#c8f04a"),
  };
}

export function HausElorae({ onSiap, onBuka, onSelesai }: Props) {
  const t = useTranslations("gerakMasuk");
  const wadahRef = useRef<HTMLDivElement>(null);
  const kanvasRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const jamRef = useRef<HTMLSpanElement>(null);
  const putihRef = useRef<HTMLDivElement>(null);
  const lewatiRef = useRef<HTMLButtonElement>(null);
  const lewatiPada = useRef<number | null>(null);
  const balik = useRef({ onSiap, onBuka, onSelesai });
  useEffect(() => {
    balik.current = { onSiap, onBuka, onSelesai };
  });

  // Tanpa salam dan tanggal (dilepas atas permintaan pemilik, 2026-10-01):
  // hanya keterangan pameran di keempat sudut.
  const tahun = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Jakarta" }).format(new Date());

  useEffect(() => {
    let batal = false;
    let raf = 0;
    let bersihkan: (() => void) | null = null;

    const gagal = (e: unknown) => {
      console.error("HausElorae", e);
      balik.current.onSiap();
      balik.current.onSelesai();
    };

    (async () => {
      const [THREE, { RoomEnvironment }, { FontLoader }, { TextGeometry }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
        import("three/examples/jsm/loaders/FontLoader.js"),
        import("three/examples/jsm/geometries/TextGeometry.js"),
      ]);
      const font = await new FontLoader().loadAsync(FONT_3D);
      const wadah = kanvasRef.current;
      if (batal || !wadah) return;

      const W = window.innerWidth;
      const kecil = W < 640;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, kecil ? 1.5 : 2));
      renderer.setSize(W, window.innerHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
      wadah.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const latarScene = new THREE.Color("#12120f");
      const kabut = new THREE.Fog("#12120f", 9, 26);
      scene.background = latarScene;
      scene.fog = kabut;
      const pmrem = new THREE.PMREMGenerator(renderer);
      const lingkungan = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
      scene.environment = lingkungan;
      const camera = new THREE.PerspectiveCamera(32, W / window.innerHeight, 0.1, 100);

      const hemi = new THREE.HemisphereLight("#ffffff", "#bdb9b0", 0);
      const sorot = new THREE.SpotLight("#ffffff", 0, 30, Math.PI / 7, 0.55, 1.2);
      sorot.position.set(1.5, 9, 3);
      sorot.target.position.set(0, 1, 0);
      sorot.castShadow = true;
      sorot.shadow.mapSize.set(kecil ? 512 : 1024, kecil ? 512 : 1024);
      sorot.shadow.bias = -0.0004;
      scene.add(hemi, sorot, sorot.target);

      const matLantai = new THREE.MeshStandardMaterial({ roughness: 0.92 });
      const lantai = new THREE.Mesh(new THREE.CircleGeometry(40, 64), matLantai);
      lantai.rotation.x = -Math.PI / 2;
      lantai.receiveShadow = true;
      const matAlas = new THREE.MeshStandardMaterial({ roughness: 0.6 });
      const alas = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.5, 64), matAlas);
      alas.position.y = 0.25;
      alas.castShadow = alas.receiveShadow = true;
      scene.add(lantai, alas);

      const krom = new THREE.MeshPhysicalMaterial({ color: "#e9ebf0", metalness: 1, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.25 });
      const kromAksen = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.18, clearcoat: 1, envMapIntensity: 1.1 });
      // Warna, logam, dan kekasaran diatur `pasangTema` menurut terang/gelap.
      const kromHuruf = new THREE.MeshPhysicalMaterial({ metalness: 0.6, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });

      const geoBlob = new THREE.IcosahedronGeometry(0.9, kecil ? 18 : 28);
      const asal = Float32Array.from(geoBlob.attributes.position.array as ArrayLike<number>);
      const blob = new THREE.Mesh(geoBlob, krom);
      blob.position.y = 1.55;
      blob.castShadow = true;
      scene.add(blob);

      const cincin = [2.0, 2.35, 2.7].map((r, i) => {
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.028, 24, 220), i === 1 ? kromAksen : krom);
        m.position.y = 1.55;
        m.castShadow = true;
        scene.add(m);
        return m;
      });

      const huruf: InstanceType<typeof THREE.Group>[] = [];
      const lebar: number[] = [];
      "ELORAE".split("").forEach((h, i) => {
        const g = new TextGeometry(h, { font, size: 0.62, height: 0.16, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.012, bevelSegments: 4 });
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        g.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
        lebar.push(bb.max.x - bb.min.x);
        const grp = new THREE.Group();
        const m = new THREE.Mesh(g, kromHuruf);
        m.castShadow = true;
        grp.add(m);
        // Font 3D tidak punya "É": aksennya potongan krom di atas E terakhir.
        if (i === 5) {
          const ak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.16), kromHuruf);
          ak.position.set(0.05, 0.47, 0);
          ak.rotation.z = 0.5;
          ak.castShadow = true;
          grp.add(ak);
        }
        grp.scale.setScalar(0.0001);
        scene.add(grp);
        huruf.push(grp);
      });
      const jarak = 0.1;
      const total = lebar.reduce((a, b) => a + b, 0) + jarak * 5;
      const xs: number[] = [];
      let x = -total / 2;
      for (const w of lebar) {
        xs.push(x + w / 2);
        x += w + jarak;
      }

      // Tema → bahan & teks. Dipanggil ulang selama tema bisa masih berubah.
      let ruang: WarnaRuang = warnaRuang(bacaTema());
      let latar = bacaTema().latar;
      const pasangTema = () => {
        const tema = bacaTema();
        latar = tema.latar;
        ruang = warnaRuang(tema);
        matLantai.color.set(ruang.lantai);
        matAlas.color.set(ruang.alas);
        kromHuruf.color.set(ruang.huruf);
        // Terang: krom hitam mengkilap. Gelap: logam berwarna tema (anodisasi),
        // cukup kasar supaya warnanya terbaca, bukan hanya pantulan ruangan.
        kromHuruf.metalness = ruang.gelap ? 0.6 : 0.85;
        kromHuruf.roughness = ruang.gelap ? 0.24 : 0.16;
        kromHuruf.envMapIntensity = ruang.gelap ? 1.1 : 1.4;
        kromAksen.color.set(ruang.cincinAksen);
        sorot.color.set(ruang.sorot);
        const teks = ruang.gelap ? campurHex(tema.teks, "#ffffff", 0.2) : tema.teks;
        if (capRef.current) capRef.current.style.color = teks;
        if (putihRef.current) putihRef.current.style.background = latar;
        if (lewatiRef.current) {
          lewatiRef.current.style.color = teks;
          lewatiRef.current.style.borderColor = campurHex(teks, ruang.dinding, 0.6);
        }
      };
      pasangTema();
      // Bingkai pertama = latar dasbor, sama dengan penutup polos di bawahnya.
      latarScene.set(ruang.awal);
      kabut.color.set(ruang.awal);

      const geom = [geoBlob, lantai.geometry, alas.geometry, ...cincin.map((c) => c.geometry), ...huruf.flatMap((g) => g.children.map((c) => (c as InstanceType<typeof THREE.Mesh>).geometry))];
      const bahan = [krom, kromAksen, kromHuruf, matLantai, matAlas];
      bersihkan = () => {
        geom.forEach((g) => g.dispose());
        bahan.forEach((b) => b.dispose());
        lingkungan.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };

      const ukur = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", ukur);
      const lepasUkur = () => window.removeEventListener("resize", ukur);
      const bersihAwal = bersihkan;
      bersihkan = () => {
        lepasUkur();
        bersihAwal();
      };

      const qa = new THREE.Quaternion();
      const qb = new THREE.Quaternion();
      const nol = new THREE.Quaternion();
      const e = new THREE.Euler();
      const vOrbit = new THREE.Vector3();
      const vTuju = new THREE.Vector3();
      const mulai = performance.now();
      let sudahBuka = false;
      let selesai = false;
      let tTema = 0;

      const waktuEfektif = (sekarang: number) => {
        const lw = lewatiPada.current;
        if (lw === null) return sekarang - mulai;
        const t0 = Math.max(lw - mulai, 0);
        return Math.max(t0, LEWATI_KE_MS) + (sekarang - lw) * 1.25;
      };

      const bingkai = (sekarang: number) => {
        if (batal || selesai) return;
        const tm = Math.min(DURASI_HAUS_MS, waktuEfektif(sekarang));
        const s = tm / 1000;
        if (tm < 6000 && sekarang - tTema > 500) {
          tTema = sekarang;
          pasangTema();
        }

        const zSusun = jarakKamera(total, camera.fov, camera.aspect);
        kabut.near = zSusun + 3;
        kabut.far = zSusun + 22;

        // 1. Lampu sorot menyala; dinding bergeser dari latar dasbor ke warna galeri.
        const nyala = pelan.keluar(fase(tm, WAKTU.nyala[0], WAKTU.nyala[1]));
        const dinding = campurHex(ruang.awal, ruang.dinding, nyala);
        latarScene.set(dinding);
        kabut.color.set(dinding);
        sorot.intensity = lerp(0, ruang.gelap ? 170 : 140, nyala);
        hemi.intensity = lerp(0, ruang.gelap ? 0.45 : 0.9, nyala);
        renderer.toneMappingExposure = lerp(0.35, 1, nyala);

        // Kamera: orbit pelan, mundur ke posisi baca, lalu menembus lingkaran.
        const orb = pelan.masukKeluar(fase(tm, 0, 7600));
        const sud = lerp(-0.55, 0, orb);
        let rz = lerp(zSusun + 3.5, zSusun, orb);
        const ry = lerp(0.6, 1.55, orb);
        const masuk = pelan.masuk(fase(tm, WAKTU.buka, DURASI_HAUS_MS));
        rz = lerp(rz, -1.2, masuk);
        camera.position.set(Math.sin(sud) * rz, ry + Math.sin(s * 0.6) * 0.04, Math.cos(sud) * rz);
        camera.lookAt(0, 1.5, 0);

        // 2. Patung krom bernapas.
        const amp = 0.08 + 0.22 * fase(tm, 2200, 5200) - 0.2 * fase(tm, 6000, 8200);
        const pos = geoBlob.attributes.position.array as Float32Array;
        for (let k = 0; k < pos.length; k += 3) {
          const ox = asal[k];
          const oy = asal[k + 1];
          const oz = asal[k + 2];
          const n = Math.sin(ox * 3.1 + s * 1.4) * Math.cos(oy * 2.7 - s * 1.1) + Math.sin(oz * 3.4 + s * 0.9) * 0.6;
          const f = 1 + amp * n * 0.5;
          pos[k] = ox * f;
          pos[k + 1] = oy * f;
          pos[k + 2] = oz * f;
        }
        geoBlob.attributes.position.needsUpdate = true;
        geoBlob.computeVertexNormals();
        blob.rotation.y = s * 0.25;

        // Cincin kinetik: giroskop, lalu sejajar menjadi lingkaran di belakang nama.
        const sejajar = pelan.masukKeluar(fase(tm, WAKTU.cincinSejajar[0], WAKTU.cincinSejajar[1]));
        cincin.forEach((c, i) => {
          e.set(s * (0.5 + i * 0.23) + i, s * (0.35 - i * 0.2), s * 0.2 * (i + 1));
          qa.setFromEuler(e);
          c.quaternion.slerpQuaternions(qa, nol, sejajar);
          c.position.z = lerp(0, -0.6 - i * 0.15, sejajar);
        });

        // 3. Huruf: muncul mengorbit, lalu terbang menyusun nama.
        const susun = pelan.masukKeluar(fase(tm, WAKTU.susun[0], WAKTU.susun[1]));
        huruf.forEach((h, i) => {
          const a0 = WAKTU.hurufMuncul + i * WAKTU.hurufJeda;
          const muncul = pelan.keluarEkspo(fase(tm, a0, a0 + 900));
          h.scale.setScalar(Math.max(0.0001, muncul * (1 + 0.04 * Math.sin(s * 2 + i))));
          const a = (i / 6) * Math.PI * 2 + s * 0.9;
          vOrbit.set(Math.cos(a) * 3.1, 1.55 + Math.sin(a * 2 + i) * 0.35, Math.sin(a) * 3.1);
          vTuju.set(xs[i], 1.55 + Math.sin(s * 1.6 + i * 0.7) * 0.03 * (1 - masuk), 2.2);
          h.position.lerpVectors(vOrbit, vTuju, susun);
          e.set(s * 0.7 + i, s * 1.1 + i * 2, 0.3 * Math.sin(s + i));
          qa.setFromEuler(e);
          h.quaternion.slerpQuaternions(qa, qb.identity(), susun);
        });

        // Keterangan pameran, lalu warna latar dasbor menutup → aplikasi.
        if (capRef.current) {
          const kaps = capRef.current.children;
          for (let i = 0; i < kaps.length; i++) {
            const el = kaps[i] as HTMLElement;
            el.style.opacity = String(pelan.keluar(fase(tm, 600 + i * 250, 1400 + i * 250)) * (1 - fase(tm, WAKTU.buka, WAKTU.buka + 500)));
          }
        }
        if (jamRef.current) jamRef.current.textContent = `00:${String(Math.floor(s)).padStart(2, "0")} / 00:11`;
        if (putihRef.current) putihRef.current.style.opacity = String(fase(tm, WAKTU.putih[0], WAKTU.putih[1]));
        if (wadahRef.current) wadahRef.current.style.opacity = String(1 - fase(tm, WAKTU.app[0], WAKTU.app[1]));
        if (!sudahBuka && tm >= WAKTU.app[0]) {
          sudahBuka = true;
          balik.current.onBuka();
        }
        if (lewatiRef.current) {
          const tampil = tm > LEWATI_TAMPIL_MS && tm < WAKTU.buka && lewatiPada.current === null;
          lewatiRef.current.style.opacity = tampil ? "1" : "0";
          lewatiRef.current.style.pointerEvents = tampil ? "auto" : "none";
        }

        renderer.render(scene, camera);
        if (tm >= DURASI_HAUS_MS) {
          selesai = true;
          balik.current.onSelesai();
          return;
        }
        raf = requestAnimationFrame(bingkai);
      };

      renderer.render(scene, camera);
      balik.current.onSiap();
      raf = requestAnimationFrame(bingkai);
    })().catch(gagal);

    return () => {
      batal = true;
      cancelAnimationFrame(raf);
      bersihkan?.();
    };
  }, []);

  useEffect(() => {
    const tekan = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (lewatiPada.current === null) lewatiPada.current = performance.now();
      }
    };
    window.addEventListener("keydown", tekan);
    return () => window.removeEventListener("keydown", tekan);
  }, []);

  const lewati = () => {
    if (lewatiPada.current === null) lewatiPada.current = performance.now();
  };

  const kap = "absolute font-mono text-[11px] uppercase tracking-[0.14em] whitespace-nowrap opacity-0";
  return (
    <div ref={wadahRef} className="fixed inset-0 z-[201] cursor-pointer select-none" onPointerDown={lewati} role="presentation">
      <div ref={kanvasRef} className="absolute inset-0" aria-hidden />
      <div ref={capRef} aria-hidden>
        <span className={`${kap} left-[18px] top-4`}>Haus Eloraé</span>
        <span className={`${kap} right-[18px] top-4`}>{t("pameran", { tahun })}</span>
        <span ref={jamRef} className={`${kap} bottom-4 left-[18px]`}>00:00</span>
        <span className={`${kap} bottom-4 right-[18px]`}>{t("studi")}</span>
      </div>
      <div ref={putihRef} className="pointer-events-none absolute inset-0 opacity-0" />
      <button
        ref={lewatiRef}
        type="button"
        onPointerDown={(e) => {
          e.stopPropagation();
          lewati();
        }}
        className="absolute bottom-12 right-[18px] rounded-full border px-4 py-2 text-sm opacity-0 transition-opacity duration-500"
      >
        {t("lewati")}
      </button>
    </div>
  );
}
