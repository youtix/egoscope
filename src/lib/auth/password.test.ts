import { describe, expect, it } from 'vitest';

import { hashPassword, isLongEnough, isSamePassword } from './password';

const PASSWORD = 'violet-harbor-lantern';

describe('password hashing', () => {
  it('[TRV-60] stores a salted scrypt hash from which the password cannot be read', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).toMatch(/^scrypt\$32768\$8\$3\$[\w-]{22}\$[\w-]{86}$/u);
    expect(first).not.toContain(PASSWORD);
    expect(second).not.toBe(first);
  });

  it('[TRV-60] recognizes the password it was made from, and that one only', async () => {
    const stored = await hashPassword(PASSWORD);

    await expect(isSamePassword(PASSWORD, stored)).resolves.toBe(true);
    await expect(isSamePassword(`${PASSWORD}!`, stored)).resolves.toBe(false);
    await expect(isSamePassword('', stored)).resolves.toBe(false);
  });

  it('[TRV-60] matches a password typed in another Unicode form', async () => {
    const stored = await hashPassword('caf\u{E9}-lantern-harbor');

    await expect(isSamePassword('cafe\u{301}-lantern-harbor', stored)).resolves.toBe(true);
  });

  it('matches no password against a stored value of another form', async () => {
    const stored = await hashPassword(PASSWORD);
    const truncated = stored.slice(0, -2);

    await expect(isSamePassword(PASSWORD, 'not-a-hash')).resolves.toBe(false);
    await expect(isSamePassword(PASSWORD, truncated)).resolves.toBe(false);
    await expect(isSamePassword(PASSWORD, stored.replace('scrypt', 'bcrypt'))).resolves.toBe(false);
    await expect(isSamePassword(PASSWORD, 'scrypt$32768$8$1')).resolves.toBe(false);
    await expect(isSamePassword(PASSWORD, 'scrypt$32768$8$1$c2FsdA')).resolves.toBe(false);
  });

  it('treats a stored hash whose parameters scrypt refuses as a bug', async () => {
    const stored = await hashPassword(PASSWORD);
    // A cost of 3, which is not a power of two.
    const refused = `scrypt$3${stored.slice('scrypt$32768'.length)}`;

    await expect(isSamePassword(PASSWORD, refused)).rejects.toThrow('Invalid scrypt params');
  });

  it('[TRV-60] counts the characters a person types, not the code units', () => {
    expect(isLongEnough('a'.repeat(11), 12)).toBe(false);
    expect(isLongEnough('a'.repeat(12), 12)).toBe(true);
    expect(isLongEnough('🏀'.repeat(12), 12)).toBe(true);
    expect(isLongEnough('🏀'.repeat(6), 12)).toBe(false);
  });
});
