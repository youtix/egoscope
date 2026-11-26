import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useOnlineStatus } from './online-status';

import type { ReactNode } from 'react';

/** A screen that writes the mode that the hook gives. */
function Mode(): ReactNode {
  return useOnlineStatus();
}

describe('useOnlineStatus', () => {
  it('[IHM-57] [IHM-58] says whether the device is online, and follows the connection as it goes and returns', () => {
    const isOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const view = renderHook(() => useOnlineStatus());

    expect(view.result.current).toBe('offline');

    isOnline.mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });

    expect(view.result.current).toBe('online');

    isOnline.mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });

    expect(view.result.current).toBe('offline');
  });

  it('renders online on the server, which knows nothing of the device, and lets the device correct it', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    expect(renderToString(<Mode />)).toBe('online');
  });

  it('stops following the connection once the page no longer shows it', () => {
    const isOnline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const view = renderHook(() => useOnlineStatus());
    view.unmount();
    isOnline.mockClear();

    globalThis.dispatchEvent(new Event('offline'));
    globalThis.dispatchEvent(new Event('online'));

    expect(isOnline).not.toHaveBeenCalled();
  });
});
