// Provide a dummy DATABASE_URL so @elorae/db index.ts can be imported in tests
// without a real database connection. Tests mock the prisma client directly.
process.env["DATABASE_URL"] = "mysql://test:test@localhost:3306/test";
