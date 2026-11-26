// The public API of the installable app and its offline behavior (module map, section
// 2.1): one slot per file that the plan gives the module, with the names it exports. A
// task adds its exports in its own file's slot only (section 9). The module runs in the
// browser only.

// register.ts: registerServiceWorker (F-pwa)
export { registerServiceWorker } from './register';
export type { RegistrationError, RegistrationResult } from './register';

// update.ts: the new-version detection that the update banner reads (F-pwa)
export {
  APPLY_NEW_VERSION_MESSAGE,
  applyNewVersion,
  hasNewVersion,
  watchForNewVersion,
} from './update';
export type { ApplyError, ApplyResult, VersionRegistration } from './update';

// online-status.ts: useOnlineStatus (F-offline)

// offline-banner.tsx: OfflineBanner (F-offline)

// online-only-submit.tsx: OnlineOnlySubmit (F-offline)

// update-banner.tsx: UpdateBanner (F-offline)

// refresh-on-return.ts: useRefreshOnReturn (F-offline)

// device-shell.tsx: DeviceShell, the app-wide device pieces of the layout's slot (F-offline)

// device-data.ts: clearDeviceData (F-offline)
