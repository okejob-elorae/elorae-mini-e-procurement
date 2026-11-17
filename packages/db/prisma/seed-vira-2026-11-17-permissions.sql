-- Izin baru untuk asisten VIRA (adaptor MCP Elorae, fase 2 tulis dengan konfirmasi) — MariaDB, produksi. Deploy
-- (.github/workflows/deploy.yml, job migrate) menjalankan berkas ini SEKALI secara otomatis pada push
-- ke master: sesudah migrasi, setiap seed-*.sql yang belum tercatat di tabel _seed_runs dijalankan lalu
-- dicatat. Tidak perlu dijalankan dengan tangan. Untuk basis data di luar alur deploy (lokal, staging
-- tanpa deploy.yml), jalankan:
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-vira-2026-11-17-permissions.sql
--
-- Klien mariadb berhenti di galat pertama; jangan pakai --force.
--
--   vira:write — siapa yang boleh menerapkan perubahan lewat asisten VIRA (setelah menekan konfirmasi
--                di chat). Tanpa izin ini, alat tulis tidak muncul di tools/list. Masih membutuhkan
--                vira:use dan izin domain dari tiap alat.
--
-- SENGAJA tanpa tautan RolePermission: tidak ada peran yang mendapat izin ini secara bawaan. Pemilik
-- memberikannya sendiri di Pengaturan → Peran & izin. Peran sistem (ADMIN) sudah lolos lewat wildcard
-- '*' yang diberikan di kode, jadi admin tetap bisa memakai VIRA tanpa tautan.
--
-- Idempoten: INSERT dijaga NOT EXISTS, jadi menjalankan ulang berkas ini tidak gagal dan tidak
-- menggandakan barisnya.

START TRANSACTION;

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'vira:write', 'vira', 'write', 'Terapkan perubahan lewat asisten VIRA'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'vira:write');

COMMIT;
