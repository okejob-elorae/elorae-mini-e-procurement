-- Izin baru dari jawaban pemilik putaran 4 (2026-11-02 malam, P22–P88) — MariaDB, produksi. Deploy
-- hanya memigrasi dan tidak pernah menyeed, jadi berkas ini dijalankan dengan tangan sesudah image web
-- yang membawa izin ini hidup, sesudah seed-owner-2026-11-02-permissions.sql, dan SEBELUM
-- seed-office-roles-permissions.sql — pemeriksaan awal berkas itu menuntut lima izin dari berkas ini
-- (deliveries:cancel_nota, receivables:overdue_reminder, spg_attendance:record, spg_attendance:verify,
-- dan spg_commission:pay yang sudah ada) dan berhenti dengan ERROR 1242 sebelum menulis apa pun.
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-owner-2026-11-02b-permissions.sql
--
-- Klien mariadb berhenti di galat pertama; jangan pakai --force.
--
-- Izin persetujuan (bawaannya hanya admin; pemilik memberikannya sendiri di Peran & izin):
--   store_returns:decide_shortfall — siapa menanggung selisih retur toko. Dipecah dari
--                                    receivables:decide_bearer (P22), yang kini hanya barang hilang
--                                    (di toko SPG maupun di perjalanan pengiriman).
--   vendor_bills:decide_price      — memutuskan selisih harga invoice pemasok vs utang tercatat (P27, P53).
--   goods_receipts:confirm_no_po   — mengonfirmasi atau menolak penerimaan barang tanpa PO (P51a).
--   spg_schedules:approve          — menyetujui, menolak, atau membuka lagi jadwal bulanan SPG (P7c).
-- Izin kerja kantor dengan peran bawaan yang diputuskan pemilik:
--   deliveries:cancel_nota         — tidak jadi dikirim untuk pengiriman putus yang sudah bernota;
--                                    bawaannya ADMIN_PENJUALAN (P41a, tanpa persetujuan orang kedua).
--   receivables:overdue_reminder   — MENERIMA pengingat jatuh tempo kantor; bawaannya KEUANGAN (P48).
--   spg_attendance:record          — memasukkan catatan check-in toko SPG; bawaannya ADMIN_PENJUALAN (P7e).
--   spg_attendance:verify          — memeriksa catatan itu; bawaannya KEUANGAN (P61a).
-- Dan satu tautan izin LAMA: KEUANGAN → spg_commission:pay (Q9; Keuangan membuka halaman Komisi SPG
-- saja dengan izin ini, tanpa spg_sales:view, P28).
--
-- ADMIN sudah lolos setiap pemeriksaan lewat wildcard '*' yang diberikan di kode; tautan ADMIN di bawah
-- ditulis supaya sama dengan seed.ts. Sampai baris Permission ada, getUsersWithPermission hanya
-- menemukan admin sistem, jadi lonceng kategori baru tetap sampai ke admin.
--
-- Sengaja berkas sendiri, BUKAN tambahan seed-max-features-permissions.sql atau
-- seed-owner-2026-11-02-permissions.sql: keduanya dijalankan sekali, dan menjalankannya ulang
-- memberikan lagi tautan turunan yang mungkin sudah dicabut pemilik di Peran & izin.
--
-- Idempoten: setiap INSERT dijaga NOT EXISTS. Setiap tautan bawaan untuk peran yang SUDAH ADA (dan
-- pewarisan selisih retur) hanya ditulis pada run yang MEMBUAT baris izinnya — penandanya ditangkap
-- sebelum INSERT, seperti pewarisan payments:verify — jadi menjalankan ulang berkas ini tidak pernah
-- mengembalikan izin yang sudah dicabut pemilik. Kalau KEUANGAN atau ADMIN_PENJUALAN belum ada saat
-- itu, seed-office-roles-permissions.sql yang memberikannya saat membuat peran itu.
--
-- Pewarisan (P22, "setiap pemegang izin lama tetap memegang keduanya"): setiap peran yang memegang
-- receivables:decide_bearer pada run yang membuat store_returns:decide_shortfall ikut mendapat izin
-- baru itu, supaya tidak ada yang kehilangan keputusan selisih retur saat izinnya dipecah.

START TRANSACTION;

