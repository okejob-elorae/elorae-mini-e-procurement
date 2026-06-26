const ENV_R2_HOST = process.env.NEXT_PUBLIC_R2_PUBLIC_HOST;

const JUBELIO_HOSTS: ReadonlyArray<string> = [
  "static.jubelio.com",
  "cdn.jubelio.com",
  "jubelio-images.s3.amazonaws.com",
  "img.jubelio.com",
];

export function getTrustedHosts(): ReadonlyArray<string> {
  const r2 = ENV_R2_HOST ? [ENV_R2_HOST] : [];
  return [...r2, ...JUBELIO_HOSTS];
}

export function isTrustedHost(url: string): boolean {
  try {
    const u = new URL(url);
    return getTrustedHosts().some((host) => u.hostname === host || u.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
