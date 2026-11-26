import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import axe from 'axe-core';
import { IDBFactory } from 'fake-indexeddb';
import fc from 'fast-check';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { checkPastedTextSize } from '@/lib/ai-exchange';
import { draftKey } from '@/lib/device-drafts';
import { fixedClock, installFakeClock, toEpochMs } from '@/lib/time';
import { formatMegabytes } from '@/lib/wording';

import { ResearchResultPasteArea } from './paste-area';

import type { DraftServer, DraftUpload } from '@/lib/device-drafts';
import type { Mock } from 'vitest';

// The WCAG 2.2 A and AA rules, as the end-to-end watch runs them (CL-IHM-08).
const WCAG_22_AA = { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] };

const REQUEST_ID = 7;
const LABEL = 'Pasted text';
// The default of imports.maxPastedTextMegabytes, 2.
const LIMIT_MEGABYTES = 2;
const RESULT = '{"format": "1.0", "events": [{"summary": "It\'s a \\"trade\\""}]}';
const SAVED_AT = toEpochMs(Date.UTC(2026, 10, 18, 1, 30));
const SAVED_AT_TEXT = 'Draft saved at Wed 18 Nov 2026, 01:30';
// A character of two UTF-8 bytes: 1,000,000 of them are the 2 MB of the limit.
const TWO_BYTES = 'é';
const AT_THE_LIMIT = TWO_BYTES.repeat(1_000_000);
const OVER_THE_LIMIT = `${AT_THE_LIMIT}x`;
const OVER_MESSAGE = 'The pasted text is 2.01 MB, over the 2 MB limit.';
// The size that the size check gives a text against a limit of 0 MB, which refuses any text.
const SIZE_OF_TEXT = /^The pasted text is (?<size>[\d.]+) MB, over the 0 MB limit\.$/u;
// Sizes in bytes at the edges of a hundredth of a megabyte and of the 2 MB of the limit.
const SIZE_BOUNDS = [1, 9999, 10_000, 10_001, 1_999_999, 2_000_000, 2_000_001, 2_010_000];
const SIZES = fc.oneof(fc.constantFrom(...SIZE_BOUNDS), fc.integer({ min: 1, max: 5_000_000 }));

// The work that a test started and that has not ended: the IndexedDB connections open and
// the calls over the network. The paste area saves without waiting, and the store opens the
// global `indexedDB` at each call, so a save still running when its test ends would write
// into the next test's database, whose paste area would then show its text. Each test
// starts it from zero, so that a count leaked by one cannot hold up the others.
const underWay = { count: 0 };

async function nextTurn(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A call to the server takes a turn of the event loop, as one over the network does. */
async function overTheNetwork(): Promise<void> {
  underWay.count += 1;
  await nextTurn();
  underWay.count -= 1;
}

/**
 * A new IndexedDB for one test, which counts each connection from its opening to its
 * closing, or to the failure of its opening, which leaves nothing to close.
 */
function countedIndexedDb(): IDBFactory {
  const factory = new IDBFactory();
  const openDatabase = factory.open.bind(factory);
  factory.open = (name, version) => {
    underWay.count += 1;
    const request = openDatabase(name, version);
    request.addEventListener('error', () => {
      underWay.count -= 1;
    });
    request.addEventListener('success', () => {
      const database = request.result;
      const closeDatabase = database.close.bind(database);
      database.close = () => {
        underWay.count -= 1;
        closeDatabase();
      };
    });
    return request;
  };
  return factory;
}

/**
 * Waits until the work that the test started has ended. It looks between two turns of the
 * event loop, when every save, restore and contact still running waits for a connection or
 * a call that `underWay` counts.
 */
async function workEnded(): Promise<void> {
  do {
    await nextTurn();
  } while (underWay.count > 0);
}

/** The Server Actions of the route's drafts, over a map: what the server holds, and what it was asked. */
function fakeServer() {
  const held = new Map<string, DraftUpload>();
  const save = vi.fn<DraftServer['save']>(async (upload) => {
    await overTheNetwork();
    held.set(draftKey(upload.target), upload);
    return {
      ok: true,
      value: { withdrawnEventCount: 0, wasWritten: true, updatedAt: upload.updatedAt },
    };
  });
  const discard = vi.fn<DraftServer['discard']>(async (target) => {
    await overTheNetwork();
    held.delete(draftKey(target));
  });
  const server: DraftServer = {
    check: async (sent) => {
      await overTheNetwork();
      return {
        withdrawnEventCount: 0,
        retentionDays: 7,
        copies: sent.map((target) => ({
          target,
          updatedAt: held.get(draftKey(target))?.updatedAt ?? null,
          requestImported: false,
        })),
      };
    },
    load: async (target) => {
      await overTheNetwork();
      const upload = held.get(draftKey(target));
      return upload === undefined
        ? null
        : { text: upload.text, updatedAt: upload.updatedAt, originDevice: 'Phone' };
    },
    save,
    discard,
  };
  return { held, save, discard, server };
}

type Setup = ReturnType<typeof fakeServer> & { check: Mock<(text: unknown) => void> };

/** Opens the paste area on its request, with a check action that records what it receives. */
async function open(setup: Setup): Promise<void> {
  render(
    <ResearchResultPasteArea
      requestId={REQUEST_ID}
      server={setup.server}
      maxMegabytes={LIMIT_MEGABYTES}
      timeZone="UTC"
      checkAction={(formData) => {
        setup.check(formData.get('text'));
      }}
    />,
  );
  await screen.findByRole('textbox', { name: LABEL });
}

function field(): HTMLElement {
  return screen.getByRole('textbox', { name: LABEL });
}

/** Fills the field in one step, as a pasted text arrives. */
async function paste(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.click(field());
  await user.paste(text);
}

/** Goes through both questions of the discard, to the button that discards for good. */
async function confirmDiscard(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Discard draft' }));
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Continue discarding',
    }),
  );
  await user.click(
    within(
      await screen.findByRole('alertdialog', { name: 'Discard the draft for good?' }),
    ).getByRole('button', { name: 'Discard the draft for good' }),
  );
}

