/** Reloads the page from the start, so that it runs the version of the app that took over (IHM-03). */
export function reloadPage(): void {
  globalThis.location.reload();
}
