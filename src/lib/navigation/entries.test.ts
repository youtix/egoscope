import { describe, expect, it, vi } from 'vitest';

import { moreMenuEntries, navigationEntries } from './entries';

/** The entries, as label and path. */
const shown = (links: readonly Readonly<{ label: string; href: string }>[]) =>
  links.map(({ label, href }) => [label, href]);

describe('navigationEntries', () => {
  it('[IHM-16] gives the navigation bar of Lot 1: Home, Players, Types and More', () => {
    expect(shown(navigationEntries(1))).toStrictEqual([
      ['Home', '/'],
      ['Players', '/players'],
      ['Types', '/types'],
      ['More', '/more'],
    ]);
  });

  it('[IHM-16] adds Alerts between Players and Types in Lot 2', () => {
    expect(navigationEntries(2).map(({ entry }) => entry)).toStrictEqual([
      'home',
      'players',
      'alerts',
      'types',
      'more',
    ]);
    expect(shown(navigationEntries(2))[2]).toStrictEqual(['Alerts', '/alerts']);
  });

  it('[IHM-16] follows the lot that the build serves when none is given', async () => {
    vi.stubEnv('EGOSCOPE_LOT', '2');
    vi.resetModules();
    const entries = await import('./entries');

    expect(entries.navigationEntries()).toHaveLength(5);
    expect(entries.moreMenuEntries()).toHaveLength(10);
  });
});

describe('moreMenuEntries', () => {
  it('[IHM-16] [CL-IHM-25] gives the More menu of Lot 1, Profiles second', () => {
    expect(shown(moreMenuEntries(1))).toStrictEqual([
      ['Backtest requests', '/backtests'],
      ['Profiles', '/profiles'],
      ['Settings', '/settings'],
      ['App status', '/status'],
      ['Activity journal', '/journal'],
      ['Method and limits', '/method'],
      ['Help', '/help'],
    ]);
  });

  it('[IHM-16] adds Detected events, Validation table and Collection and detection in Lot 2', () => {
    expect(shown(moreMenuEntries(2)).slice(7)).toStrictEqual([
      ['Detected events', '/detected-events'],
      ['Validation table', '/validation'],
      ['Collection and detection', '/collection'],
    ]);
    expect(moreMenuEntries(2).slice(0, 7)).toStrictEqual(moreMenuEntries(1));
  });

  it('[IHM-16] serves Lot 1 alone when the build sets no lot', () => {
    expect(navigationEntries().map(({ entry }) => entry)).not.toContain('alerts');
    expect(moreMenuEntries()).toHaveLength(7);
  });
});
