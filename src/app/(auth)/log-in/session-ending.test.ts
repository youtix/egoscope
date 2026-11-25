import { describe, expect, it } from 'vitest';

import { endedLabel, endReasonOf } from './session-ending';

describe('how a session ended, as the login page tells it', () => {
  it.each([
    ['expired', 'Session expired'],
    ['logged_out', 'Logged out'],
    ['password_changed', 'Password changed'],
    ['reset', 'Password reset'],
    ['restored', 'Data restored'],
  ] as const)(
    '[IHM-08] [CL-TRV-05] reads %s from the address and labels it "%s"',
    (ended, label) => {
      const reason = endReasonOf(ended);

      expect(reason).toBe(ended);
      expect(reason === null ? null : endedLabel(reason)).toBe(label);
    },
  );

  it.each([
    ['an unknown reason', 'stolen'],
    ['a property every object has', 'toString'],
    ['an empty value', ''],
    ['no value', undefined],
    ['a repeated parameter', ['reset', 'restored']],
  ])('[IHM-08] reads no ending from %s', (_case, ended) => {
    expect(endReasonOf(ended)).toBeNull();
  });
});
