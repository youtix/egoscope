import { describe, expect, it, vi } from 'vitest';

import { consoleSink } from './console-sink';

describe('consoleSink', () => {
  it.each(['debug', 'info', 'warn', 'error'] as const)(
    'writes %s lines with the console method of the same name',
    (level) => {
      const write = vi.spyOn(console, level).mockImplementation(() => undefined);

      consoleSink(level, '{"level":"test"}');

      expect(write).toHaveBeenCalledExactlyOnceWith('{"level":"test"}');
    },
  );
});
