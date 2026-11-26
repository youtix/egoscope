'use client';

import { useEffect } from 'react';

import { clearDeviceData } from './device-data';

import type { ReactNode } from 'react';

/**
 * Erases the device's data as it shows, and shows nothing: the login page renders it for a
 * device whose session the owner ended, whose browser may have ignored Clear-Site-Data
 * (IHM-08, DSN-33).
 */
export function EraseDeviceData(): ReactNode {
  useEffect(() => {
    void clearDeviceData();
  }, []);
  return null;
}
