import 'server-only';

import { userAgentFromString } from 'next/server';

import { sentence } from '@/lib/wording';

/**
 * The short description of the device that logs in, which its session keeps so that the
 * owner can tell the devices apart (IHM-06, H-IHM-06): its browser and its system, as
 * its `User-Agent` names them, "Chrome on Android"; a device that names neither is an
 * unknown one.
 */
export function describeDevice(userAgent: string | null): string {
  const { browser, os } = userAgentFromString(userAgent ?? undefined);
  return browser.name === undefined || os.name === undefined
    ? sentence('interface.unknownDevice')
    : sentence('interface.deviceDescription', { browser: browser.name, system: os.name });
}