/** The event that ends the opening of a database: its success, or its failure, handled here. */
async function openingEnd(request: IDBOpenDBRequest): Promise<Event> {
  return new Promise((resolve) => {
    request.addEventListener('success', resolve);
    request.addEventListener('error', (event) => {
      event.preventDefault();
      resolve(event);
    });
  });
}

describe('the IndexedDB that these tests count', () => {
  it('counts a connection until it closes, and an opening that fails until it fails', async () => {
    underWay.count = 0;
    const factory = countedIndexedDb();
    const opening = factory.open('counted', 2);
    await openingEnd(opening);
    expect(underWay.count).toBe(1);
    opening.result.close();

    // An older version than the database's own, which the opening refuses.
    const refused = await openingEnd(factory.open('counted', 1));

    expect(refused.type).toBe('error');
    expect(underWay.count).toBe(0);
  });
});

describe('the research-result paste area', () => {
  let setup: Setup;
  let isOnline: boolean;

  beforeEach(() => {
    underWay.count = 0;
    vi.stubGlobal('indexedDB', countedIndexedDb());
    isOnline = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => isOnline);
    onTestFinished(installFakeClock(fixedClock(SAVED_AT)));
    setup = { ...fakeServer(), check: vi.fn<(text: unknown) => void>() };
    // The paste area is gone by now (vitest.dom-setup.ts): its work ends in this test's database.
    return async () => {
      await workEnded();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    };
  });

  function goOnline(): void {
    isOnline = true;
    globalThis.dispatchEvent(new Event('online'));
  }

  it('[IMP-02] turns off autocorrection, smart punctuation and automatic capitals, and keeps straight quotes', async () => {
    const user = userEvent.setup();
    await open(setup);

    expect(field()).toHaveAttribute('autocorrect', 'off');
    expect(field()).toHaveAttribute('autocapitalize', 'off');
    expect(field()).toHaveAttribute('spellcheck', 'false');
    await paste(user, RESULT);

    expect(field()).toHaveValue(RESULT);
  });

  it('[IMP-02] inserts the clipboard text from the Paste button', async () => {
    const user = userEvent.setup();
    await open(setup);
    await navigator.clipboard.writeText(RESULT);

    await user.click(screen.getByRole('button', { name: 'Paste' }));

    await waitFor(() => {
      expect(field()).toHaveValue(RESULT);
    });
  });

  it('[IMP-02] explains the long press when the phone refuses the clipboard', async () => {
    const user = userEvent.setup();
    await open(setup);
    vi.spyOn(navigator.clipboard, 'readText').mockRejectedValue(
      new DOMException('Refused', 'NotAllowedError'),
    );

    await user.click(screen.getByRole('button', { name: 'Paste' }));

    expect(
      await screen.findByText(
        'Your phone did not allow reading the clipboard. Press and hold in the field, then choose Paste.',
      ),
    ).toBeVisible();
    expect(field()).toHaveValue('');
  });

  it('[IMP-02] [CL-IMP-27] fills the field with the text file that is chosen, up to ten times the limit', async () => {
    const user = userEvent.setup();
    await open(setup);

    const file = new File([RESULT], 'result.json');
    Object.defineProperty(file, 'size', { value: 20_000_000 });
    await user.upload(screen.getByLabelText('Choose a text file'), file);

    await waitFor(() => {
      expect(field()).toHaveValue(RESULT);
    });
    expect(screen.queryByText(/^This file is/u)).not.toBeInTheDocument();
  });

  it('[IMP-02] [CL-IMP-27] shows the characters received, counted as code points, and the end of the text', async () => {
    const user = userEvent.setup();
    await open(setup);
    expect(screen.getByText('0 characters received')).toBeVisible();
    expect(screen.queryByText('End of the text')).not.toBeInTheDocument();

    await paste(user, `${'a'.repeat(1200)}THE END 😀`);

    expect(screen.getByText('1,209 characters received')).toBeVisible();
    expect(screen.getByText('End of the text')).toBeVisible();
    expect(screen.getByText(`${'a'.repeat(111)}THE END 😀`, { selector: 'pre' })).toBeVisible();
  });

  it('[IMP-02] [CL-IMP-27] checks a text of exactly the limit in UTF-8 bytes', async () => {
    await open(setup);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText('Choose a text file'),
      new File([AT_THE_LIMIT], 'result.txt'),
    );

    await waitFor(() => {
      expect(screen.getByText('1,000,000 characters received')).toBeVisible();
    });
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(setup.check).toHaveBeenCalledWith(AT_THE_LIMIT);
  });

  it('[IMP-02] [CL-IMP-27] refuses a text one byte over the limit, with its size, and disables Check', async () => {
    await open(setup);
    const user = userEvent.setup();

    await user.upload(
      screen.getByLabelText('Choose a text file'),
      new File([OVER_THE_LIMIT], 'result.txt'),
    );

    const check = await screen.findByRole('button', { name: 'Check' });
    await waitFor(() => {
      expect(check).toBeDisabled();
    });
    expect(check).toHaveAccessibleDescription(OVER_MESSAGE);
    expect(screen.getByText(OVER_MESSAGE)).toBeVisible();
  });

  it.each([
    [20_000_001, 'This file is 20.01 MB, over the 2 MB limit: choose a smaller text file.'],
    [21_000_000, 'This file is 21 MB, over the 2 MB limit: choose a smaller text file.'],
    [21_000_001, 'This file is 21.01 MB, over the 2 MB limit: choose a smaller text file.'],
  ])(
    '[IMP-02] [CL-IMP-27] refuses unread a file of %i bytes, ten times the limit or more, with its size, and keeps the text of the field',
    async (size, message) => {
      const user = userEvent.setup();
      await open(setup);
      await paste(user, RESULT);

      const huge = new File([RESULT], 'huge.txt');
      Object.defineProperty(huge, 'size', { value: size });
      await user.upload(screen.getByLabelText('Choose a text file'), huge);

      expect(await screen.findByText(message)).toBeVisible();
      expect(field()).toHaveValue(RESULT);
    },
  );

  it('[CL-IMP-27] writes the size of a refused file as the size check writes that of a text of as many UTF-8 bytes', () => {
    fc.assert(
      fc.property(SIZES, (bytes) => {
        // Four bytes for each emoji, then one for each letter.
        const text = `${'😀'.repeat(Math.floor(bytes / 4))}${'x'.repeat(bytes % 4)}`;
        const checked = checkPastedTextSize(text, 0);
        const message = checked.ok ? '' : checked.error.message;

        expect(SIZE_OF_TEXT.exec(message)?.groups?.['size']).toBe(formatMegabytes(bytes));
      }),
    );
  });

  it('[IMP-02] says when a chosen file cannot be read as text', async () => {
    const user = userEvent.setup();
    await open(setup);
    const unreadable = new File([RESULT], 'result.txt');
    vi.spyOn(unreadable, 'text').mockRejectedValue(new Error('unreadable'));

    await user.upload(screen.getByLabelText('Choose a text file'), unreadable);

    expect(
      await screen.findByText(
        'This file could not be read as text: choose another file or paste the text.',
      ),
    ).toBeVisible();
  });

  it('[IMP-02] waits to check until a text is pasted, and says why', async () => {
    const user = userEvent.setup();
    await open(setup);

    const check = screen.getByRole('button', { name: 'Check' });
    expect(check).toBeDisabled();
    expect(check).toHaveAccessibleDescription('Paste the result first.');
    await paste(user, RESULT);

    const enabled = screen.getByRole('button', { name: 'Check' });
    expect(enabled).toBeEnabled();
    await user.click(enabled);
    expect(setup.check).toHaveBeenCalledWith(RESULT);
  });

  it('[IHM-42] keeps each change on the device at once, and on the server when online', async () => {
    const user = userEvent.setup();
    await open(setup);

    await paste(user, RESULT);

    await waitFor(() => {
      expect(
        setup.held.get(draftKey({ kind: 'research_result', requestId: REQUEST_ID })),
      ).toMatchObject({
        text: RESULT,
      });
    });
    expect(await screen.findByText(SAVED_AT_TEXT)).toBeVisible();
  });

  it('[IHM-42] finds the text again after a reload', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);
    await screen.findByText(SAVED_AT_TEXT);
    document.body.replaceChildren();

    await open(setup);

    await waitFor(() => {
      expect(field()).toHaveValue(RESULT);
    });
  });

  it('[IHM-42] keeps the text typed offline, and sends it when the network returns', async () => {
    const user = userEvent.setup();
    isOnline = false;
    await open(setup);

    await paste(user, RESULT);

    expect(await screen.findByText(SAVED_AT_TEXT)).toBeVisible();
    expect(setup.save).not.toHaveBeenCalled();
    goOnline();
    await waitFor(() => {
      expect(setup.save).toHaveBeenCalledWith(expect.objectContaining({ text: RESULT }));
    });
  });

  it('[IHM-42] empties the field with Clear, and keeps the draft', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(field()).toHaveValue('');
    });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(setup.save).toHaveBeenLastCalledWith(expect.objectContaining({ text: '' }));
    });
  });

  it('[IHM-42] keeps the draft when the first question is declined', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);
    await screen.findByText(SAVED_AT_TEXT);
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));

    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Discard this draft?' })).getByRole(
        'button',
        { name: 'Keep the draft' },
      ),
    );

    expect(setup.discard).not.toHaveBeenCalled();
    expect(field()).toHaveValue(RESULT);
  });

  it('[IHM-42] discards nothing at the first question, and both copies of the draft at the second', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);
    await screen.findByText(SAVED_AT_TEXT);
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));

    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Continue discarding',
      }),
    );
    const second = await screen.findByRole('alertdialog', { name: 'Discard the draft for good?' });

    expect(second).toHaveTextContent(
      'Once discarded, the pasted text is gone: only pasting it again brings it back.',
    );
    expect(setup.discard).not.toHaveBeenCalled();
    expect(setup.held.size).toBe(1);
    await user.click(within(second).getByRole('button', { name: 'Discard the draft for good' }));
    await waitFor(() => {
      expect(field()).toHaveValue('');
    });
    expect(setup.held.size).toBe(0);
  });

  it('[IHM-42] keeps the draft when the second question is declined', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);
    await screen.findByText(SAVED_AT_TEXT);
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Continue discarding',
      }),
    );

    await user.click(
      within(
        await screen.findByRole('alertdialog', { name: 'Discard the draft for good?' }),
      ).getByRole('button', { name: 'Keep the draft' }),
    );

    expect(setup.discard).not.toHaveBeenCalled();
    expect(setup.held.size).toBe(1);
    expect(field()).toHaveValue(RESULT);
  });

  it('[IHM-42] finds no text after a reload once the draft is discarded', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);
    await screen.findByText(SAVED_AT_TEXT);
    await confirmDiscard(user);
    await waitFor(() => {
      expect(field()).toHaveValue('');
    });
    document.body.replaceChildren();

    await open(setup);

    expect(field()).toHaveValue('');
    expect(screen.queryByText(SAVED_AT_TEXT)).not.toBeInTheDocument();
  });

  it('[IHM-42] [IHM-58] keeps the draft and says why when it cannot be discarded offline', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);
    await screen.findByText(SAVED_AT_TEXT);
    isOnline = false;

    await confirmDiscard(user);

    expect(
      await screen.findByText(
        'The draft can only be discarded while you are online. Connect, then try again.',
      ),
    ).toBeVisible();
    expect(field()).toHaveValue(RESULT);
    expect(setup.discard).not.toHaveBeenCalled();
  });

  it('[IMP-02] [IHM-42] is accessible with a text, over the limit and on both questions of the discard', async () => {
    const user = userEvent.setup();
    await open(setup);
    await paste(user, RESULT);
    await screen.findByText(SAVED_AT_TEXT);
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
    await user.upload(
      screen.getByLabelText('Choose a text file'),
      new File([OVER_THE_LIMIT], 'result.txt'),
    );
    await screen.findByText(OVER_MESSAGE);
    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Continue discarding',
      }),
    );
    await screen.findByRole('alertdialog', { name: 'Discard the draft for good?' });

    await expect(axe.run(document.body, WCAG_22_AA)).resolves.toHaveProperty('violations', []);
  });
});
