import { describe, expect, it, vi } from 'vitest';

import { reloadPage } from './reload';

describe('reloadPage', () => {
  it('[IHM-03] reloads the page from the start', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });

    reloadPage();

    expect(reload).toHaveBeenCalledExactlyOnceWith();
  });
});
