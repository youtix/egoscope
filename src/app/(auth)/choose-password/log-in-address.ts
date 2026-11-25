import type { Route } from 'next';

/**
 * The login page, for the screen that the device asked for, `next`: it sends a device
 * whose session is open on to that screen, once its password is chosen, and any other
 * device where its session leaves it (TRV-57, IHM-11). The login page alone judges `next`.
 */
export function logInAddress(next: unknown): Route {
  const query = new URLSearchParams({ next: typeof next === 'string' ? next : '/' });
  return `/log-in?${query.toString()}`;
}
