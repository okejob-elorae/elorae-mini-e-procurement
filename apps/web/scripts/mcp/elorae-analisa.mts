/**
 * Konektor MCP lokal "elorae-analisa" untuk Claude Desktop.
 *
 * Claude Desktop menjalankan berkas ini di laptop dan berbicara dengannya
 * lewat stdin/stdout — tidak ada port yang dibuka, tidak ada yang bisa
 * dijangkau dari luar mesin ini. Pemakaiannya masuk kuota langganan Claude
 * pemakai Claude Desktop, bukan tagihan API.
 *
 * Membaca basis data dari `apps/web/.env` — di laptop pengembang itu basis
 * data LOKAL, bukan produksi. Alat dan batasnya ada di `lib/analisa/alat.ts`:
 * hanya membaca, tanpa piutang/konsinyasi.
 *
 * Pemasangan: tambahkan ke `~/Library/Application Support/Claude/
 * claude_desktop_config.json`, lalu mulai ulang Claude Desktop —
 *   "mcpServers": {
 *     "elorae-analisa": {
 *       "command": "<node>",
 *       "args": ["<apps/web>/node_modules/tsx/dist/cli.mjs",
 *                "--tsconfig", "<apps/web>/tsconfig.json", "<berkas ini>"]
 *     }
 *   }
 * Path ditulis lengkap: Claude Desktop menjalankannya tanpa PATH terminal.
 * Basis data lokal harus menyala (~/.elorae-local/erp.sh start).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// stdout MILIK protokol MCP. Satu baris lain di sana — log Prisma, console.log
// yang terselip di sebuah query — merusak pesannya dan konektor putus tanpa
// penjelasan. Semua log dialihkan ke stderr, yang dicatat Claude Desktop.
console.log = console.error;
console.info = console.error;
console.warn = console.error;

const akarWeb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
config({ path: path.join(akarWeb, '.env'), quiet: true });

const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
const { ALAT, jalankanAlat } = await import('@/lib/analisa/alat');
const q = await import('@/lib/dashboard/queries');
const { getOverduePOs } = await import('@/lib/purchase-orders/queries');
const { getMarketplaceKpi } = await import('@/lib/sales-orders/queries');

const sumber = {
  trenRentang: q.getTrenPenjualanRentang,
  salesman: q.getSalesmenSalesSummary,
  marketplaceHariIni: getMarketplaceKpi,
  async stok() {
    const [stats, campuran, oversold, bahanKurang] = await Promise.all([
      q.getDashboardStats(),
      q.getCOGSRawVsFinished(),
      q.getOversoldInventory(),
      q.getRawMaterialShortage(),
    ]);
    return {
      nilaiPersediaan: stats.inventory.totalValue,
      barangAktif: stats.items.activeCount,
      barangDiBawahMinimum: stats.items.lowStockCount,
      nilaiBahanBaku: campuran?.rawValue ?? null,
      nilaiBarangJadi: campuran?.finishedValue ?? null,
      skuTerjualMelebihiStok: oversold,
      bahanKurangUntukRencanaProduksi: bahanKurang,
      mataUang: 'IDR',
    };
  },
  async produksi() {
    const [perStatus, poTerlambat, stats] = await Promise.all([
      q.getWorkOrderCountByStatus(),
      getOverduePOs(),
      q.getDashboardStats(),
    ]);
    return {
      perintahKerjaPerStatus: perStatus,
      poLewatTanggalTiba: poTerlambat,
      poMenungguPersetujuan: stats.po.submitted,
      mataUang: 'IDR',
    };
  },
};

const server = new Server(
  { name: 'elorae-analisa', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'Data ERP Elorae (merek fesyen, Indonesia). Semua uang dalam Rupiah (IDR), semua tanggal hari kalender WIB. ' +
      'Alat hanya membaca. Piutang dan konsinyasi sengaja tidak tersedia. Sebut angka persis dari hasil alat; ' +
      'jangan mengarang angka yang tidak dikembalikan alat.',
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ALAT }));

server.setRequestHandler(CallToolRequestSchema, async (permintaan) => {
  try {
    const hasil = await jalankanAlat(permintaan.params.name, permintaan.params.arguments, sumber);
    const galat = typeof hasil === 'object' && hasil !== null && 'galat' in hasil;
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(hasil, null, 2) }],
      ...(galat ? { isError: true } : {}),
    };
  } catch (e) {
    console.error('[elorae-analisa]', e);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Gagal membaca data Elorae: ${e instanceof Error ? e.message : String(e)}. Pastikan basis data lokal menyala.`,
        },
      ],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
console.error('[elorae-analisa] siap');
