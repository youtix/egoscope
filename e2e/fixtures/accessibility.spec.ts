import { accessibilityViolations } from './accessibility';
import { expect, test } from './test';

/** A page that meets WCAG 2.2 AA, with `body` as the content of its main landmark. */
const pageWith = (body: string): string =>
  `<!doctype html><html lang="en"><head><title>Probe</title></head><body><main><h1>Probe</h1>${body}</main></body></html>`;

// Two buttons of 16 by 16 CSS pixels, side by side: under the 24 by 24 of WCAG 2.2.
const SMALL_TARGETS =
  '<button type="button" style="width:16px;height:16px;padding:0;margin:0">A</button><button type="button" style="width:16px;height:16px;padding:0;margin:0">B</button>';

test.describe('[IHM-61] the accessibility check', () => {
  test('passes a page that meets WCAG 2.2 AA', async ({ page }) => {
    await page.setContent(pageWith('<p>Every case counts.</p>'));

    expect(await accessibilityViolations(page)).toStrictEqual([]);
  });

  test('reports an image without a text alternative', async ({ page }) => {
    await page.setContent(pageWith('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">'));

    const violations = await accessibilityViolations(page);

    expect(violations.map((violation) => violation.rule)).toStrictEqual(['image-alt']);
  });

  test('reports text below the contrast ratio of level AA', async ({ page }) => {
    await page.setContent(pageWith('<p style="color:#bbb;background:#fff">Pale text</p>'));

    const violations = await accessibilityViolations(page);

    expect(violations.map((violation) => violation.rule)).toStrictEqual(['color-contrast']);
  });

  test('reports touch targets smaller than 24 by 24 CSS pixels, a rule of WCAG 2.2', async ({
    page,
  }) => {
    await page.setContent(pageWith(SMALL_TARGETS));

    const violations = await accessibilityViolations(page);

    expect(violations.map((violation) => violation.rule)).toStrictEqual(['target-size']);
  });
});
