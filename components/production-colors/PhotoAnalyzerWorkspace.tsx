'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, Crosshair, Scan, RotateCcw, ZoomIn, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FavoriteButton } from '@/components/production-colors/FavoriteButton';
import type { PantoneMatch } from '@/components/production-colors/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type SampleMode = 'point' | 'area';

type ColorSample = {
  id: string;
  hex: string;
  label: string;
  matches: PantoneMatch[];
  loading?: boolean;
};

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function averageHexFromImageData(data: Uint8ClampedArray): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return '#000000';
  return rgbToHex(Math.round(r / n), Math.round(g / n), Math.round(b / n));
}

export function PhotoAnalyzerWorkspace() {
  const t = useTranslations('productionColors');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<SampleMode>('point');
  const [magnifier, setMagnifier] = useState(true);
  const [samples, setSamples] = useState<ColorSample[]>([]);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [magnifierPos, setMagnifierPos] = useState<{ x: number; y: number; hex: string } | null>(null);

  const drawImageToCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete) return;
    const maxW = 720;
    const scale = Math.min(1, maxW / img.naturalWidth);
    canvas.width = Math.floor(img.naturalWidth * scale);
    canvas.height = Math.floor(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }, []);

  const sampleAt = useCallback(
    async (clientX: number, clientY: number, area?: { x: number; y: number; w: number; h: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      let hex: string;
      if (area && area.w > 2 && area.h > 2) {
        const x = Math.floor(area.x * scaleX);
        const y = Math.floor(area.y * scaleY);
        const w = Math.max(1, Math.floor(area.w * scaleX));
        const h = Math.max(1, Math.floor(area.h * scaleY));
        const data = ctx.getImageData(x, y, w, h).data;
        hex = averageHexFromImageData(data);
      } else {
        const x = Math.floor((clientX - rect.left) * scaleX);
        const y = Math.floor((clientY - rect.top) * scaleY);
        const data = ctx.getImageData(x, y, 1, 1).data;
        hex = rgbToHex(data[0], data[1], data[2]);
      }

      const id = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const label = hex;
      setSamples((prev) => [
        ...prev,
        { id, hex, label, matches: [], loading: true },
      ]);

      try {
        const res = await fetch('/api/production/colors/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hex, limit: 5 }),
        });
        if (!res.ok) throw new Error('match failed');
        const json = (await res.json()) as { matches: PantoneMatch[] };
        setSamples((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, matches: json.matches, loading: false } : s
          )
        );
      } catch {
        setSamples((prev) => prev.filter((s) => s.id !== id));
        toast.error('Failed to match color');
      }
    },
    []
  );

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!magnifier || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = ctx.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(data[0], data[1], data[2]);
    setMagnifierPos({ x: e.clientX - rect.left, y: e.clientY - rect.top, hex });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode !== 'point') return;
    void sampleAt(e.clientX, e.clientY);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'area') return;
    const rect = canvasRef.current!.getBoundingClientRect();
    setDragStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'area' || !dragStart || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const x = Math.min(dragStart.x, end.x);
    const y = Math.min(dragStart.y, end.y);
    const w = Math.abs(end.x - dragStart.x);
    const h = Math.abs(end.y - dragStart.y);
    setDragStart(null);
    if (w < 4 && h < 4) {
      void sampleAt(e.clientX, e.clientY);
    } else {
      void sampleAt(e.clientX, e.clientY, { x, y, w, h });
    }
  };

  const autoDominant8 = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const buckets = new Map<string, number>();
    const step = 4;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        const a = data[i + 3];
        if (a < 128) continue;
        const rq = Math.round(data[i] / 32) * 32;
        const gq = Math.round(data[i + 1] / 32) * 32;
        const bq = Math.round(data[i + 2] / 32) * 32;
        const key = `${rq},${gq},${bq}`;
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    const top = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => {
        const [r, g, b] = k.split(',').map(Number);
        return rgbToHex(r, g, b);
      });

    top.forEach((hex, idx) => {
      setTimeout(() => {
        const id = `auto-${Date.now()}-${idx}`;
        setSamples((prev) => [...prev, { id, hex, label: hex, matches: [], loading: true }]);
        fetch('/api/production/colors/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hex, limit: 5 }),
        })
          .then((r) => r.json())
          .then((json: { matches: PantoneMatch[] }) => {
            setSamples((prev) =>
              prev.map((s) =>
                s.id === id ? { ...s, matches: json.matches, loading: false } : s
              )
            );
          })
          .catch(() => {
            setSamples((prev) => prev.filter((s) => s.id !== id));
          });
      }, idx * 120);
    });
  };

  const onFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setSamples([]);
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('photoSessionNote')}</p>

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" />
          {t('photoUpload')}
        </Button>
        <Button
          type="button"
          variant={mode === 'point' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('point')}
        >
          <Crosshair className="h-4 w-4 mr-1" />
          {t('photoModePoint')}
        </Button>
        <Button
          type="button"
          variant={mode === 'area' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('area')}
        >
          <Scan className="h-4 w-4 mr-1" />
          {t('photoModeArea')}
        </Button>
        <Button
          type="button"
          variant={magnifier ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setMagnifier((m) => !m)}
        >
          <ZoomIn className="h-4 w-4 mr-1" />
          {t('photoMagnifier')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setSamples([])}>
          <RotateCcw className="h-4 w-4 mr-1" />
          {t('photoReset')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={autoDominant8} disabled={!imageUrl}>
          {t('photoAuto8')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            {!imageUrl ? (
              <div
                className="flex h-64 items-center justify-center rounded-lg border border-dashed text-muted-foreground text-sm cursor-pointer"
                onClick={() => fileRef.current?.click()}
              >
                {t('photoUpload')}
              </div>
            ) : (
              <div className="relative inline-block max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt=""
                  className="hidden"
                  onLoad={drawImageToCanvas}
                />
                <canvas
                  ref={canvasRef}
                  className={cn(
                    'max-w-full rounded-lg border cursor-crosshair',
                    mode === 'area' && 'cursor-cell'
                  )}
                  onClick={handleCanvasClick}
                  onPointerMove={handlePointerMove}
                  onPointerLeave={() => setMagnifierPos(null)}
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUp}
                />
                {magnifier && magnifierPos && (
                  <div
                    className="pointer-events-none absolute z-10 rounded-full border-2 border-white shadow-lg"
                    style={{
                      left: magnifierPos.x - 40,
                      top: magnifierPos.y - 40,
                      width: 80,
                      height: 80,
                      backgroundColor: magnifierPos.hex,
                    }}
                    title={magnifierPos.hex}
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('photoSamples')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 max-h-[600px] overflow-y-auto">
            {samples.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('photoNoSamples')}</p>
            )}
            {samples.map((sample) => (
              <div key={sample.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div
                    className="h-10 w-10 rounded border shrink-0"
                    style={{ backgroundColor: sample.hex }}
                  />
                  <span className="font-mono text-sm flex-1">{sample.hex}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      void navigator.clipboard.writeText(sample.hex);
                      toast.success(t('copied'));
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSamples((p) => p.filter((s) => s.id !== sample.id))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {sample.loading ? (
                  <p className="text-xs text-muted-foreground">Matching…</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{t('photoMatchTitle')}</p>
                    <div className="grid gap-2">
                      {sample.matches.map((m) => (
                        <div
                          key={m.tcx}
                          className="flex items-center gap-2 rounded border p-2 text-sm"
                        >
                          <div
                            className="h-8 w-8 rounded shrink-0 border"
                            style={{ backgroundColor: m.hex }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-xs">{m.tcx}</p>
                            <p className="truncate text-xs text-muted-foreground">{m.name}</p>
                            <p className="text-xs">
                              {t('deltaE')} {m.deltaE.toFixed(2)}
                            </p>
                          </div>
                          <FavoriteButton tcx={m.tcx} initialFavorited={!!m.isFavorite} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
