// Provide a dummy DATABASE_URL so @elorae/db index.ts can be imported in tests
// without a real database connection. Tests mock the prisma client directly.
// Port 1 = tidak ada yang mendengar. JANGAN 3306: di laptop itu tunnel SSH ke
// MariaDB PRODUKSI, jadi spec yang tak sengaja memakai Prisma sungguhan akan
// menyentuh data asli.
process.env["DATABASE_URL"] = "mysql://test:test@127.0.0.1:1/test";
