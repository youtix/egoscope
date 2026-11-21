import { expect, test } from './fixtures/test';

import type { Page } from '@playwright/test';

// The two themes that the app follows (IHM-63). Each project already runs one;
// every test here runs in both, on the desktop and on the phone.
const THEMES = ['light', 'dark'] as const;

// The largest text size that WCAG 2.2 AA asks a page to take without loss: 200%.
const LARGE_TEXT = 'html { font-size: 200% !important; }';

/**
 * The elements of the page whose content is wider than their box, cut or pushed
 * sideways, and whether the page itself scrolls sideways (IHM-01, IHM-60).
 */
async function overflows(page: Page): Promise<Readonly<{ page: boolean; elements: number }>> {
  return page.evaluate(() => {
    const root = globalThis.document.documentElement;
    const boxes = [
      ...globalThis.document.querySelectorAll('button, a, label, p, dt, dd, td, th, h1, h2, h3'),
    ];
    return {
      page: root.scrollWidth > root.clientWidth,
      elements: boxes.filter((box) => box.scrollWidth > box.clientWidth + 1).length,
    };
  });
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

    test('[IHM-60] keeps every text whole at twice the text size, with no sideways scroll', async ({
      page,
      accessibility,
    }) => {
      await page.addStyleTag({ content: LARGE_TEXT });
      await accessibility.check();

      await expect(page.getByRole('button', { name: 'Main action' })).toBeVisible();
      expect(await overflows(page)).toStrictEqual({ page: false, elements: 0 });
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
      expect(await overflows(page)).toStrictEqual({ page: false, elements: 0 });
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
      await summary.getByRole('link', { name: 'Enter a display name.' }).click();
      await expect(fields.getByRole('textbox', { name: 'Display name' })).toBeFocused();

      await fields.getByRole('textbox', { name: 'Display name' }).fill('Sample');
      await fields.getByText('Duplicate').click();
      await fields.getByRole('button', { name: 'Save' }).click();
      await expect(fields.getByText('The sample is saved.')).toBeVisible();
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