-- Ditangkap SEBELUM barisnya dibuat: tautan bawaan dan pewarisan hanya ditulis pada run yang membuatnya.
SET @cancel_nota_is_new = (SELECT COUNT(*) FROM `Permission` WHERE `code` = 'deliveries:cancel_nota') = 0;
SET @overdue_reminder_is_new = (SELECT COUNT(*) FROM `Permission` WHERE `code` = 'receivables:overdue_reminder') = 0;
SET @return_shortfall_is_new = (SELECT COUNT(*) FROM `Permission` WHERE `code` = 'store_returns:decide_shortfall') = 0;
SET @spg_schedules_approve_is_new = (SELECT COUNT(*) FROM `Permission` WHERE `code` = 'spg_schedules:approve') = 0;
SET @attendance_record_is_new = (SELECT COUNT(*) FROM `Permission` WHERE `code` = 'spg_attendance:record') = 0;
SET @attendance_verify_is_new = (SELECT COUNT(*) FROM `Permission` WHERE `code` = 'spg_attendance:verify') = 0;

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'deliveries:cancel_nota', 'deliveries', 'cancel_nota',
       'Cancel a putus shipment whose billing note is already issued: the note, its receivable and tax invoice are voided and Finance is notified'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'deliveries:cancel_nota');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'receivables:overdue_reminder', 'receivables', 'overdue_reminder',
       'Receive the office reminder when a store invoice passes an overdue threshold (receiving only)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'receivables:overdue_reminder');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'store_returns:decide_shortfall', 'store_returns', 'decide_shortfall',
       'Decide or reassign who bears a store-return shortfall (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'store_returns:decide_shortfall');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'vendor_bills:decide_price', 'vendor_bills', 'decide_price',
       'Decide a supplier invoice whose price differs from the recorded payable: accept it or correct the invoice (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'vendor_bills:decide_price');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'goods_receipts:confirm_no_po', 'goods_receipts', 'confirm_no_po',
       'Confirm or decline a goods receipt recorded without a PO before it is processed (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'goods_receipts:confirm_no_po');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'spg_schedules:approve', 'spg_schedules', 'approve',
       'Approve, reject or reopen an SPG''s monthly work schedule (manager decision)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'spg_schedules:approve');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'spg_attendance:record', 'spg_attendance', 'record',
       'Enter an SPG''s store check-in record for a month, typed or from an Excel file'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'spg_attendance:record');

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'spg_attendance:verify', 'spg_attendance', 'verify',
       'Check an SPG store check-in record entered by someone else against the original'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'spg_attendance:verify');

-- ADMIN mendapat kedelapan baris secara eksplisit, sama dengan seed.ts (tanpa pengaruh: ADMIN lolos lewat '*').
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN'
  AND p.`code` IN ('deliveries:cancel_nota', 'receivables:overdue_reminder', 'store_returns:decide_shortfall',
                   'vendor_bills:decide_price', 'goods_receipts:confirm_no_po', 'spg_schedules:approve',
                   'spg_attendance:record', 'spg_attendance:verify')
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Bawaan pemilik, SEKALI (P41a): ADMIN_PENJUALAN yang sudah ada membatalkan pengiriman yang sudah bernota.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN_PENJUALAN'
  AND p.`code` = 'deliveries:cancel_nota'
  AND @cancel_nota_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Bawaan pemilik, SEKALI (P7e): ADMIN_PENJUALAN yang sudah ada memasukkan catatan check-in toko SPG.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'ADMIN_PENJUALAN'
  AND p.`code` = 'spg_attendance:record'
  AND @attendance_record_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Bawaan pemilik, SEKALI (P48): KEUANGAN yang sudah ada menerima pengingat jatuh tempo kantor.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'KEUANGAN'
  AND p.`code` = 'receivables:overdue_reminder'
  AND @overdue_reminder_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Bawaan pemilik, SEKALI (P61a): KEUANGAN yang sudah ada memeriksa catatan check-in toko SPG.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'KEUANGAN'
  AND p.`code` = 'spg_attendance:verify'
  AND @attendance_verify_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Bawaan pemilik, SEKALI (Q9 + P28): KEUANGAN yang sudah ada menandai gaji & komisi SPG dibayar. Izinnya
-- sudah ada sejak 2026-11-01, jadi penandanya run yang membuat spg_schedules:approve (berkas ini).
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), r.`id`, p.`id`
FROM `RoleDefinition` r
CROSS JOIN `Permission` p
WHERE r.`name` = 'KEUANGAN'
  AND p.`code` = 'spg_commission:pay'
  AND @spg_schedules_approve_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = r.`id` AND rp.`permissionId` = p.`id`
  );

