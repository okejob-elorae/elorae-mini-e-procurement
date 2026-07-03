const TECHNICAL_ERROR_PATTERNS = [
  /prisma/i,
  /TURBOPACK/i,
  /invocation/i,
  /\.next[\\/]/,
  /P20\d{2}/,
  /SupplierTo\w+/,
];

export function toUserFacingError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const message = err.message.trim();
  if (!message) return fallback;
  if (TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) return fallback;
  if (message.length > 200 || message.includes('\n')) return fallback;
  return message;
}
