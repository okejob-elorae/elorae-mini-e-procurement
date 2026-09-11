"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Minus,
  Package,
  Plus,
  RotateCcw,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { compressImage } from "@/lib/pwa/photo/compress";
import { FIELD_RETURN_REASONS, type FieldReturnReasonInput } from "@/lib/field-sales/retur/types";

type CatalogItem = {
  itemId: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  variants: Array<{ variantSku: string; variantLabel: string }>;
};

type Payload = { items: CatalogItem[] };
type LoadState = "loading" | "ready" | "error";
type Reason = FieldReturnReasonInput;
type Transport = "SELF_CARRY" | "EXPEDITION";
type CamMode = "idle" | "live" | "preview";

type ReturnLine = {
  itemId: string;
  sku: string;
  nameId: string;
  variantSku: string;
  variantLabel: string | null;
  qty: number;
  reason: Reason;
  reasonNote: string;
};

const REASON_LABEL: Record<Reason, string> = {
  DAMAGED: "Rusak",
  UNSOLD: "Tidak Laku",
  EXPIRED: "Kadaluarsa",
  OTHER: "Lainnya",
};
const REASON_ORDER: readonly Reason[] = FIELD_RETURN_REASONS;

const PAGE_SIZE = 10;
const lineKey = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;

/**
 * Maps a failed /pwa/api/retur response to an Indonesian message a salesman can act on.
 * Every FieldReturnErrorCode gets its own sentence — a generic "gagal" for six distinct
 * causes is not acceptable per the task brief.
 */
function messageForFailure(status: number, body: unknown): string {
  const code = (body as { code?: string } | null)?.code;
  const error = (body as { error?: string } | null)?.error;
  if (code) {
    switch (code) {
      case "NO_LINES":
        return "Tambahkan minimal satu barang retur.";
      case "BAD_QTY":
        return "Jumlah barang tidak valid. Periksa kembali.";
      case "BAD_LINE_SHAPE":
        return "Data baris retur tidak terbaca. Muat ulang halaman lalu isi ulang barangnya.";
      case "ITEM_NOT_FOUND":
        return "Ada barang yang tidak dikenali sistem. Muat ulang katalog lalu pilih ulang barangnya.";
      case "STORE_NOT_FOUND":
        return "Toko tidak ditemukan atau sudah nonaktif.";
      case "VISIT_NOT_OWNED":
        return "Kunjungan tidak valid untuk akun ini. Coba check-in ulang.";
      case "MISSING_RESI":
        return "Nomor resi wajib diisi untuk pengiriman ekspedisi.";
      case "MISSING_EXPEDITION_NAME":
        return "Nama ekspedisi wajib diisi untuk pengiriman ekspedisi.";
      case "MISSING_REASON_NOTE":
        return "Catatan wajib diisi untuk alasan Lainnya.";
      default:
        return "Gagal menyimpan retur. Coba lagi.";
    }
  }
  if (status === 401) return "Sesi berakhir. Masuk lagi.";
  if (status === 403) return "Tidak punya akses untuk fitur ini.";
  if (status === 503) return "Layanan unggah foto belum tersedia. Coba lagi nanti.";
  if (status === 502) return "Gagal mengunggah foto. Periksa koneksi lalu coba lagi.";
  // A generic 5xx is a server-side failure, not something retaking the photo or re-filling
  // the form fixes — do not blame the input.
  if (status >= 500) return "Server sedang bermasalah. Coba lagi beberapa saat lagi.";
  if (error) return "Data retur tidak valid. Ambil ulang foto lalu coba lagi.";
  return "Gagal menyimpan retur. Coba lagi.";
}

