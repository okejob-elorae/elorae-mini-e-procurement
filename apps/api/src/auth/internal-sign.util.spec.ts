import { computeSignature } from "./internal-sign.util";

describe("computeSignature", () => {
  const secret = "test-secret-xyz";

  it("produces a 64-char lowercase hex string for HMAC-SHA256", () => {
    const sig = computeSignature("POST", "/test", "user_1", "{}", secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hex for identical inputs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/test", "user_1", "{}", secret);
    expect(a).toBe(b);
  });

  it("changes when the method differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("GET", "/test", "user_1", "{}", secret);
    expect(a).not.toBe(b);
  });

  it("changes when the path differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/other", "user_1", "{}", secret);
    expect(a).not.toBe(b);
  });

  it("changes when the userId differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/test", "user_2", "{}", secret);
    expect(a).not.toBe(b);
  });

  it("changes when the body differs", () => {
    const a = computeSignature("POST", "/test", "user_1", "{}", secret);
    const b = computeSignature("POST", "/test", "user_1", `{"a":1}`, secret);
    expect(a).not.toBe(b);
  });

  it("accepts empty string for userId (system flow)", () => {
    const sig = computeSignature("GET", "/health-detail", "", "", secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uppercases the method before hashing (case-insensitive method)", () => {
    const a = computeSignature("post", "/test", "u", "", secret);
    const b = computeSignature("POST", "/test", "u", "", secret);
    expect(a).toBe(b);
  });

  it("matches a known fixture (regression guard against silent format drift)", () => {
    const sig = computeSignature(
      "POST",
      "/jubelio/outbox/enqueue/abc123",
      "user_admin_123",
      "",
      "test-secret-xyz",
    );
    // Computed with: printf "%b" "POST\n/jubelio/outbox/enqueue/abc123\nuser_admin_123\n" | openssl dgst -sha256 -hmac "test-secret-xyz" -hex
    // Input format: METHOD\nPATH\nUSER_ID\nBODY — separators are literal newlines.
    // Do not change without bumping the protocol.
    expect(sig).toBe(
      "a099c09a6823e59a71c3eeaa82d23e0c7c1d52540617355958847dbeb2e9b695",
    );
  });
});
