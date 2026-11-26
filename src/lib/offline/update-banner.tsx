'use client';

import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';

import { hasUnsentDeviceDrafts } from '@/lib/device-drafts';
import { Banner, Button } from '@/lib/ui';
import { sentence } from '@/lib/wording';

import { registerServiceWorker } from './register';
import { reloadPage } from './reload';
import { hasServerNewVersion, watchServerVersion } from './server-contact';
import { applyNewVersion, hasNewVersion, watchForNewVersion } from './update';

import type { ReactNode } from 'react';

// While the reload waits for a draft, how often the banner looks on the device whether the
// draft reached the server; it asks the server nothing.
const DRAFT_CHECK_INTERVAL_MS = 1000;

/** The app's worker, null where the browser runs none, and whether a new version waits beside it. */
type WorkerVersion = Readonly<{ registration: ServiceWorkerRegistration | null; hasNew: boolean }>;

/** The worker's registration and its new version, once the registration settles (IHM-03). */
function useWorkerVersion(): WorkerVersion | undefined {
  const [worker, setWorker] = useState<WorkerVersion>();
  useEffect(() => {
    let isMounted = true;
    let stop: (() => void) | undefined;
    const watch = async () => {
      const result = await registerServiceWorker();
      if (!isMounted) {
        return;
      }
      if (!result.ok) {
        setWorker({ registration: null, hasNew: false });
        return;
      }
      const { registration } = result;
      const changed = () => {
        setWorker({ registration, hasNew: hasNewVersion(registration) });
      };
      stop = watchForNewVersion(registration, changed);
      changed();
    };
    void watch();
    return () => {
      isMounted = false;
      stop?.();
    };
  }, []);
  return worker;
}

/** Whether a new version is ready: the worker's, or the server's build where no worker runs. */
function isAvailable(worker: WorkerVersion | undefined, isServerBuildNew: boolean): boolean {
  if (worker === undefined) {
    return false;
  }
  return worker.registration === null ? isServerBuildNew : worker.hasNew;
}

/**
 * The banner of a new version of the app (IHM-03): it offers to reload, and the reload
 * waits while the device holds a draft not yet saved on the server, so that no draft is
 * lost, and goes on by itself once the draft is saved, which the banner looks for on the
 * device while it is online. The new version is the worker that waits beside the
 * running one, or, where the browser runs no worker, another build than the server ran at
 * the first contact of the page. Home shows it in its system banners, every other screen in
 * the app-wide device pieces.
 */
export function UpdateBanner(): ReactNode {
  const worker = useWorkerVersion();
  const isServerBuildNew = useSyncExternalStore(
    watchServerVersion,
    hasServerNewVersion,
    () => false,
  );
  const [waiting, setWaiting] = useState(false);

  const reload = async (): Promise<void> => {
    if (await hasUnsentDeviceDrafts()) {
      setWaiting(true);
      return;
    }
    setWaiting(false);
    const registration = worker?.registration ?? null;
    const applied = registration === null ? { ok: true } : await applyNewVersion(registration);
    if (applied.ok) {
      reloadPage();
    }
  };
  const retry = useEffectEvent(() => {
    // Offline, the draft cannot reach the server, and a reload without a worker would fail.
    if (navigator.onLine) {
      void reload();
    }
  });

  useEffect(() => {
    const timer = waiting
      ? setInterval(() => {
          retry();
        }, DRAFT_CHECK_INTERVAL_MS)
      : undefined;
    return () => {
      clearInterval(timer);
    };
  }, [waiting]);

  if (!isAvailable(worker, isServerBuildNew)) {
    return null;
  }
  return (
    <Banner
      message={sentence('interface.newVersionAvailable')}
      actions={
        <Button
          label={sentence('interface.reloadApp')}
          variant="primary"
          {...(waiting && { disabledReason: sentence('interface.reloadWaitsForDraft') })}
          onClick={() => {
            void reload();
          }}
        />
      }
    />
  );
}