export function ReturShell({ storeId, storeName, visitId }: { storeId: string; storeName: string; visitId: string | null }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [lines, setLines] = useState<Map<string, ReturnLine>>(new Map());

  const [transport, setTransport] = useState<Transport>("SELF_CARRY");
  const [expeditionName, setExpeditionName] = useState("");
  const [resiNo, setResiNo] = useState("");
  const [note, setNote] = useState("");

  const [camMode, setCamMode] = useState<CamMode>("idle");
  const [liveCaptured, setLiveCaptured] = useState<{ blob: Blob; url: string } | null>(null);
  const [notaPhoto, setNotaPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [camError, setCamError] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const openingCamRef = useRef(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ docNo: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/pwa/api/catalog?storeId=${encodeURIComponent(storeId)}&includeInactive=1`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Payload>;
      })
      .then((data) => {
        if (!alive) return;
        setItems(data.items);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [storeId]);

  // Camera lifecycle mirrors VisitPhotoCapture exactly: the stream is attached to the
  // <video> element in a POST-MOUNT effect, never synchronously during render. Attaching
  // synchronously races the render and leaves srcObject unset, producing a black feed —
  // that cost hours to diagnose once, so this structure is copied rather than reinvented.
  useEffect(() => {
    if (camMode === "live" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => {});
    }
  }, [camMode]);

  const stopCam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopCam(), []);

  useEffect(() => {
    return () => {
      if (liveCaptured) URL.revokeObjectURL(liveCaptured.url);
    };
  }, [liveCaptured]);

  // Revoke the nota-photo object URL whenever it is replaced or on unmount.
  useEffect(() => {
    return () => {
      if (notaPhoto) URL.revokeObjectURL(notaPhoto.url);
    };
  }, [notaPhoto]);

  function closeCamOverlay() {
    stopCam();
    setLiveCaptured(null);
    setCamError(false);
    setCamMode("idle");
  }

  async function openCam() {
    // getUserMedia is awaited with the trigger still enabled, so a double tap would start a
    // SECOND stream and overwrite streamRef — teardown then stops only the second and the
    // first keeps the camera indicator lit until the tab closes. Guard synchronously.
    if (openingCamRef.current || streamRef.current) return;
    openingCamRef.current = true;
    setCamError(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setCamMode("live");
    } catch {
      setCamError(true);
      fileRef.current?.click(); // fallback to the native camera / file picker
    } finally {
      openingCamRef.current = false;
    }
  }

  function shootFromVideo() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setLiveCaptured({ blob, url: URL.createObjectURL(blob) }); // stream stays live for a retake
        setCamMode("preview");
      },
      "image/jpeg",
      0.92,
    );
  }

  function retake() {
    setLiveCaptured(null);
    if (streamRef.current) {
      setCamMode("live");
    } else {
      // File-fallback path: reopen the picker; onChange returns us to preview.
      setCamMode("idle");
      fileRef.current?.click();
    }
  }

  async function keepPhoto() {
    if (!liveCaptured) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(liveCaptured.blob);
      setNotaPhoto({ blob: compressed, url: URL.createObjectURL(compressed) });
      closeCamOverlay();
    } catch {
      // leave the overlay open so the salesman can retry "Simpan"
    } finally {
      setCompressing(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => it.sku.toLowerCase().includes(needle) || it.nameId.toLowerCase().includes(needle));
  }, [items, q]);

  useEffect(() => {
    setPage(1);
  }, [q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function setLineQty(it: CatalogItem, variantSku: string, variantLabel: string | null, qty: number) {
    const key = lineKey(it.itemId, variantSku);
    setLines((prev) => {
      const next = new Map(prev);
      if (qty <= 0) {
        next.delete(key);
        return next;
      }
      const existing = prev.get(key);
      next.set(key, {
        itemId: it.itemId,
        sku: it.sku,
        nameId: it.nameId,
        variantSku,
        variantLabel,
        qty,
        reason: existing?.reason ?? "DAMAGED",
        reasonNote: existing?.reasonNote ?? "",
      });
      return next;
    });
  }

  function setLineReason(key: string, reason: Reason) {
    setLines((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, { ...existing, reason, reasonNote: reason === "OTHER" ? existing.reasonNote : "" });
      return next;
    });
  }

  function setLineReasonNote(key: string, reasonNote: string) {
    setLines((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(key, { ...existing, reasonNote });
      return next;
    });
  }

  function removeLine(key: string) {
    setLines((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }

  const lineArr = useMemo(() => Array.from(lines.values()), [lines]);
  const totalUnits = lineArr.reduce((s, l) => s + l.qty, 0);
  const hasOtherWithoutNote = lineArr.some((l) => l.reason === "OTHER" && l.reasonNote.trim() === "");
  const expeditionValid = transport === "SELF_CARRY" || (expeditionName.trim() !== "" && resiNo.trim() !== "");
  const canSubmit = lineArr.length > 0 && notaPhoto !== null && !hasOtherWithoutNote && expeditionValid && !submitting;

  async function onSubmit() {
    if (submittingRef.current || !canSubmit || !notaPhoto) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const fd = new FormData();
      fd.append("file", new File([notaPhoto.blob], "nota-retur.jpg", { type: "image/jpeg" }));
      fd.append("storeId", storeId);
      if (visitId) fd.append("visitId", visitId);
      fd.append("transport", transport);
      if (transport === "EXPEDITION") {
        fd.append("expeditionName", expeditionName.trim());
        fd.append("resiNo", resiNo.trim());
      }
      if (note.trim()) fd.append("note", note.trim());
      fd.append(
        "lines",
        JSON.stringify(
          lineArr.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku,
            qty: l.qty,
            reason: l.reason,
            ...(l.reason === "OTHER" ? { reasonNote: l.reasonNote.trim() } : {}),
          })),
        ),
      );

      const res = await fetch("/pwa/api/retur", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        if (body?.docNo) {
          setResult({ docNo: body.docNo });
          return;
        }
        // The server committed (2xx) but the body did not parse or carry a docNo — this is
        // NOT the same as a failed create, so it must not say "coba lagi" (this endpoint has
        // no idempotency key; inviting a resubmit here risks a duplicate retur). The salesman
        // is pointed at a PERSON, not a screen: the PWA has no retur list, and the backoffice
        // register is gated on a permission a SALESMAN does not hold.
        setSubmitError("Retur kemungkinan sudah tersimpan tapi responsnya tidak lengkap. Hubungi admin untuk memastikan sebelum mengirim ulang.");
        return;
      }
      setSubmitError(messageForFailure(res.status, body));
    } catch {
      // A dropped connection/timeout does not tell us whether the server already committed
      // the retur and stored the photo — a 502 (upload failed, nothing written) is the only
      // status that is genuinely safe to retry, so this message must not read the same.
      setSubmitError("Koneksi terputus. Retur MUNGKIN sudah tersimpan — hubungi admin untuk memastikan sebelum mengirim ulang.");
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  function resetForm() {
    setQ("");
    setPage(1);
    setExpandedItemId(null);
    setLines(new Map());
    setTransport("SELF_CARRY");
    setExpeditionName("");
    setResiNo("");
    setNote("");
    setNotaPhoto(null);
    setResult(null);
    setSubmitError(null);
  }

  const camOverlay =
    camMode !== "idle" && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col bg-black">
            {camMode === "live" && (
              <>
                <video ref={videoRef} autoPlay playsInline muted className="min-h-0 w-full flex-1 object-cover" />
                <div className="flex items-center justify-between px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                  <Button variant="secondary" size="icon" className="h-11 w-11 rounded-full" onClick={closeCamOverlay} aria-label="Tutup">
                    <X className="h-5 w-5" />
                  </Button>
                  <button
                    type="button"
                    onClick={shootFromVideo}
                    aria-label="Ambil foto"
                    className="h-16 w-16 rounded-full border-4 border-white bg-white/30 transition active:scale-95"
                  />
                  <span className="h-11 w-11" aria-hidden />
                </div>
              </>
            )}

            {camMode === "preview" && (
              <>
                <div className="flex min-h-0 flex-1 items-center justify-center bg-black">
                  {liveCaptured && <img src={liveCaptured.url} alt="" className="max-h-full max-w-full object-contain" />}
                </div>
                <div className="flex gap-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Button variant="secondary" className="flex-1 py-6 text-base" onClick={retake} disabled={compressing}>
                    <RotateCcw className="mr-2 h-5 w-5" /> Ulangi
                  </Button>
                  <Button className="flex-1 py-6 text-base" onClick={() => void keepPhoto()} disabled={compressing}>
                    {compressing ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />} Simpan
                  </Button>
                </div>
              </>
            )}
          </div>,
          document.body,
        )
      : null;

  if (result) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="rounded-full bg-primary p-3">
              <ClipboardCheck className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Retur berhasil dibuat</p>
              <p className="mt-1 text-3xl font-bold tracking-wide">{result.docNo}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Tulis kode ini pada barang retur — gudang memakainya untuk mengenali klaim ini.
            </p>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={resetForm}>
            Buat Retur Lagi
          </Button>
          <Button asChild className="flex-1">
            <Link href={`/pwa/stores/${storeId}`}>Kembali ke Toko</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/pwa/stores/${storeId}`}>
            <ArrowLeft className="h-4 w-4" />
            Kembali
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-lg font-semibold">{storeName}</h1>
        <p className="text-sm text-muted-foreground">Retur barang dari toko</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pilih Barang</h2>
        <Input placeholder="Cari SKU atau nama" value={q} onChange={(e) => setQ(e.target.value)} />

        {state === "loading" && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat katalog…
          </div>
        )}
        {state === "error" && <p className="text-sm text-destructive">Gagal memuat katalog. Periksa koneksi lalu coba lagi.</p>}
        {state === "ready" && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {items.length === 0 ? "Belum ada produk di katalog toko ini." : "Tidak ada produk cocok."}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {shown.map((it) => {
            const hasVariants = it.variants.length > 0;
            const qty = lines.get(lineKey(it.itemId, ""))?.qty ?? 0;
            const variantLines = hasVariants ? lineArr.filter((l) => l.itemId === it.itemId) : [];
            const variantUnits = variantLines.reduce((s, l) => s + l.qty, 0);
            const expanded = expandedItemId === it.itemId;
            return (
              <Card key={it.itemId} className="flex-col gap-0 p-3">
                <div className="flex flex-row items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
                    {it.primaryImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.primaryImageUrl} alt={it.nameId} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.nameId}</p>
                    <p className="truncate text-xs text-muted-foreground">{it.sku}</p>
                  </div>
                  {hasVariants ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setExpandedItemId(expanded ? null : it.itemId)}
                    >
                      {variantUnits > 0 ? `${variantLines.length} varian · ${variantUnits} pcs` : "Pilih varian"}
                    </Button>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={qty <= 0}
                        onClick={() => setLineQty(it, "", null, qty - 1)}
                        aria-label={`Kurangi ${it.nameId}`}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        onClick={() => setLineQty(it, "", null, qty + 1)}
                        aria-label={`Tambah ${it.nameId}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {hasVariants && expanded && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                    {it.variants.map((v) => {
                      const vQty = lines.get(lineKey(it.itemId, v.variantSku))?.qty ?? 0;
                      return (
                        <div key={v.variantSku} className="flex items-center justify-between gap-2">
                          <span className="text-sm">{v.variantLabel}</span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              disabled={vQty <= 0}
                              onClick={() => setLineQty(it, v.variantSku, v.variantLabel, vQty - 1)}
                              aria-label={`Kurangi ${it.nameId} ${v.variantLabel}`}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="w-5 text-center text-sm font-semibold tabular-nums">{vQty}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              onClick={() => setLineQty(it, v.variantSku, v.variantLabel, vQty + 1)}
                              aria-label={`Tambah ${it.nameId} ${v.variantLabel}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {state === "ready" && filtered.length > 0 && (
          <div className="flex items-center justify-center gap-3 pt-1">
            <Button
              variant="outline"
              size="icon-lg"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-lg"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Halaman berikutnya"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Barang Retur</h2>
          {lineArr.length > 0 && (
            <Badge variant="secondary">
              {lineArr.length} SKU · {totalUnits} pcs
            </Badge>
          )}
        </div>

        {lineArr.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
              <Package className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Belum ada barang dipilih.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {lineArr.map((l) => {
              const key = lineKey(l.itemId, l.variantSku);
              return (
                <Card key={key} className="flex-col gap-2 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.nameId}</p>
                      {l.variantLabel && <p className="truncate text-xs text-muted-foreground">{l.variantLabel}</p>}
                      <p className="truncate text-xs text-muted-foreground">
                        {l.sku} · {l.qty} pcs
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-lg"
                      className="shrink-0"
                      onClick={() => removeLine(key)}
                      aria-label={`Hapus ${l.nameId}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <Select value={l.reason} onValueChange={(v) => setLineReason(key, v as Reason)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REASON_ORDER.map((r) => (
                        <SelectItem key={r} value={r}>
                          {REASON_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {l.reason === "OTHER" && (
                    <Textarea
                      placeholder="Jelaskan alasan retur…"
                      value={l.reasonNote}
                      onChange={(e) => setLineReasonNote(key, e.target.value)}
                      rows={2}
                    />
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Foto Nota Retur</h2>
        <Card className="flex-col gap-3 p-4">
          {notaPhoto ? (
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border">
                <img src={notaPhoto.url} alt="Nota retur" className="h-full w-full object-cover" />
              </div>
              <Button type="button" variant="outline" className="flex-1" onClick={() => void openCam()}>
                <Camera className="mr-2 h-4 w-4" /> Ganti Foto
              </Button>
            </div>
          ) : (
            <Button type="button" onClick={() => void openCam()}>
              <Camera className="mr-2 h-4 w-4" /> Ambil Foto Nota
            </Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                setLiveCaptured({ blob: f, url: URL.createObjectURL(f) });
                setCamMode("preview");
              }
            }}
          />
          {camError && <p className="text-xs text-muted-foreground">Kamera tidak tersedia — pakai kamera perangkat.</p>}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pengiriman</h2>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={transport === "SELF_CARRY" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setTransport("SELF_CARRY")}
          >
            Bawa Sendiri
          </Button>
          <Button
            type="button"
            variant={transport === "EXPEDITION" ? "default" : "outline"}
            className="flex-1"
            onClick={() => setTransport("EXPEDITION")}
          >
            <Truck className="h-4 w-4" /> Ekspedisi
          </Button>
        </div>

        {transport === "EXPEDITION" && (
          <div className="flex flex-col gap-2">
            <Input placeholder="Nama ekspedisi" value={expeditionName} onChange={(e) => setExpeditionName(e.target.value)} />
            <Input placeholder="Nomor resi" value={resiNo} onChange={(e) => setResiNo(e.target.value)} />
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <label htmlFor="retur-note" className="text-sm font-medium">
          Catatan (opsional)
        </label>
        <Textarea
          id="retur-note"
          placeholder="Tulis catatan tambahan untuk retur ini…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </section>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button type="button" className="w-full" size="lg" onClick={() => void onSubmit()} disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Mengirim…
            </>
          ) : (
            "Kirim Retur"
          )}
        </Button>
      </div>

      {camOverlay}
    </div>
  );
}
