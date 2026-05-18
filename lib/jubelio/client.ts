import type { JubelioItemsPayload } from './types';

const JUBELIO_API_BASE_URL = 'https://api2.jubelio.com';

export async function fetchJubelioItems(token: string): Promise<JubelioItemsPayload> {
  const response = await fetch(`${JUBELIO_API_BASE_URL}/inventory/items/`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Jubelio items fetch failed (${response.status}): ${body.slice(0, 200)}`);
  }

  return (await response.json()) as JubelioItemsPayload;
}

export async function fetchJubelioCatalogDescription(
  token: string,
  itemGroupId: number
): Promise<string | undefined> {
  const response = await fetch(`${JUBELIO_API_BASE_URL}/inventory/catalog/${itemGroupId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) return undefined;

  const data = (await response.json()) as { description?: string };
  return typeof data.description === 'string' ? data.description : undefined;
}
