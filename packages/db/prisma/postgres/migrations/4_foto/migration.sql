-- Photos, stored in the database rather than object storage.
--
-- The brief this module ports designs a `foto` table and an /api/foto/[id]
-- route, and its closing constraint is that no photo leaves the machine the
-- program runs on. Following that keeps the feature working wherever the
-- database is, with no second system to configure.
--
-- The existing photoUrl / transferPhotoUrl / breakdownPhotoUrl columns are NOT
-- changed: they keep holding a URL, which is now either an object-storage URL
-- or "/api/foto/<id>". One column, either backend, no branching at the call site.
--
-- Re-runnable: every statement is guarded.

CREATE TABLE IF NOT EXISTS "Foto" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Foto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Foto_uploadedById_idx" ON "Foto"("uploadedById");
CREATE INDEX IF NOT EXISTS "Foto_createdAt_idx" ON "Foto"("createdAt");
