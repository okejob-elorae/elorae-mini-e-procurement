// Skrip dunia MAIN (dunia halaman Instagram), dijalankan di document_start sebelum skrip Instagram.
// Satu-satunya tugasnya: membungkus fetch dan XMLHttpRequest, lalu meneruskan TEKS respons JSON
// Instagram yang memuat data profil atau posting (GraphQL / api/v1 — dimuat halaman itu sendiri
// untuk pengguna yang sudah masuk) ke skrip ISOLATED (konten.js) lewat postMessage. Tidak mengubah
// permintaan maupun respons, tidak membuat permintaan sendiri; kegagalan di sini tidak boleh
// mengganggu Instagram. Skrip klasik (bukan modul): tidak bisa mengimpor lib/pengurai-instagram.js.
(() => {
  "use strict";
  // Sama dengan TAG_IG di konten.js.
  const TAG = "elorae-kreatif:ig-tangkap:v1";
  // Sama dengan POLA_URL_TANGKAPAN di lib/pengurai-instagram.js.
  const POLA = ["/graphql/query", "/api/graphql", "/graphql/", "/api/v1/"];
  // Hanya respons yang memuat penanda data profil/posting yang diteruskan.
  const PENANDA = ['"taken_at', '"follower_count"', '"edge_followed_by"'];
  const MAKS_TEKS = 4_000_000;
  const MAKS_SIMPANAN = 20;
  const simpanan = [];

  const cocok = (url) => typeof url === "string" && POLA.some((p) => url.includes(p));

  function mutlak(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return String(url);
    }
  }

  function teruskan(url, teks) {
    if (typeof teks !== "string" || teks.length > MAKS_TEKS || !PENANDA.some((p) => teks.includes(p))) return;
    const pesan = { sumber: TAG, jenis: "tangkapan", url: mutlak(url), teks };
    simpanan.push(pesan);
    if (simpanan.length > MAKS_SIMPANAN) simpanan.shift();
    try {
      window.postMessage(pesan, location.origin);
    } catch {
      // abaikan
    }
  }

  // ---- fetch
  const fetchAsli = window.fetch;
  if (typeof fetchAsli === "function") {
    window.fetch = function (...argumen) {
      const janji = fetchAsli.apply(this, argumen);
      try {
        const masukan = argumen[0];
        const url = typeof masukan === "string" ? masukan : masukan instanceof URL ? masukan.href : masukan && masukan.url;
        if (cocok(url)) {
          janji
            .then((res) => res.clone().text())
            .then((teks) => teruskan(url, teks))
            .catch(() => {});
        }
      } catch {
        // abaikan
      }
      return janji;
    };
  }

  // ---- XMLHttpRequest
  const urlXhr = new WeakMap();
  const bukaAsli = XMLHttpRequest.prototype.open;
  const kirimAsli = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metode, url) {
    try {
      urlXhr.set(this, String(url));
    } catch {
      // abaikan
    }
    return bukaAsli.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const url = urlXhr.get(this);
    if (cocok(url)) {
      const xhr = this;
      xhr.addEventListener("load", () => {
        try {
          if (xhr.responseType === "" || xhr.responseType === "text") teruskan(url, xhr.responseText);
          else if (xhr.responseType === "json" && xhr.response) teruskan(url, JSON.stringify(xhr.response));
        } catch {
          // abaikan
        }
      });
    }
    return kirimAsli.apply(this, arguments);
  };

  // konten.js bisa terpasang belakangan (mis. setelah ekstensi dimuat ulang): kirim ulang simpanan.
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || typeof d !== "object" || d.sumber !== TAG || d.jenis !== "minta-ulang") return;
    for (const pesan of simpanan) {
      try {
        window.postMessage(pesan, location.origin);
      } catch {
        // abaikan
      }
    }
  });
})();
