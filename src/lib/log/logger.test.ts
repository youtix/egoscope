import { describe, expect, it } from 'vitest';

import { createLogger } from './logger';

import type { LogLevel } from './logger';

type Written = Readonly<{ level: LogLevel; line: string }>;

function recordingLogger(minLevel: LogLevel): Readonly<{
  logger: ReturnType<typeof createLogger>;
  written: Written[];
}> {
  const written: Written[] = [];
  const logger = createLogger({
    minLevel,
    sink: (level, line) => {
      written.push({ level, line });
    },
  });
  return { logger, written };
}

describe('createLogger', () => {
  it('writes each entry as one JSON line with its level and message', () => {
    const { logger, written } = recordingLogger('debug');

    logger.info('Started', { attempt: 2 });

    expect(written).toStrictEqual([
      { level: 'info', line: '{"level":"info","message":"Started","context":{"attempt":2}}' },
    ]);
  });

  it('omits the context when no fields are given', () => {
    const { logger, written } = recordingLogger('debug');

    logger.debug('Tick');

    expect(written).toStrictEqual([{ level: 'debug', line: '{"level":"debug","message":"Tick"}' }]);
  });

  it('drops entries below the minimum level', () => {
    const { logger, written } = recordingLogger('warn');

    logger.debug('one');
    logger.info('two');
    logger.warn('three');
    logger.error('four');

    expect(written.map((entry) => entry.level)).toStrictEqual(['warn', 'error']);
  });

  it('[TRV-64] masks fields whose names suggest a credential, at any depth', () => {
    const { logger, written } = recordingLogger('debug');

    logger.error('Request failed', {
      password: 'hunter2-value',
      request: { headers: { Authorization: 'Bearer abc-value', accept: 'json' } },
      attempts: [{ apiKey: 'key-value' }, { sessionToken: 'token-value' }],
    });

    const line = written[0]?.line ?? '';
    expect(JSON.parse(line)).toStrictEqual({
      level: 'error',
      message: 'Request failed',
      context: {
        password: '[redacted]',
        request: { headers: { Authorization: '[redacted]', accept: 'json' } },
        attempts: [{ apiKey: '[redacted]' }, { sessionToken: '[redacted]' }],
      },
    });
    expect(line).not.toMatch(/hunter2|abc-value|key-value|token-value/u);
  });

  it('turns errors, dates and big integers into JSON values', () => {
    const { logger, written } = recordingLogger('debug');
    const failure = new TypeError('Bad input');

    logger.warn('Odd values', {
      failure,
      tipOff: new Date('2025-03-14T23:30:00.000Z'),
      broken: new Date(NaN),
      requests: 12n,
    });

    expect(JSON.parse(written[0]?.line ?? '')).toStrictEqual({
      level: 'warn',
      message: 'Odd values',
      context: {
        failure: { name: 'TypeError', message: 'Bad input', stack: failure.stack },
        tipOff: '2025-03-14T23:30:00.000Z',
        broken: 'Invalid Date',
        requests: '12',
      },
    });
  });

  it('cuts nested values off after four levels, so cycles cannot hang it', () => {
    const { logger, written } = recordingLogger('debug');
    const cycle: Record<string, unknown> = { name: 'loop' };
    cycle['self'] = cycle;

    logger.info('Deep', { cycle });

    expect(JSON.parse(written[0]?.line ?? '')).toStrictEqual({
      level: 'info',
      message: 'Deep',
      context: {
        cycle: {
          name: 'loop',
          self: { name: 'loop', self: { name: 'loop', self: '[truncated]' } },
        },
      },
    });
  });
});
