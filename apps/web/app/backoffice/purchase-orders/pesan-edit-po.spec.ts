import { describe, expect, it } from "vitest";
import { pesanTolakEditPo } from "./pesan-edit-po";

describe("pesanTolakEditPo", () => {
  it("PIN_DITOLAK → kunci security dari pemeriksa PIN, jendela PIN tetap terbuka", () => {
    expect(pesanTolakEditPo({ ok: false, code: "PIN_DITOLAK", kunciPesan: "pinIncorrect" }, "id")).toEqual({
      ruang: "security",
      kunci: "pinIncorrect",
      nilai: {},
      ulangiPin: true,
    });
    expect(pesanTolakEditPo({ ok: false, code: "PIN_DITOLAK", kunciPesan: " " }, "id").kunci).toBe("pinInvalid");
  });

  it("QTY_DI_BAWAH_DITERIMA → barang + qty diterima berformat; tidak mengulang PIN", () => {
    expect(
      pesanTolakEditPo({ ok: false, code: "QTY_DI_BAWAH_DITERIMA", barang: "Benang (BLK)", diterima: 1250.5 }, "id"),
    ).toEqual({
      ruang: "purchaseOrders",
      kunci: "edit.err.QTY_DI_BAWAH_DITERIMA",
      nilai: { barang: "Benang (BLK)", diterima: "1.250,5" },
      ulangiPin: false,
    });
  });

  it("PIN_WAJIB mengulang PIN; PO_TERTUTUP tidak", () => {
    expect(pesanTolakEditPo({ ok: false, code: "PIN_WAJIB" }, "id")).toMatchObject({
      kunci: "edit.err.PIN_WAJIB",
      ulangiPin: true,
    });
    expect(pesanTolakEditPo({ ok: false, code: "PO_TERTUTUP" }, "en")).toEqual({
      ruang: "purchaseOrders",
      kunci: "edit.err.PO_TERTUTUP",
      nilai: {},
      ulangiPin: false,
    });
  });
});
