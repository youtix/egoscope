import { describe, expect, it } from 'vitest';

import { paths } from '@/lib/navigation';
import { toEpochMs } from '@/lib/time';

import { serviceMessage } from './service-messages';

const PARIS = 'Europe/Paris';
const LOS_ANGELES = 'America/Los_Angeles';
const BASE = 'https://egoscope.example';
const SETTINGS_URL = `${BASE}${paths.notifications()}`;
const SETTINGS_LINK =
  '<a href="https://egoscope.example/settings/notifications">Open the notification settings</a>';
const HOME_URL = `${BASE}${paths.home()}`;
// Midnight in Paris after Thursday 26 November 2026.
const NEXT_DAY_STARTS_AT = toEpochMs(Date.UTC(2026, 10, 26, 23));
const linesOf = (text: string): readonly string[] => text.split('\n');
/** The lines of the daily cap message after `sentCount` messages, in `zone`. */
const cap = (sentCount: number, zone: string): readonly string[] =>
  linesOf(
    serviceMessage(
      {
        kind: 'daily_cap_reached',
        sentCount,
        nextDayStartsAt: NEXT_DAY_STARTS_AT,
        homeUrl: HOME_URL,
      },
      zone,
    ),
  );

describe('the service messages', () => {
  it('[TEL-08] [CL-TEL-02] confirms the link with the standard first line and the link to the notification settings', () => {
    expect(
      linesOf(serviceMessage({ kind: 'link_confirmation', settingsUrl: SETTINGS_URL }, PARIS)),
    ).toStrictEqual([
      '<b>Egoscope · Telegram linked</b>',
      'Egoscope is linked to this chat.',
      'You will receive here the notifications turned on in settings. Nothing is done from Telegram: each message links to the app.',
      SETTINGS_LINK,
    ]);
  });

  it('[TEL-04] [CL-TEL-19] writes the test message with the instant it was sent, in the zone of the owner', () => {
    const sentAt = toEpochMs(Date.UTC(2026, 10, 26, 9, 15));

    expect(
      linesOf(serviceMessage({ kind: 'test_message', sentAt, settingsUrl: SETTINGS_URL }, PARIS)),
    ).toStrictEqual([
      '<b>Egoscope · Test message</b>',
      'This is a test: notifications reach this chat. Sent Thursday 26 November 2026, 10:15 Paris time.',
      SETTINGS_LINK,
    ]);
  });

  it('[CL-TEL-07] says that the daily cap is reached, until midnight in the zone of the owner, with the link to Home', () => {
    expect(cap(20, PARIS)).toStrictEqual([
      '<b>Egoscope · Daily cap reached</b>',
      '20 messages sent today. Nothing more will be sent before 00:00 Paris time tomorrow; everything stays in the app.',
      '<a href="https://egoscope.example/">Go to Home</a>',
    ]);
    expect(cap(1, LOS_ANGELES)[1]).toBe(
      '1 message sent today. Nothing more will be sent before 00:00 Los Angeles time tomorrow; everything stays in the app.',
    );
  });

  it('[TEL-08] tells a chat that it is no longer linked, with no link since it opens nothing', () => {
    expect(linesOf(serviceMessage({ kind: 'chat_unlinked_notice' }, PARIS))).toStrictEqual([
      '<b>Egoscope · Telegram not linked</b>',
      'This chat is no longer linked to Egoscope',
    ]);
  });
});
