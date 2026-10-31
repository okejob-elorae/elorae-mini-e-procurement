-- Elorae — penguncian akses PostgREST di Supabase.
-- Jalankan SETELAH schema.sql, di database Supabase yang sama.
--
-- Kenapa perlu: Supabase otomatis menerbitkan setiap tabel di schema `public`
-- sebagai REST API (PostgREST). Tanpa RLS, siapa pun yang memegang anon key —
-- dan anon key memang dirancang untuk ditempel di browser, jadi anggap publik —
-- bisa membaca dan menulis seluruh 102 tabel ERP ini lewat HTTPS.
--
-- Aplikasi Elorae tidak memakai PostgREST sama sekali; ia connect langsung ke
-- Postgres lewat Prisma sebagai role `postgres`, yang otomatis melewati RLS.
-- Jadi mengunci pintu REST tidak mengganggu aplikasi sedikit pun.
--
-- Skrip ini idempoten — aman dijalankan berulang kali.

-- 1. Nyalakan RLS di semua tabel schema public. Tanpa satu pun POLICY,
--    RLS aktif = tolak semua baris untuk role non-bypass (anon, authenticated).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS t
    FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE ' || r.t || ' ENABLE ROW LEVEL SECURITY';
  END LOOP;
END $$;

-- 2. Cabut hak akses langsung yang diberikan Supabase ke role publiknya.
--    Lapis kedua: kalau suatu saat ada POLICY yang tidak sengaja dibuat permisif,
--    tanpa GRANT tetap tidak bisa apa-apa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END $$;

-- 3. Verifikasi — harus mengembalikan 0 baris. Kalau ada isinya, tabel itu
--    masih terbuka lewat REST API.
SELECT tablename AS tabel_tanpa_rls
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity;
