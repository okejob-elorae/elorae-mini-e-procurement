import { describe, expect, it } from 'vitest';
import { prisma } from '@elorae/db';
import { simpanKonten } from './writer';
import { daftarKonten } from './queries';
import { susunFeed, labelTanggal } from './feed';

/**
 * Membaca ulang bentuk feed yang dipakai tim hari ini di spreadsheet.
 *
 * Bukan tes aturan — ini bukti bahwa susunannya benar-benar keluar seperti yang
 * sudah mereka baca setiap hari: tiga kolom, terbaru di kiri atas, slot kosong
 * dipertahankan.
 */
describe('bentuk grid feed', () => {
  it('menghasilkan susunan yang sama dengan sheet ELORAE_AUG', async () => {
    const tag = `FEEDUJI-${Math.random().toString(36).slice(2, 7)}`;
    const u = await prisma.user.findFirstOrThrow({ select: { id: true } });
    // Tanggal diambil dari sheet aslinya, termasuk slot yang belum ada asetnya.
    const jadwal: [string, boolean][] = [
      ['2026-10-04', false], ['2026-10-04', false], ['2026-10-04', false],
      ['2026-10-01', false], ['2026-09-29', true], ['2026-09-27', true],
      ['2026-09-26', false], ['2026-09-25', true], ['2026-09-23', false],
    ];
    const ids: string[] = [];
    for (const [tgl, adaGambar] of jadwal) {
      const r = await simpanKonten({
        isi: {
          title: `${tag} ${tgl}`,
          platform: 'INSTAGRAM',
          format: 'FEED',
          status: 'DIJADWALKAN',
          scheduledAt: new Date(`${tgl}T03:00:00Z`),
          imageUrl: adaGambar ? '/api/foto/contoh' : null,
        },
        olehUserId: u.id,
      });
      if (r.ok) ids.push(r.id);
    }

    const semua = (await daftarKonten()).filter((k) => k.title.startsWith(tag));
    const feed = susunFeed(semua);

    console.log('\n  ── Grid feed (seperti sheet-nya) ──');
    for (const b of feed) {
      const tgl = b.sel.map((s) => (labelTanggal(s.konten.scheduledAt, 'id') ?? '—').padStart(13)).join(' │');
      const ubin = b.sel.map((s) => (s.jenis === 'konten' ? '   [gambar]  ' : '   (kosong)  ')).join(' │');
      console.log(`  ${String(b.nomor).padStart(2)}  ${tgl}\n      ${ubin}`);
    }

    expect(feed).toHaveLength(3);
    // Terbaru di kiri atas.
    expect(labelTanggal(feed[0].sel[0].konten.scheduledAt, 'id')).toBe('4 Oktober');
    // Slot kosong dipertahankan pada posisinya.
    expect(feed[1].sel.map((s) => s.jenis)).toEqual(['kosong', 'konten', 'konten']);

    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.contentPlan.deleteMany({ where: { id: { in: ids } } });
  });
});
