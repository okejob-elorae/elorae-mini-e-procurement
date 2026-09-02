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

  function recorded() {
    return apiLog.record.mock.calls[0][0];
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
  });

  afterEach(() => {
    fetchMock.mockRestore();
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

  it("withholds the body on the error path too", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PII_BODY, 500));

    await expect(http.get("/locations/", { redactResponseBody: true })).rejects.toThrow();

    const body = recorded().responseBody as string;
    expect(body).not.toContain("kutabumi.warehouse@example.com");
    expect(body).toMatch(/redacted/i);
  });

  it("still records the path, status and latency when redacting", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PII_BODY));

    await http.get("/locations/", { redactResponseBody: true });

    expect(recorded()).toMatchObject({ method: "GET", path: "/locations/", statusCode: 200, ok: true });
  });
});
