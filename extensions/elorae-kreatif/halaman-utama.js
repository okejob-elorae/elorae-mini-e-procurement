// Skrip dunia MAIN (dunia halaman TikTok), dijalankan di document_start sebelum skrip TikTok.
// Satu-satunya tugasnya: membungkus fetch dan XMLHttpRequest, lalu meneruskan respons JSON dari
// daftar video profil (/api/post/item_list/) ke skrip ISOLATED (konten.js) lewat postMessage.
// Tidak mengubah permintaan maupun respons; kegagalan di sini tidak boleh mengganggu TikTok.
// Skrip klasik (bukan modul): tidak bisa mengimpor lib/pengurai.js.
(() => {
  "use strict";
  // Sama dengan TAG di konten.js.
  const TAG = "elorae-kreatif:item-list:v1";
  // Sama dengan POLA_URL_ITEM_LIST di lib/pengurai.js.
  const POLA = "/api/post/item_list/";
  const MAKS_SIMPANAN = 20;
  const simpanan = [];

  const cocok = (url) => typeof url === "string" && url.includes(POLA);

  function mutlak(url) {
    try {
      return new URL(url, location.href).href;
    } catch {
      return String(url);
    }
  }

  function teruskan(url, body) {
    if (!body || typeof body !== "object") return;
    const pesan = { sumber: TAG, jenis: "item_list", url: mutlak(url), body };
    simpanan.push(pesan);
    if (simpanan.length > MAKS_SIMPANAN) simpanan.shift();
    try {
      window.postMessage(pesan, location.origin);
    } catch {
      // badan yang tidak bisa diklon diabaikan
    }
  }

  // ---- fetch
  const fetchAsli = window.fetch;
  if (typeof fetchAsli === "function") {
    window.fetch = function (...argumen) {
      const janji = fetchAsli.apply(this, argumen);
      try {
        const masukan = argumen[0];
        const url =
          typeof masukan === "string" ? masukan : masukan instanceof URL ? masukan.href : masukan && masukan.url;
        if (cocok(url)) {
          janji
            .then((res) => res.clone().json())
            .then((body) => teruskan(url, body))
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
          let body = null;
          if (xhr.responseType === "" || xhr.responseType === "text") body = JSON.parse(xhr.responseText);
          else if (xhr.responseType === "json") body = xhr.response;
          teruskan(url, body);
        } catch {
          // bukan JSON
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
