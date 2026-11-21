/**
 * The probe pages of the watch's own tests, accessibility.spec.ts and
 * accessibility-signals.spec.ts: small pages that meet WCAG 2.2 AA or break it,
 * which the test's browser context serves itself at addresses of the app.
 */
import type { Finding } from './accessibility';
import type { BrowserContext, Page } from '@playwright/test';

/** A page that meets WCAG 2.2 AA, with `body` as the content of its main landmark. */
export const pageWith = (body: string, heading = 'Probe'): string =>
  `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Probe</title></head><body><main><h1>${heading}</h1>${body}</main></body></html>`;

export const IMAGE_WITHOUT_ALT = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';

/** The script statement that adds `html` to the main landmark. */
export const append = (html: string): string =>
  `document.querySelector('main').insertAdjacentHTML('beforeend', '${html}');`;

/**
 * A script that runs `statements` once the page hears `stream`: what an app
 * shows or does after its first render, when `streamIn` says so.
 */
export const onStream = (statements: string): string =>
  `<script>document.addEventListener('stream', () => { ${statements} });</script>`;

/**
 * Has `page` do what it holds back, as an app does after its first render: between
 * two steps of the test, and so after the check of the first.
 */
export const streamIn = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    globalThis.document.dispatchEvent(new Event('stream'));
  });
};

// Pages that meet WCAG 2.2 AA, one linking to the other, and one that breaks it.
export const PLAIN = pageWith('<p><a href="/probe/other">Another page</a></p>');
export const OTHER = pageWith('<p>Every case counts.</p>', 'Another page');
export const BROKEN = pageWith(IMAGE_WITHOUT_ALT);

/**
 * A page of its own in `context`, the test's browser context, which no watch sees
 * until a test gives it one, where each address of `pages` answers with its
 * bodies in turn, then with its last body again, as does every page of `context`.
 */
export async function servedPage(
  context: BrowserContext,
  pages: Readonly<Record<string, readonly string[]>>,
): Promise<Page> {
  const served = new Map<string, number>();
  await context.route('**/probe/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const bodies = pages[pathname] ?? [];
    const count = served.get(pathname) ?? 0;
    served.set(pathname, count + 1);
    await route.fulfill({
      contentType: 'text/html',
      body: bodies[Math.min(count, bodies.length - 1)] ?? '',
    });
  });
  return context.newPage();
}

/** The findings, each with the ids of the rules it breaks instead of the whole violations. */
export const rulesOf = (findings: readonly Finding[]): readonly unknown[] =>
  findings.map((finding) =>
    'violations' in finding
      ? { address: finding.address, rules: finding.violations.map(({ rule }) => rule) }
      : finding,
  );

/** The address of the app at `path`. */
export const addressOf = (path: string, baseURL: string | undefined): string =>
  new URL(path, baseURL).href;
