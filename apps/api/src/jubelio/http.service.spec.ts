import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JubelioHttpService } from "./http.service";
import { JubelioConfig } from "./jubelio.config";
import { JubelioTokenService } from "./token.service";
import { JubelioApiCallLogger } from "./api-call-logger.service";

const PII_BODY = {
  data: [
    {
      location_id: 3,
      location_name: "Kutabumi",
      address: "Jl. Raya Kutabumi Ruko Pondok Permai blok CA 1 no 6",
      phone: "215442490",
      email: "kutabumi.warehouse@example.com",
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("JubelioHttpService call-log redaction", () => {
  let http: JubelioHttpService;
  let apiLog: { record: jest.Mock };
  let fetchMock: jest.SpyInstance;
  let errorLog: jest.SpyInstance;

  function recorded() {
    return apiLog.record.mock.calls[0][0];
  }

  /* Everything the service emitted through the Nest logger, joined. */
  function logged() {
    return errorLog.mock.calls.map((c) => String(c[0])).join("\n");
  }

  beforeEach(async () => {
    apiLog = { record: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        JubelioHttpService,
        { provide: JubelioConfig, useValue: { baseUrl: "https://api.example.com" } },
        { provide: JubelioTokenService, useValue: { getToken: async () => "t", invalidate: jest.fn() } },
        { provide: JubelioApiCallLogger, useValue: apiLog },
      ],
    }).compile();
    http = mod.get(JubelioHttpService);
    fetchMock = jest.spyOn(global, "fetch");
    errorLog = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    errorLog.mockRestore();
  });

  it("logs the raw response body by default, which is what makes debugging possible", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await http.get("/wms/couriers");

    expect(recorded().responseBody).toBe(JSON.stringify({ ok: true }));
  });

  /**
   * The logger records the raw body BEFORE any caller-side mapping runs, so a
   * service that shapes contact details out of its own return value does not
   * stop them being persisted to JubelioApiCall. This flag is what does.
   */
  it("withholds the body when redactResponseBody is set, keeping no PII", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PII_BODY));

    await http.get("/locations/", { redactResponseBody: true });

    const body = recorded().responseBody as string;
    expect(body).not.toContain("kutabumi.warehouse@example.com");
    expect(body).not.toContain("215442490");
    expect(body).not.toContain("Jl. Raya Kutabumi");
    expect(body).toMatch(/redacted/i);
  });

  it("withholds the body from the call log on the error path too", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PII_BODY, 500));

    await expect(http.get("/locations/", { redactResponseBody: true })).rejects.toThrow();

    const body = recorded().responseBody as string;
    expect(body).not.toContain("kutabumi.warehouse@example.com");
    expect(body).toMatch(/redacted/i);
  });

  /**
   * There are TWO sinks, not one. The failure path also writes the body straight
   * to the Nest logger, which on prod is the container's stdout — redacting only
   * the JubelioApiCall row leaves the address, phone and email in the logs, which
   * is exactly what the first version of this did.
   */
  it("withholds the body from the Nest error log, not just the call log", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PII_BODY, 500));

    await expect(http.get("/locations/", { redactResponseBody: true })).rejects.toThrow();

    const out = logged();
    expect(out).toContain("/locations/");
    expect(out).not.toContain("kutabumi.warehouse@example.com");
    expect(out).not.toContain("215442490");
    expect(out).not.toContain("Jl. Raya Kutabumi");
  });

  it("still logs the raw body on failure when not redacting, for debugging", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ statusCode: 500, code: "23503" }, 500));

    await expect(http.get("/wms/sales/picklists/")).rejects.toThrow();

    expect(logged()).toContain("23503");
  });

  it("still records the path, status and latency when redacting", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PII_BODY));

    await http.get("/locations/", { redactResponseBody: true });

    expect(recorded()).toMatchObject({ method: "GET", path: "/locations/", statusCode: 200, ok: true });
  });
});
