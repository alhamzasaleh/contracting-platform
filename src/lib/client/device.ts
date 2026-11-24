"use client";
import * as React from "react";

/** A short, human name for this device ("iPad Safari"), used to label passkeys and push devices. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Web";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return `${os} ${browser}`.trim();
}

const noop = () => () => undefined;

/** True when this browser can use passkeys (Face ID / Touch ID / fingerprint / Windows Hello). */
export function usePasskeySupport(): boolean {
  return React.useSyncExternalStore(noop, () => typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined", () => false);
}

/** "Face ID" on iPhone/iPad, "Touch ID" on Mac, otherwise "fingerprint". */
export function useBiometricKind(): "faceid" | "touchid" | "fingerprint" {
  return React.useSyncExternalStore(
    noop,
    () => {
      const ua = navigator.userAgent;
      if (/iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "faceid";
      if (/Macintosh/.test(ua)) return "touchid";
      return "fingerprint";
    },
    () => "fingerprint",
  );
}

/** This browser's push subscription, if any (never waits more than 2 s — sign-out must not hang). */
export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const lookup = navigator.serviceWorker
    .getRegistration()
    .then((reg) => reg?.pushManager?.getSubscription() ?? null)
    .catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
  return Promise.race([lookup, timeout]);
}
