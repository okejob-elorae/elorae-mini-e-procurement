import { Injectable, Logger } from "@nestjs/common";
import { JubelioHttpService } from "../http.service";

/**
 * Jubelio returns far more per location than we have any business handling —
 * full street address, contact phone, contact email, warehouse PIC email. Only
 * the identifying fields are mapped through, and the call is made with
 * `redactResponseBody` so the raw body never lands in `JubelioApiCall` either:
 * shaping this return value alone would NOT have stopped the logger, which
 * records the body before any mapping runs.
 *
 * `location_id` is typed `unknown` on purpose. The response is untrusted — the
 * spec contradicts itself on this field (`number` under `/locations/{id}`,
 * `string` under `/locations/bin/{location_id}`) — so it is validated per row
 * rather than cast, and a row without a usable id is dropped instead of
 * producing a location whose `id` is `undefined` behind a `number` type.
 */
type JubelioLocationRow = {
  location_id?: unknown;
  location_name?: string | null;
  location_code?: string | null;
  is_pos_outlet?: boolean | null;
  city?: string | null;
};

export type JubelioLocation = {
  id: number;
  name: string | null;
  code: string | null;
  isPosOutlet: boolean;
  city: string | null;
};

/* Jubelio documents 200 as the ceiling for pageSize. */
const PAGE_SIZE = 200;
const MAX_PAGES = 20;

@Injectable()
export class JubelioLocationsService {
  private readonly logger = new Logger(JubelioLocationsService.name);

  constructor(private readonly http: JubelioHttpService) {}

  /**
   * Read-through, no cache table. This exists because the WMS pushes need a real
   * `location_id` and nothing in the codebase had ever asked Jubelio for one —
   * the pick and ship handlers both hardcoded `1`, which does not exist on this
   * tenant and fails the picklist insert with a foreign-key violation.
   */
  async list(): Promise<{ locations: JubelioLocation[] }> {
    const rows: JubelioLocationRow[] = [];
    let expected: number | null = null;

    /**
     * Paginate rather than truncating at one page. A silently short list is the
     * worst possible failure for this endpoint: its whole job is to stop someone
     * guessing a location id, and an operator who cannot find the warehouse on
     * page 1 guesses exactly like before.
     */
    for (let page = 1; page <= MAX_PAGES; page++) {
      const raw = await this.http.get<unknown>("/locations/", {
        query: { page, pageSize: PAGE_SIZE },
        redactResponseBody: true,
      });
      const batch = this.extractRows(raw);
      rows.push(...batch);
      expected ??= this.extractTotal(raw);
      const done = batch.length < PAGE_SIZE || (expected !== null && rows.length >= expected);
      if (done) break;
      if (page === MAX_PAGES) {
        this.logger.warn(
          `Stopped after ${MAX_PAGES} pages of /locations/ with ${rows.length} rows; list may be incomplete`,
        );
      }
    }

    if (expected !== null && rows.length < expected) {
      this.logger.warn(
        `Jubelio reports ${expected} locations but only ${rows.length} were retrieved`,
      );
    }

    const locations: JubelioLocation[] = [];
    let dropped = 0;
    for (const r of rows) {
      const id = Number(r.location_id);
      if (!Number.isFinite(id)) {
        dropped++;
        continue;
      }
      locations.push({
        id,
        name: r.location_name ?? null,
        code: r.location_code ?? null,
        isPosOutlet: r.is_pos_outlet === true,
        city: r.city ?? null,
      });
    }
    if (dropped > 0) {
      this.logger.warn(`Dropped ${dropped} location row(s) with no usable location_id`);
    }

    this.logger.log(`Fetched ${locations.length} locations from Jubelio`);
    return { locations };
  }

  /** `totalCount` is the envelope's own count, used to detect a short read. */
  private extractTotal(raw: unknown): number | null {
    if (!raw || typeof raw !== "object") return null;
    const total = Number((raw as { totalCount?: unknown }).totalCount);
    return Number.isFinite(total) ? total : null;
  }

  /**
   * The spec documents a `{ data: [...] }` envelope, but it both lags and
   * misdescribes this API elsewhere, so a bare array is accepted too rather than
   * silently returning nothing if the shape differs from the document.
   */
  private extractRows(raw: unknown): JubelioLocationRow[] {
    if (Array.isArray(raw)) return raw as JubelioLocationRow[];
    if (raw && typeof raw === "object") {
      const data = (raw as { data?: unknown }).data;
      if (Array.isArray(data)) return data as JubelioLocationRow[];
    }
    this.logger.warn("Unexpected /locations/ response shape; treating as empty");
    return [];
  }
}