-- Pewarisan, SEKALI (P22): setiap pemegang receivables:decide_bearer tetap memutuskan selisih retur toko.
INSERT INTO `RolePermission` (`id`, `roleId`, `permissionId`)
SELECT REPLACE(UUID(), '-', ''), rp_ada.`roleId`, p.`id`
FROM `RolePermission` rp_ada
JOIN `Permission` p_ada ON p_ada.`id` = rp_ada.`permissionId` AND p_ada.`code` = 'receivables:decide_bearer'
CROSS JOIN `Permission` p
WHERE p.`code` = 'store_returns:decide_shortfall'
  AND @return_shortfall_is_new = 1
  AND NOT EXISTS (
    SELECT 1 FROM `RolePermission` rp
    WHERE rp.`roleId` = rp_ada.`roleId` AND rp.`permissionId` = p.`id`
  );

-- Keterangan bahasa Inggris receivables:decide_bearer menyempit ke barang hilang — hanya bila masih
-- teks lama dari seed-max-features-permissions.sql (layar Peran & izin memakai terjemahannya sendiri).
UPDATE `Permission`
SET `description` = 'Decide, change or cancel who bears lost goods, at an SPG store or in transit (manager decision)'
WHERE `code` = 'receivables:decide_bearer'
  AND `description` = 'Decide, reassign or cancel who bears a store-return shortfall or lost SPG goods (manager decision)';

-- Pengguna yang sudah masuk dengan peran yang mendapat tautan baru menerima izinnya tanpa keluar
-- (lib/auth.ts membandingkan versinya).
UPDATE `RoleDefinition`
SET `permissionsVersion` = `permissionsVersion` + 1
WHERE (`name` = 'ADMIN_PENJUALAN' AND (@cancel_nota_is_new = 1 OR @attendance_record_is_new = 1))
   OR (`name` = 'KEUANGAN' AND (@overdue_reminder_is_new = 1 OR @attendance_verify_is_new = 1 OR @spg_schedules_approve_is_new = 1))
   OR (
     @return_shortfall_is_new = 1
     AND `id` IN (
       SELECT rp.`roleId` FROM `RolePermission` rp
       JOIN `Permission` p ON p.`id` = rp.`permissionId`
       WHERE p.`code` = 'store_returns:decide_shortfall'
     )
   );

COMMIT;

-- Cek: delapan baris.
SELECT `code`, `description` FROM `Permission`
WHERE `code` IN ('deliveries:cancel_nota', 'receivables:overdue_reminder', 'store_returns:decide_shortfall',
                 'vendor_bills:decide_price', 'goods_receipts:confirm_no_po', 'spg_schedules:approve',
                 'spg_attendance:record', 'spg_attendance:verify')
ORDER BY `code`;

-- Cek: peran yang memegang izin baru ini (dan spg_commission:pay). Bawaannya ADMIN untuk semuanya,
-- ADMIN_PENJUALAN untuk deliveries:cancel_nota dan spg_attendance:record, KEUANGAN untuk
-- receivables:overdue_reminder, spg_attendance:verify, dan spg_commission:pay, ditambah setiap pemegang
-- receivables:decide_bearer untuk store_returns:decide_shortfall.
SELECT r.`name` AS `role`, p.`code` AS `code`
FROM `RoleDefinition` r
JOIN `RolePermission` rp ON rp.`roleId` = r.`id`
JOIN `Permission` p ON p.`id` = rp.`permissionId`
WHERE p.`code` IN ('deliveries:cancel_nota', 'receivables:overdue_reminder', 'store_returns:decide_shortfall',
                   'vendor_bills:decide_price', 'goods_receipts:confirm_no_po', 'spg_schedules:approve',
                   'spg_attendance:record', 'spg_attendance:verify', 'spg_commission:pay')
ORDER BY p.`code`, r.`name`;

-- Cek: pemegang receivables:decide_bearer yang BELUM memegang store_returns:decide_shortfall. Kosong
-- sesudah run pertama; baris yang muncul kemudian berarti pemilik sengaja memisahkannya di Peran & izin.
SELECT r.`name` AS `role`
FROM `RoleDefinition` r
JOIN `RolePermission` rp ON rp.`roleId` = r.`id`
JOIN `Permission` p ON p.`id` = rp.`permissionId` AND p.`code` = 'receivables:decide_bearer'
WHERE NOT EXISTS (
  SELECT 1 FROM `RolePermission` rp2
  JOIN `Permission` p2 ON p2.`id` = rp2.`permissionId` AND p2.`code` = 'store_returns:decide_shortfall'
  WHERE rp2.`roleId` = r.`id`
)
ORDER BY r.`name`;
