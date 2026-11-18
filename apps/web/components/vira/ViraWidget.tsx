"use client";

import { useEffect } from "react";

/** Guard id so Soft Navigations / remounts never inject a second widget script. */
export const VIRA_SCRIPT_ID = "vira-widget-script";

export type ViraTokenResponse = { token: string; expiresAt: string };

/** Same-origin mint; never persist the token in storage. */
export async function fetchViraToken(): Promise<ViraTokenResponse> {
  const r = await fetch("/api/vira/token", { method: "POST", credentials: "same-origin" });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()) as ViraTokenResponse;
}

export function installViraHost(runtimeUrl: string): void {
  window.ViraHost = {
    app: "elorae",
    runtimeUrl,
    locale: "id",
    getToken: fetchViraToken,
  };
  window.dispatchEvent(new Event("vira:host-ready"));
}

/** Append the widget script once. Safe to call again after a Soft Navigation remount. */
export function appendViraScriptOnce(widgetUrl: string): void {
  if (document.getElementById(VIRA_SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = VIRA_SCRIPT_ID;
  script.src = widgetUrl;
  script.async = true;
  document.body.appendChild(script);
}

/**
 * Hides the widget and withdraws the token bridge, but KEEPS the script tag. Removing a
 * <script> does not stop one that is already downloading, so removing and re-adding it
 * (React Strict Mode, leaving and re-entering the back office) would run the bundle twice.
 * The bundle boots once per page and mounts again on the next `vira:host-ready`, which
 * `installViraHost` dispatches on every re-entry.
 */
export function teardownViraWidget(): void {
  window.ViraWidget?.unmount?.();
  delete window.ViraHost;
}

type Props = {
  enabled: boolean;
};

/**
 * Embeds the VIRA chat widget on back-office pages. Loads a script tag (not
 * next/script) so `window.ViraHost` is defined before the widget runs.
 * Renders no DOM of its own — the script paints the UI.
 */
export function ViraWidget({ enabled }: Props) {
  const widgetUrl = process.env.NEXT_PUBLIC_VIRA_WIDGET_URL ?? "";
  const runtimeUrl = process.env.NEXT_PUBLIC_VIRA_RUNTIME_URL ?? "";
  const active = Boolean(enabled && widgetUrl && runtimeUrl);

  useEffect(() => {
    if (!active) return;

    installViraHost(runtimeUrl);
    appendViraScriptOnce(widgetUrl);

    return () => {
      teardownViraWidget();
    };
  }, [active, widgetUrl, runtimeUrl]);

  return null;
}
