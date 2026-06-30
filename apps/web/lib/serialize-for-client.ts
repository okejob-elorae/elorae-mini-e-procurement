function isDecimalLike(value: unknown): value is { toNumber: () => number } {
  return (
    value != null &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber: unknown }).toNumber === "function"
  );
}

/**
 * Deep-clone Prisma rows for Server Actions / RSC → Client boundaries.
 * Converts Decimal → number and Date → ISO string at every nesting level.
 */
export function serializeForClient<T>(value: T): T {
  if (value instanceof Date) {
    return value.toISOString() as T;
  }
  if (isDecimalLike(value)) {
    return value.toNumber() as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => serializeForClient(entry)) as T;
  }
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = serializeForClient(entry);
    }
    return out as T;
  }
  return value;
}
