function r2HostFromEnv(): string | null {
  const url = process.env.R2_PUBLIC_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const JUBELIO_HOSTS: ReadonlyArray<string> = [
  "static.jubelio.com",
  "cdn.jubelio.com",
  "jubelio-images.s3.amazonaws.com",
  "img.jubelio.com",
];

export function getR2Host(): string | null {
  return r2HostFromEnv();
}

export function getTrustedHosts(): ReadonlyArray<string> {
  const r2 = r2HostFromEnv();
  return r2 ? [r2, ...JUBELIO_HOSTS] : [...JUBELIO_HOSTS];
}

export function isTrustedHost(url: string): boolean {
  try {
    const u = new URL(url);
    return getTrustedHosts().some((host) => u.hostname === host || u.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}
