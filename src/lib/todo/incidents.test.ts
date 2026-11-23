import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { createTestDatabase } from '@/lib/db';
import { listOpen } from '@/lib/incidents';
import { toEpochMs } from '@/lib/time';

import { incidentsSection } from './incidents';

vi.mock(import('@/lib/incidents'), () => ({ listOpen: vi.fn() }));

describe('the incidents section of the to-do list', { timeout: 60_000 }, () => {
  it('[IHM-20] refuses loudly an incident of a kind that has no consequence written', async () => {
    const database = await createTestDatabase();
    onTestFinished(database.close);
    vi.mocked(listOpen).mockResolvedValue([
      {
        id: 1,
        // @ts-expect-error -- a kind that the closed list does not hold, which only a bug could read
        kind: 'unwritten_kind',
        causeKey: '',
        serviceRole: null,
        quotaCauses: [],
        waitingArticles: null,
        openedAt: toEpochMs(0),
        hiddenAt: null,
      },
    ]);

    await expect(incidentsSection(database.db, 2)).rejects.toThrow(
      'No consequence is written for the incident kind unwritten_kind.',
    );
  });
});
