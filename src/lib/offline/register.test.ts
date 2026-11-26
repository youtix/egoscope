import { describe, expect, it, vi } from 'vitest';

import { registerServiceWorker } from './register';

const REGISTRATION = { scope: 'https://egoscope.test/' };

/** A browser with service workers, whose `register` answers with what `answer` gives. */
function browserWith(answer: () => unknown) {
  const register = vi.fn<(url: string, options: RegistrationOptions) => Promise<unknown>>(
    async () => {
      await Promise.resolve();
      return answer();
    },
  );
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  return register;
}

describe('registerServiceWorker', () => {
  it('[TRV-21] [TRV-22] registers the worker of /sw.js over the whole app', async () => {
    const register = browserWith(() => REGISTRATION);

    const result = await registerServiceWorker();

    expect(result).toStrictEqual({ ok: true, registration: REGISTRATION });
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/' });
  });

  it('says that the browser has no service workers, as on a page that is not served over HTTPS', async () => {
    vi.stubGlobal('navigator', {});

    expect(await registerServiceWorker()).toStrictEqual({ ok: false, error: 'unsupported' });
  });

  it('says that the browser refused the worker when its script does not answer or does not run', async () => {
    browserWith(() => {
      throw new TypeError('Failed to register a ServiceWorker: A bad HTTP response code (404).');
    });

    expect(await registerServiceWorker()).toStrictEqual({ ok: false, error: 'refused' });
  });
});
