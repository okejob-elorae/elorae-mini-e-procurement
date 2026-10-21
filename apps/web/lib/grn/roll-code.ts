export function fabricRollCode(docNumber: string, seq: number, total: number): string {
  const width = Math.max(2, String(total).length);
  return `${docNumber}-R${String(seq).padStart(width, "0")}`;
}
