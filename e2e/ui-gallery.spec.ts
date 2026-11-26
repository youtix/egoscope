import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hermeticEnvironment } from './fixtures/hermetic-server';
import { expect, test } from './fixtures/test';

import type { Locator, Page } from '@playwright/test';

// The two themes that the app follows (IHM-63). Each project already runs one;
// every test here runs in both, on the desktop and on the phone.
const THEMES = ['light', 'dark'] as const;

// What each theme paints, from the tokens of src/app/globals.css: the page, its
// text and the main action.
const THEME_COLORS = {
  light: { canvas: 'rgb(255, 255, 255)', ink: 'rgb(24, 24, 27)', accent: 'rgb(29, 78, 216)' },
  dark: { canvas: 'rgb(9, 9, 11)', ink: 'rgb(244, 244, 245)', accent: 'rgb(147, 197, 253)' },
} as const;

// The largest text size that WCAG 2.2 AA asks a page to take without loss: 200%.
const LARGE_TEXT = 'html { font-size: 200% !important; }';
const LARGE_TEXT_FACTOR = 2;

// How a visually hidden text, written for screen readers alone, is cut on purpose.
const VISUALLY_HIDDEN = 'inset(50%)';
// How much of an element's markup a failure shows, enough to find it.
const SHOWN_MARKUP = 120;

// The mean gaps of the gallery's figures: an increase, a decrease and one that
// rounds to zero, each on nine valid cases.
const MEAN_GAP_SAMPLES = 3;

/**
 * The elements of the page whose content is wider than their box, cut or pushed
 * sideways, apart from the texts hidden for screen readers, and whether the page
 * itself scrolls sideways (IHM-01, IHM-60).
 */
async function overflows(page: Page): Promise<Readonly<{ page: boolean; elements: string[] }>> {
  return page.evaluate(
    ([hidden, markupLength]) => {
      const root = globalThis.document.documentElement;
      const boxes = [...globalThis.document.body.querySelectorAll('*')].filter(
        (box) => globalThis.getComputedStyle(box).clipPath !== hidden,
      );
      return {
        page: root.scrollWidth > root.clientWidth,
        elements: boxes
          .filter((box) => box.scrollWidth > box.clientWidth + 1)
          .map((box) => box.outerHTML.slice(0, markupLength)),
      };
    },
    [VISUALLY_HIDDEN, SHOWN_MARKUP] as const,
  );
}

/** The computed size of the text of `text`, in CSS pixels. */
async function fontSize(text: Locator): Promise<number> {
  return text.evaluate((element) =>
    Number(globalThis.getComputedStyle(element).fontSize.replace(/px$/u, '')),
  );
}

