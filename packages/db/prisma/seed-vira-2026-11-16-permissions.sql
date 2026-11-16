-- Izin baru untuk asisten VIRA (adaptor MCP Elorae, fase 1 baca-saja) — MariaDB, produksi. Deploy
-- (.github/workflows/deploy.yml, job migrate) menjalankan berkas ini SEKALI secara otomatis pada push
-- ke master: sesudah migrasi, setiap seed-*.sql yang belum tercatat di tabel _seed_runs dijalankan lalu
-- dicatat. Tidak perlu dijalankan dengan tangan. Untuk basis data di luar alur deploy (lokal, staging
-- tanpa deploy.yml), jalankan:
--
--   mariadb --skip-ssl -u<user> -p <db> < seed-vira-2026-11-16-permissions.sql
--
-- Klien mariadb berhenti di galat pertama; jangan pakai --force.
--
--   vira:use — siapa yang boleh memakai asisten VIRA (meminta token di /api/vira/token dan memanggil
--              /api/vira/mcp). VIRA hanya membaca apa yang sudah boleh dibaca orang itu lewat izin
--              lainnya; izin ini tidak membuka data baru.
--
-- SENGAJA tanpa tautan RolePermission: tidak ada peran yang mendapat izin ini secara bawaan. Pemilik
-- memberikannya sendiri di Pengaturan → Peran & izin. Peran sistem (ADMIN) sudah lolos lewat wildcard
-- '*' yang diberikan di kode, jadi admin tetap bisa memakai VIRA tanpa tautan.
--
-- Idempoten: INSERT dijaga NOT EXISTS, jadi menjalankan ulang berkas ini tidak gagal dan tidak
-- menggandakan barisnya.

START TRANSACTION;

INSERT INTO `Permission` (`id`, `code`, `module`, `action`, `description`)
SELECT REPLACE(UUID(), '-', ''), 'vira:use', 'vira', 'use', 'Gunakan asisten VIRA'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'vira:use');

COMMIT;
