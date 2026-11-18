import { describe, expect, it, vi } from 'vitest';

import { deviceTimeZone } from './device-zone';

describe('deviceTimeZone', () => {
  it.each(['Asia/Tokyo', 'America/New_York', 'Pacific/Auckland', 'UTC'])(
    '[IHM-14] reads %s on a device set to that zone',
    (zone) => {
      vi.stubEnv('TZ', zone);

      expect(deviceTimeZone()).toBe(zone);
    },
  );
});
