import { render, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { EraseDeviceData } from './erase-device-data';

describe('EraseDeviceData', () => {
  it('[IHM-08] [DSN-33] erases the data of the device as the login page shows, and shows nothing', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const wasCacheDeleted = vi.fn<(name: string) => Promise<boolean>>().mockResolvedValue(true);
    vi.stubGlobal('caches', { delete: wasCacheDeleted });
    localStorage.setItem('egoscope.last-screen', '{"path":"/players/7","scrollY":640}');

    const { container } = render(<EraseDeviceData />);

    expect(container).toBeEmptyDOMElement();
    expect(wasCacheDeleted).toHaveBeenCalledExactlyOnceWith('egoscope-screens');
    await waitFor(() => {
      expect(localStorage).toHaveLength(0);
    });
  });
});
