import { ConfigService } from "@nestjs/config";
import { JubelioConfig } from "./jubelio.config";
import { JubelioConfigError } from "./jubelio.types";

function configWith(env: Record<string, string | undefined>) {
  const service = {
    get: <T>(key: string) => env[key] as unknown as T,
  } as unknown as ConfigService;
  return new JubelioConfig(service);
}

describe("JubelioConfig.pickerEmail", () => {
  it("uses the explicit picker email when set", () => {
    const config = configWith({
      JUBELIO_USER: "integration@example.com",
      JUBELIO_PASS: "pw",
      JUBELIO_PICKER_EMAIL: "picker@example.com",
    });
    expect(config.pickerEmail).toBe("picker@example.com");
  });

  it("falls back to the integration account when the key is absent", () => {
    const config = configWith({
      JUBELIO_USER: "integration@example.com",
      JUBELIO_PASS: "pw",
    });
    expect(config.pickerEmail).toBe("integration@example.com");
  });

  /**
   * dotenv parses a bare `JUBELIO_PICKER_EMAIL=` as "", which is not undefined —
   * a `??` fallback would sail past it and post `picker_id: ""`, which Jubelio
   * rejects exactly like a missing field.
   */
  it.each(["", "   "])("falls back when the key is blank (%p)", (blank) => {
    const config = configWith({
      JUBELIO_USER: "integration@example.com",
      JUBELIO_PASS: "pw",
      JUBELIO_PICKER_EMAIL: blank,
    });
    expect(config.pickerEmail).toBe("integration@example.com");
  });

  it("trims a padded picker email", () => {
    const config = configWith({
      JUBELIO_USER: "integration@example.com",
      JUBELIO_PASS: "pw",
      JUBELIO_PICKER_EMAIL: "  picker@example.com  ",
    });
    expect(config.pickerEmail).toBe("picker@example.com");
  });

  it("throws the config error when neither is available", () => {
    const config = configWith({ JUBELIO_PASS: "pw" });
    expect(() => config.pickerEmail).toThrow(JubelioConfigError);
  });
});
