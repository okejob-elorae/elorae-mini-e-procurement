# PWA landmines

The full entries behind the **PWA** triggers in `AGENTS.md` § Landmine index, in the same order. Each one was written after someone paid for it. Read the entry for whatever surface you are about to touch before writing code; where an entry points on to `docs/ARCHITECTURE-NOTES.md`, `docs/EPIC-STATUS.md` or `docs/FOLLOWUPS.md`, follow it. When a change makes an entry wrong, fix it here in the same session — and update its trigger in `AGENTS.md` if the trigger itself moved.

- Editing `apps/web/proxy.ts`? It IS the Next 16 middleware (renamed from `middleware.ts`), runs on every request, and gates `/pwa/*` — it is NOT dead code.
- Testing PWA offline behaviour, or chasing a 404 from the service worker? The Serwist SW only exists in a production build, and a committed `public/**/sw.js` / `workbox-*.js` poisons the precache manifest and kills SW install — never commit generated SW files.
