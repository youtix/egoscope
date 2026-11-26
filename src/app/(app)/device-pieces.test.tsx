import { render, screen } from '@testing-library/react';
import { redirect } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';

import { requireSession } from '@/lib/auth';
import { logger } from '@/lib/log';
import { getParam } from '@/lib/params';
import { toEpochMs } from '@/lib/time';

import { DevicePieces } from './device-pieces';

import type { ReactNode } from 'react';

vi.mock(import('@/lib/auth'), () => ({ requireSession: vi.fn() }));
const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock(import('@/lib/db'), () => ({ getDb }));
vi.mock(import('@/lib/log'), () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock(import('@/lib/params'), () => ({ getParam: vi.fn() }));
// The pieces themselves, which run in the browser, as the zone reaches them.
vi.mock(import('@/lib/offline'), () => ({
  DeviceShell: ({ timeZone }: Readonly<{ timeZone: string }>): ReactNode => (
    <p>The device pieces, in {timeZone}</p>
  ),
}));

// The connection that the session check opened, which the pieces reuse.
const DB = Object.freeze({ kind: 'the connection of the request' });

/** A device with an open session. */
function signedIn(): void {
  vi.mocked(requireSession).mockResolvedValue({
    ok: true,
    value: {
      id: 4,
      device: 'Phone',
      openedAt: toEpochMs(Date.UTC(2026, 10, 23, 9)),
      passwordStatus: 'chosen',
    },
  });
  getDb.mockResolvedValue({ ok: true, db: DB });
}

/** What the layout shows of the pieces. */
async function shown(): Promise<HTMLElement> {
  return render(<>{await DevicePieces()}</>).container;
}

describe('DevicePieces', () => {
  it('[IHM-57] [CL-IHM-04] gives the device pieces of a signed-in owner the zone of the display.timeZone setting', async () => {
    signedIn();
    vi.mocked(getParam).mockResolvedValue('America/New_York');

    await shown();

    expect(screen.getByText('The device pieces, in America/New_York')).toBeInTheDocument();
    expect(getParam).toHaveBeenCalledExactlyOnceWith(DB, 'display.timeZone');
    expect(requireSession).toHaveBeenCalledWith('/');
  });

  it('[CL-TRV-13] leaves the pieces out of a request without an open session, and asks nothing of the database', async () => {
    vi.mocked(requireSession).mockResolvedValue({
      ok: false,
      error: { kind: 'log-in', redirect: '/log-in?next=%2F', ended: null },
    });

    expect(await shown()).toBeEmptyDOMElement();
    expect(getDb).not.toHaveBeenCalled();
  });

  it('leaves the pieces out when the database is not configured, the screen answering for itself', async () => {
    signedIn();
    getDb.mockResolvedValue({ ok: false, error: { kind: 'not-configured' } });

    expect(await shown()).toBeEmptyDOMElement();
    expect(getParam).not.toHaveBeenCalled();
  });

  it('leaves the pieces out, and logs why, when the zone cannot be read', async () => {
    signedIn();
    const failure = new Error('Connection terminated unexpectedly');
    vi.mocked(getParam).mockRejectedValue(failure);

    expect(await shown()).toBeEmptyDOMElement();
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'The device pieces are left out, since the time zone could not be read.',
      { error: failure },
    );
  });

  it('leaves to Next.js the errors through which it controls a request', async () => {
    vi.mocked(requireSession).mockImplementation(() => {
      redirect('/settings');
    });

    await expect(DevicePieces()).rejects.toThrow('NEXT_REDIRECT');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
