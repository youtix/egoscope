'use client';

import { useSyncExternalStore } from 'react';

/** Whether the device has a connection: the glossary's ConnectivityMode set (IHM-57, IHM-58). */
export type ConnectivityMode = 'online' | 'offline';

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener('online', onChange);
  globalThis.addEventListener('offline', onChange);
  return () => {
    globalThis.removeEventListener('online', onChange);
    globalThis.removeEventListener('offline', onChange);
  };
}

const deviceMode = (): ConnectivityMode => (navigator.onLine ? 'online' : 'offline');

// The server renders a page online, and the device corrects it as it hydrates.
const serverMode = (): ConnectivityMode => 'online';

/**
 * Whether the device is online or offline, as the browser says it, updated as the
 * connection comes and goes: offline, the app shows its copies under the offline banner
 * and disables what needs the server (IHM-57, IHM-58).
 */
export function useOnlineStatus(): ConnectivityMode {
  return useSyncExternalStore(subscribe, deviceMode, serverMode);
}
