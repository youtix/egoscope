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
export { useOnlineStatus } from './online-status';
export type { ConnectivityMode } from './online-status';

// offline-banner.tsx: OfflineBanner (F-offline)
export { OfflineBanner } from './offline-banner';
export type { OfflineBannerProps } from './offline-banner';

// online-only-submit.tsx: OnlineOnlySubmit (F-offline)
export { OnlineOnlySubmit } from './online-only-submit';
export type { OnlineOnlySubmitProps } from './online-only-submit';

// update-banner.tsx: UpdateBanner (F-offline)
export { UpdateBanner } from './update-banner';

// refresh-on-return.ts: useRefreshOnReturn (F-offline)
export { useRefreshOnReturn } from './refresh-on-return';

// device-shell.tsx: DeviceShell, the app-wide device pieces of the layout's slot (F-offline)
export { DeviceShell } from './device-shell';
export type { DeviceShellProps } from './device-shell';

// device-data.ts: clearDeviceData (F-offline)
export { clearDeviceData, ERASE_DEVICE_DATA_COOKIE } from './device-data';

// erase-device-data.tsx: the login page's erasure for a browser that ignores Clear-Site-Data (F-offline)
export { EraseDeviceData } from './erase-device-data';

// screen-copies.ts: what the page shares with the worker of src/app/sw.ts (F-offline)
export type { WorkerContract } from './screen-copies';