for (const colorScheme of THEMES) {
  test.describe(`the component gallery in the ${colorScheme} theme`, () => {
    test.use({ colorScheme, permissions: ['clipboard-read', 'clipboard-write'] });

    test.beforeEach(async ({ page }) => {
      const response = await page.goto('/dev/ui');

      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Component gallery' }),
      ).toBeVisible();
    });

    test('[IHM-61] [IHM-62] [IHM-63] shows every component in its first state, within WCAG 2.2 AA', async ({
      page,
    }) => {
      await expect(page.getByRole('button', { name: 'Main action' })).toBeVisible();
      await expect(page.getByRole('switch', { name: 'Sound' })).toBeChecked();
      await expect(page.getByRole('tablist', { name: 'Sample panels' })).toBeVisible();
      await expect(page.getByText('Loading the samples')).toBeAttached();
    });

    test("[IHM-63] paints the page and its components in the colors of the device's theme", async ({
      page,
    }) => {
      const colors = THEME_COLORS[colorScheme];

      const canvas = await page.evaluate(
        () => globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
      );
      expect(canvas).toBe(colors.canvas);
      await expect(page.getByRole('main')).toHaveCSS('color', colors.ink);
      await expect(page.getByRole('button', { name: 'Main action' })).toHaveCSS(
        'background-color',
        colors.accent,
      );
    });

    test('[IHM-60] follows the text size up to twice its own, every text whole, with no sideways scroll', async ({
      page,
      accessibility,
    }) => {
      // A field's label, an action, a state and a figure of a table, at the text size of the device.
      const texts = [
        page.getByText('Time zone', { exact: true }),
        page.getByRole('button', { name: 'Main action' }),
        page.getByText('Finished state', { exact: true }),
        page.getByText('1,204', { exact: true }).filter({ visible: true }),
      ];
      // One at a time, as each read waits for the accessibility watch.
      const sizes: number[] = [];
      for (const text of texts) {
        sizes.push(await fontSize(text));
      }

      await page.addStyleTag({ content: LARGE_TEXT });
      await accessibility.check();

      for (const [index, text] of texts.entries()) {
        await expect(text).toHaveCSS(
          'font-size',
          `${String(LARGE_TEXT_FACTOR * (sizes[index] ?? 0))}px`,
        );
      }
      expect(await overflows(page)).toStrictEqual({ page: false, elements: [] });
    });

    test('[IHM-63] works in landscape as in portrait, with no sideways scroll', async ({
      page,
    }) => {
      const portrait = page.viewportSize();
      expect(portrait).not.toBeNull();
      await page.setViewportSize({
        width: portrait?.height ?? 0,
        height: portrait?.width ?? 0,
      });

      await expect(
        page.getByRole('heading', { level: 1, name: 'Component gallery' }),
      ).toBeVisible();
      expect(await overflows(page)).toStrictEqual({ page: false, elements: [] });
    });

    test('[IHM-39] [IHM-63] unfolds the long text, copies it and shares it', async ({ page }) => {
      const text = page.getByRole('region', { name: 'Folded text', exact: true });
      await page.getByRole('button', { name: 'Show all' }).click();
      await expect(page.getByRole('button', { name: 'Show less' })).toBeVisible();

      await page.getByRole('button', { name: 'Copy the text' }).click();
      await expect(page.getByText('Text copied', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Share' }).click();
      await expect(text).toContainText('You are a careful research assistant.');
      await expect(page.getByText('Text copied, to paste where you want')).toBeVisible();
    });

    test('[IHM-61] shows the error summary and the field errors, then a saved sample', async ({
      page,
    }) => {
      const fields = page.getByRole('region', { name: 'Fields' });
      await fields.getByRole('button', { name: 'Show the password' }).click();
      await expect(fields.getByRole('button', { name: 'Show the password' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await fields.getByRole('button', { name: 'Save' }).click();

      const summary = fields.getByRole('alert', { name: 'The sample was not saved' });
      await expect(summary).toBeFocused();
      await expect(fields.getByRole('textbox', { name: 'Display name' })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      const understood = fields.getByRole('checkbox', { name: 'I have read the explanation' });
      await expect(understood).toHaveAttribute('aria-invalid', 'true');
      await expect(fields.getByRole('checkbox', { name: 'Keep a copy' })).toBeChecked();
      await summary.getByRole('link', { name: 'Enter a display name.' }).click();
      await expect(fields.getByRole('textbox', { name: 'Display name' })).toBeFocused();

      await fields.getByRole('textbox', { name: 'Display name' }).fill('Sample');
      await fields.getByText('Duplicate').click();
      await understood.check();
      await fields.getByRole('button', { name: 'Save' }).click();
      await expect(fields.getByText('The sample is saved.')).toBeVisible();
    });

    test('[IHM-61] shows a submit button that waits for its action, deaf to presses', async ({
      page,
    }) => {
      const actions = page.getByRole('region', { name: 'Actions' });
      const send = actions.getByRole('button', { name: 'Send the sample' });
      await send.click();

      await expect(send).toHaveAttribute('aria-disabled', 'true');
      await expect(send).toBeFocused();
      await actions.getByRole('button', { name: 'End the wait' }).click();
      await expect(send).not.toHaveAttribute('aria-disabled');
    });

    test('[IHM-28] [IHM-39] says how to copy and paste by hand where the device offers no clipboard', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { value: undefined });
      });
      await page.reload();

      const refused = page.getByText(
        'Copy refused: the text is selected, copy it with a long press.',
      );
      await page.getByRole('button', { name: 'Copy the text' }).click();
      await expect(refused).toHaveCount(1);
      await page.getByRole('button', { name: 'Share' }).click();
      await expect(refused).toHaveCount(2);
      await page
        .getByRole('region', { name: 'Paste area' })
        .getByRole('button', { name: 'Paste' })
        .click();
      await expect(
        page.getByText('Paste refused: hold a finger on the area, then choose Paste.'),
      ).toBeVisible();
    });

    test('[CL-IHM-18] keeps the input visible beside the current version of a note changed elsewhere', async ({
      page,
    }) => {
      const section = page.getByRole('region', { name: 'Changed elsewhere' });
      await section.getByRole('textbox', { name: 'Note' }).fill('Read every evening, twice.');
      await section.getByRole('button', { name: 'Save the note' }).click();

      await expect(section.getByRole('alert')).toContainText(
        'Read every morning, before the first game of the day.',
      );
      await expect(section.getByRole('textbox', { name: 'Note' })).toHaveValue(
        'Read every evening, twice.',
      );
    });

    test('[IHM-28] pastes the clipboard into the paste area', async ({ page }) => {
      await page.getByRole('button', { name: 'Copy the text' }).click();
      await expect(page.getByText('Text copied', { exact: true })).toBeVisible();

      await page
        .getByRole('region', { name: 'Paste area' })
        .getByRole('button', { name: 'Paste' })
        .click();

      await expect(page.getByRole('textbox', { name: 'Pasted text' })).toHaveValue(
        /^You are a careful research assistant\./u,
      );
    });

    test('[IHM-61] opens the dialog, and the confirmations asked once and twice', async ({
      page,
    }) => {
      await page.getByRole('button', { name: 'Open the dialog' }).click();
      await expect(page.getByRole('dialog', { name: 'A sample dialog' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Open the dialog' })).toBeFocused();

      await page.getByRole('button', { name: 'Archive the sample' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Archive the sample?' })).toBeVisible();
      await page.getByRole('button', { name: 'Archive', exact: true }).click();
      await expect(page.getByText('The sample is archived.')).toBeVisible();

      await page.getByRole('button', { name: 'Erase the sample' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Erase the sample?' })).toBeVisible();
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { name: 'Erase for good?' })).toBeFocused();
      await page.getByRole('button', { name: 'Erase for good' }).click();
      await expect(page.getByText('The sample is erased.')).toBeVisible();
    });

    test("[IHM-15] [CL-IHM-26] opens a term's definition with one tap or one key, and closes it", async ({
      page,
    }) => {
      const term = page.getByRole('button', { name: 'Profile confidence' });
      const definition = page.getByText(
        'The level, low, medium or high, of a profile or a general trend, which says what its verdict rests on.',
      );
      await expect(definition).toBeHidden();

      await term.click();
      await expect(definition).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(definition).toBeHidden();

      await term.press('Enter');
      await expect(definition).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(definition).toBeHidden();
      await expect(term).toBeFocused();
    });

    test('[IHM-15] [CL-IHM-26] opens the definition of each first label of the figures, and only the first label is a button', async ({
      page,
    }) => {
      const terms = [
        {
          label: 'Verdict',
          text: 'The conclusion of a profile or a trend: probable, possible or inconclusive.',
        },
        {
          label: 'Profile confidence',
          text: 'The level, low, medium or high, of a profile or a general trend, which says what its verdict rests on.',
        },
        {
          label: 'Range',
          text: 'Twice the expected noise on either side of the mean gap, shown with it to show the uncertainty that comes from the number of cases.',
        },
      ];

      for (const { label, text } of terms) {
        const term = page.getByRole('button', { name: label, exact: true });
        const definition = page.getByText(text, { exact: true });
        await expect(term).toHaveCount(1);
        await expect(definition).toBeHidden();

        await term.click();
        await expect(definition).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(definition).toBeHidden();
      }
    });

    test('[IHM-47] [CA-IHM-10] writes "increase" and "decrease" beside gaps of +0.60 and −0.60, both alike', async ({
      page,
    }) => {
      const figures = page.getByRole('region', { name: 'Figures' });
      const increase = figures.getByText('increase', { exact: true });
      const decrease = figures.getByText('decrease', { exact: true });
      await expect(figures.getByText('+0.60', { exact: true })).toBeVisible();
      await expect(figures.getByText('\u{2212}0.60', { exact: true })).toBeVisible();

      for (const property of ['font-size', 'font-weight', 'color']) {
        const shown = await increase.evaluate(
          (element, name) => globalThis.getComputedStyle(element).getPropertyValue(name),
          property,
        );
        await expect(decrease).toHaveCSS(property, shown);
      }
    });

    test('[IHM-45] [IHM-46] [SEN-38] [SEN-39] shows each state of the figures', async ({
      page,
    }) => {
      const figures = page.getByRole('region', { name: 'Figures' });
      const texts = [
        'probable, decrease',
        'High',
        '21 valid cases',
        'inconclusive',
        'Medium',
        '1 valid case',
        '0.00',
        'from \u{2212}0.40 to +0.40',
        '7 valid cases: 7 historical',
        '2 valid cases: 2 tracked',
        '1 valid case: 1 historical',
        '1 of 1',
        '1 "probable" profile of 1',
      ];
      for (const text of texts) {
        await expect(figures.getByText(text, { exact: true })).toBeVisible();
      }
      await expect(figures.getByText('Mean gap', { exact: true })).toHaveCount(MEAN_GAP_SAMPLES);
      await expect(figures.getByText('9 valid cases', { exact: true })).toHaveCount(
        MEAN_GAP_SAMPLES,
      );
    });

    test('shows the second tab, and the list filtered on its own address', async ({ page }) => {
      await page.getByRole('tab', { name: 'Second panel' }).click();
      await expect(page.getByRole('tabpanel', { name: 'Second panel' })).toBeVisible();

      const samples = page.getByRole('search', { name: 'Samples', exact: true });
      await samples.getByRole('combobox', { name: 'State' }).selectOption('Closed');
      await samples.getByRole('button', { name: 'Apply' }).click();
      await expect(page).toHaveURL(/\/dev\/ui\?state=closed&q=$/u);
    });
  });
}

// How long a server of the test's own lives, within the test's timeout: a
// production server starts within a few seconds and answers a request at once.
const SERVER_LIFE_MS = 20_000;
const ROOT = path.join(import.meta.dirname, '..');
const NEXT = fileURLToPath(import.meta.resolve('next/dist/bin/next'));
const LISTENING = /- Local:\s+(?<address>http:\/\/127\.0\.0\.1:\d+)/u;

/** A server of the test's own: its address, and how to stop it. */
type OwnServer = Readonly<{ address: string; stop: () => void }>;

/**
 * Runs `next start` on the run's build with `environment` over the test's own,
 * on a port that the system picks, and resolves once it listens.
 */
async function startServer(environment: Readonly<Record<string, string>>): Promise<OwnServer> {
  const controller = new AbortController();
  const server = spawn(
    process.execPath,
    [NEXT, 'start', '--hostname', '127.0.0.1', '--port', '0'],
    {
      cwd: ROOT,
      env: { ...process.env, ...environment },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(SERVER_LIFE_MS)]),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stop = (): void => {
    controller.abort();
  };
  let printed = '';
  return new Promise<OwnServer>((resolve, reject) => {
    server.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      printed += chunk;
      const address = LISTENING.exec(printed)?.groups?.['address'];
      if (address !== undefined) {
        resolve({ address, stop });
      }
    });
    server.stderr.resume();
    server.once('error', (error) => {
      reject(new Error('The server could not start within its life.', { cause: error }));
    });
    server.once('close', (code) => {
      reject(new Error(`The server stopped before it listened, with code ${String(code)}.`));
    });
  });
}

test.describe('the component gallery outside development and the hermetic mode', () => {
  test('answers not found on a server started without the hermetic mode, and names nothing of the gallery', async ({
    request,
  }) => {
    // The run's build, which the hermetic mode made, started as production outside Vercel.
    const server = await startServer({ ...hermeticEnvironment(1), EGOSCOPE_FAKES: '' });
    try {
      const response = await request.get(new URL('/dev/ui', server.address).href);
      const body = await response.text();

      expect(response.status()).toBe(404);
      expect(body).toContain('This page could not be found.');
      expect(body).toContain('<meta name="robots" content="noindex"/>');
      expect(body).not.toContain('Component gallery');
    } finally {
      server.stop();
    }
  });
});
