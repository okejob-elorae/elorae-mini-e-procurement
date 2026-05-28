import { createHmac } from "node:crypto";

export function computeSignature(
  method: string,
  path: string,
  userId: string,
  body: string,
  secret: string,
): string {
  const input = `${method.toUpperCase()}\n${path}\n${userId}\n${body}`;
  return createHmac("sha256", secret).update(input).digest("hex");
}
