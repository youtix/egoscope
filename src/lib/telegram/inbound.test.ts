import { describe, expect, it } from 'vitest';

import { deepLink, isSameSecret, parseUpdate, UPDATE_ID } from './inbound';

import type { UpdateParse } from './types';

const PRIVATE = { id: 7001, type: 'private' } as const;
// Dummy values of the secret's length, 43 base64url characters.
const SECRET_LENGTH = 43;
const SECRET = 'k'.repeat(SECRET_LENGTH);
const OTHER_SECRET = 'j'.repeat(SECRET_LENGTH);
// An update kind that the webhook does not ask for.
const EDITED_MESSAGE = 'edited_message';

const parse = (text: string): UpdateParse =>
  parseUpdate({ [UPDATE_ID]: 3, message: { chat: PRIVATE, text } });

describe('deepLink', () => {
  it('[TEL-29] [CL-TEL-23] carries the link code in the start parameter of the bot link', () => {
    expect(deepLink('egoscope_fake_bot', 'Ab_1-z')).toBe(
      'https://t.me/egoscope_fake_bot?start=Ab_1-z',
    );
  });
});

describe('parseUpdate', () => {
  it('[TEL-29] reads a link code of 64 characters, and a longer one as no code', () => {
    const code = 'a'.repeat(64);

    expect([
      parse(`/start ${code}`),
      parse(`/start ${code}a`),
      parse('/start two words'),
    ]).toStrictEqual([
      { ok: true, update: { kind: 'start', updateId: 3, chat: PRIVATE, linkCode: code } },
      { ok: true, update: { kind: 'other', updateId: 3, chat: PRIVATE } },
      { ok: true, update: { kind: 'other', updateId: 3, chat: PRIVATE } },
    ]);
  });

  it('[TEL-31] reads an update of another kind without a chat, and refuses a negative update_id', () => {
    expect(parseUpdate({ [UPDATE_ID]: 4, [EDITED_MESSAGE]: { chat: PRIVATE } })).toStrictEqual({
      ok: true,
      update: { kind: 'other', updateId: 4, chat: null },
    });
    expect(parseUpdate({ [UPDATE_ID]: -1 })).toStrictEqual({
      ok: false,
      error: { kind: 'not_an_update' },
    });
  });
});

describe('isSameSecret', () => {
  it('[TEL-31] [TRV-67] accepts only the secret itself, whatever the length of the header', () => {
    expect(
      [SECRET, OTHER_SECRET, `${SECRET}x`, SECRET.slice(0, -1), '', null].map((header) =>
        isSameSecret(header, SECRET),
      ),
    ).toStrictEqual([true, false, false, false, false, false]);
  });
});
