import type { Locale as DateFnsLocale } from "date-fns";
import { id as idLocale } from "date-fns/locale/id";

/**
 * The date-fns locale for an app locale. English is date-fns's own default, so it maps to
 * `undefined` rather than importing a second locale into the client bundle.
 */
export function getDateFnsLocale(appLocale: string): DateFnsLocale | undefined {
  return appLocale === "id" ? idLocale : undefined;
}
