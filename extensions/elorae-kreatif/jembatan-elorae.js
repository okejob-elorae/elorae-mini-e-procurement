// Skrip konten di halaman Elorae (localhost:3000 / elorae.cloud). Satu tugas saja: saat halaman
// Elorae mengantrekan video ("Cek sekarang", "Tempel link"), ia mengirim
// window.postMessage({ sumber: "elorae-kreatif-web", jenis: "bangunkan" }) — skrip ini meneruskannya
// ke service worker supaya ekstensi bekerja seketika, tidak menunggu alarm per menit.
// Tidak membaca apa pun dari halaman Elorae.
(() => {
  "use strict";
  if (window.top !== window) return;
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const d = ev.data;
    if (!d || typeof d !== "object" || d.sumber !== "elorae-kreatif-web" || d.jenis !== "bangunkan") return;
    try {
      chrome.runtime.sendMessage({ jenis: "bangunkan" }, () => void chrome.runtime.lastError);
    } catch {
      // ekstensi baru dimuat ulang — halaman Elorae perlu dimuat ulang juga
    }
  });
})();
