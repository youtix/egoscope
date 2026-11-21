import { describe, expect, it } from 'vitest';

import links from '@data/fixtures/ai-exchange/research-result/event-checks/links.json';

import { checkSources } from './check-sources';
import { readDate } from './dates';

import type { SourceCheckRules } from './check-sources';
import type { ResearchSource } from './format';

// 2026-11-20 at 09:59 UTC: 23:59 in UTC+14, the last minute of 2026-11-20 anywhere.
const CHECKED_AT = Date.UTC(2026, 10, 20, 9, 59);
const MS_PER_MINUTE = 60_000;
const ARTICLE = 'https://www.news.example/2021/01/14/rival-mocks-player-a';

// The cleaning of COL-28 as these tests need it, which the engine owns: the fragment and
// one tracking parameter removed, the rest kept as written.
const cleanLink = (url: string): string =>
  (url.split('#', 1)[0] ?? url).replace('utm_source=feed', '');

const RULES: SourceCheckRules = {
  cleanLink,
  disallowedDomains: ['social.example', 'forum.example'],
  checkedAt: CHECKED_AT,
};

/** A source of an article published on 2021-01-14, with an outlet and a title, its fields changed as given. */
const source = (
  url: string | undefined,
  publicationDate: unknown = '2021-01-14',
  texts: Partial<Pick<ResearchSource, 'outlet' | 'title'>> = {},
): ResearchSource => ({
  url,
  outlet: 'A national outlet',
  title: 'Player A taunted by an opponent',
  publicationDate: readDate(publicationDate),
  ...texts,
});

/** Why each of these sources, checked alone, is dropped, or `kept`. */
const fates = (sources: readonly ResearchSource[], rules = RULES): readonly string[] =>
  sources.map((one) => {
    const [warning] = checkSources([one], rules).warnings;
    return warning?.kind === 'source_dropped' ? warning.cause : 'kept';
  });

describe('checkSources', () => {
  it('[IMP-14] [CA-IMP-07] keeps a source with a complete address and drops one written without its scheme or path', () => {
    const checked = checkSources([source(ARTICLE), source('www.media-national.example')], RULES);
    expect(checked).toStrictEqual({
      kept: [
        {
          position: 1,
          url: ARTICLE,
          cleanedUrl: ARTICLE,
          outlet: 'A national outlet',
          title: 'Player A taunted by an opponent',
          publicationDate: { kind: 'date', on: '2021-01-14' },
          dateWarning: undefined,
        },
      ],
      warnings: [{ kind: 'source_dropped', position: 2, cause: 'incomplete_address' }],
    });
  });

  it('[IMP-14] keeps every complete address of an article, whatever its scheme, case, port, path or query', () => {
    const sources = links.articles.map((url) => source(url));
    expect(fates(sources)).toStrictEqual(links.articles.map(() => 'kept'));
  });

  it('[IMP-14] [CL-IMP-07] drops a link without a scheme, a domain name or a path, with a space or a citation marker', () => {
    const sources = [undefined, ...links.incompleteAddresses].map((url) => source(url));
    expect(fates(sources)).toStrictEqual(sources.map(() => 'incomplete_address'));
  });

  it('[IMP-14] [CL-IMP-15] drops a home page once its link is cleaned, a bare query or empty parameters included', () => {
    const sources = links.homePages.map((url) => source(url));
    expect(fates(sources)).toStrictEqual(sources.map(() => 'home_page'));
  });

  it('[IMP-14] checks and cleans a link trimmed, and keeps the outlet and the title trimmed', () => {
    const padded = source(` ${ARTICLE}#top `, '2021-01-14', {
      outlet: ' Outlet ',
      title: ' Title ',
    });
    expect(checkSources([padded], RULES).kept[0]).toMatchObject({
      url: `${ARTICLE}#top`,
      cleanedUrl: ARTICLE,
      outlet: 'Outlet',
      title: 'Title',
    });
  });

  it('[IMP-14] [DSN-01] [DSN-03] [CA-DSN-01] drops a link on a disallowed domain or a subdomain of it, whatever its case', () => {
    const sources = [
      'https://social.example/player-a/status/1',
      'https://www.Social.EXAMPLE/player-a',
      'https://forum.example/thread/2',
      'https://notsocial.example/2021/01/14/a',
      'https://social.example.news.example/a',
    ].map((url) => source(url));
    expect(fates(sources)).toStrictEqual([
      'disallowed_domain',
      'disallowed_domain',
      'disallowed_domain',
      'kept',
      'kept',
    ]);
    expect(fates(sources.slice(0, 1), { ...RULES, disallowedDomains: [] })).toStrictEqual(['kept']);
  });

  it('[IMP-14] [CL-IMP-08] drops a source whose publication date is missing, malformed or nonexistent', () => {
    const dates = [null, '', '14 January 2021', '2021-02-30', '2021-01-14T25:00+00:00'];
    expect(fates(dates.map((date) => source(ARTICLE, date)))).toStrictEqual([
      'publication_date_missing',
      'publication_date_missing',
      'publication_date_malformed',
      'publication_date_malformed',
      'publication_date_malformed',
    ]);
  });

  it('[IMP-14] [CL-IMP-10] drops a date and time after the instant of the import, and a date after its date in UTC+14', () => {
    const dates = [
      '2026-11-20T09:59+00:00',
      '2026-11-20T10:00+00:00',
      '2026-11-20T23:58+14:00',
      '2026-11-20',
      '2026-11-21',
    ];
    const sources = dates.map((date) => source(ARTICLE, date));
    expect(fates(sources)).toStrictEqual([
      'kept',
      'publication_date_in_future',
      'kept',
      'kept',
      'publication_date_in_future',
    ]);
    const aMinuteLater = { ...RULES, checkedAt: CHECKED_AT + MS_PER_MINUTE };
    expect(fates(sources.slice(4), aMinuteLater)).toStrictEqual(['kept']);
  });

  it('[IMP-14] [CL-IMP-08] keeps the instant of a publication date and the warning of its spelling', () => {
    const [kept] = checkSources([source(ARTICLE, '2021-01-14T23:40Z')], RULES).kept;
    expect(kept?.publicationDate).toStrictEqual({
      kind: 'instant',
      on: '2021-01-14',
      at: Date.UTC(2021, 0, 14, 23, 40),
      offsetMinutes: 0,
    });
    expect(kept?.dateWarning).toBe('non_standard_date');
  });

  it('[IMP-14] only warns of a missing outlet or title, and names a dropped source by one cause, its link first', () => {
    const sources = [
      source(ARTICLE, '2021-01-14', { outlet: undefined }),
      source(ARTICLE, '2021-01-14', { title: undefined }),
      source(ARTICLE),
      source('https://news.example/', null, { outlet: undefined }),
    ];
    const checked = checkSources(sources, RULES);
    expect(checked.kept.map((kept) => kept.position)).toStrictEqual([1, 2, 3]);
    expect(checked.warnings).toStrictEqual([
      { kind: 'source_outlet_or_title_missing', position: 1 },
      { kind: 'source_outlet_or_title_missing', position: 2 },
      { kind: 'source_dropped', position: 4, cause: 'home_page' },
    ]);
  });

  it('[IMP-14] keeps nothing of an empty list', () => {
    expect(checkSources([], RULES)).toStrictEqual({ kept: [], warnings: [] });
  });
});
