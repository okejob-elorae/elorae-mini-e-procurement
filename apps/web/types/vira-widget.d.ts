/** Host bridge the VIRA embed script reads from `window` (same-origin token only). */
interface ViraHostBridge {
  app: "elorae";
  runtimeUrl: string;
  locale: string;
  getToken(): Promise<{ token: string; expiresAt: string }>;
}

interface ViraWidgetApi {
  unmount?: () => void;
}

interface Window {
  ViraHost?: ViraHostBridge;
  ViraWidget?: ViraWidgetApi;
}
