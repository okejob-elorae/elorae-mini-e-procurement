import {
  getValidJubelioToken,
  isJubelioAuthFailureStatus,
  JUBELIO_API_BASE_URL,
  refreshJubelioToken,
} from './auth';
import type { JubelioItemsPayload } from './types';

type FetchWithTokenOptions = {
  token: string;
  retried?: boolean;
};

async function fetchWithBearer(
  url: string,
  { token, retried = false }: FetchWithTokenOptions
): Promise<Response> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!isJubelioAuthFailureStatus(response.status) || retried) {
    return response;
  }

  const newToken = await refreshJubelioToken();
  return fetchWithBearer(url, { token: newToken, retried: true });
}

export async function fetchJubelioItems(token?: string): Promise<JubelioItemsPayload> {
  const bearer = token ?? (await getValidJubelioToken());
  const response = await fetchWithBearer(`${JUBELIO_API_BASE_URL}/inventory/items/`, {
    token: bearer,
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
  const response = await fetchWithBearer(
    `${JUBELIO_API_BASE_URL}/inventory/catalog/${itemGroupId}`,
    { token }
  );

  if (!response.ok) return undefined;

  const data = (await response.json()) as { description?: string };
  return typeof data.description === 'string' ? data.description : undefined;
}
