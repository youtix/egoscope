// The device copies of drafts, in the browser's IndexedDB, which a reload, an app update,
// an expired session and a network loss leave in place (IHM-42, CL-IHM-10).
import type { DraftTarget, ImportDraftStatus } from './draft-target';
import type { EpochMs } from '@/lib/time';

/**
 * A draft as this device keeps it (IHM-42, CL-DSN-22): its text and last change, whether
 * that text reached the server, the withdrawn-events counter the device last received
 * before it was typed or sent, and its status.
 */
export type DeviceCopy = Readonly<{
  key: string;
  target: DraftTarget;
  text: string;
  updatedAt: EpochMs;
  sent: boolean;
  withdrawnEventCount: number | null;
  status: ImportDraftStatus;
}>;

/** What the device last received from the server: the counter and the retention (CL-DSN-22, CL-IHM-11). */
type DeviceContact = Readonly<{ withdrawnEventCount: number; retentionDays: number | null }>;

const DATABASE = 'egoscope-drafts';
const VERSION = 1;
const COPIES = 'copies';
const CONTACT = 'contact';
// The one record of the contact store.
const LAST_CONTACT = 'last';

/** Settles with the result of an IndexedDB request. */
async function settled<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  });
}

/** Opens the drafts database, creating its stores at the first opening. */
async function open(): Promise<IDBDatabase> {
  const request = indexedDB.open(DATABASE, VERSION);
  request.addEventListener('upgradeneeded', () => {
    request.result.createObjectStore(COPIES, { keyPath: 'key' });
    request.result.createObjectStore(CONTACT);
  });
  return settled(request);
}

/** Runs `work` on one store and closes the database when it settles. */
async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await settled(work(database.transaction(name, mode).objectStore(name)));
  } finally {
    database.close();
  }
}

/** The retention a contact record holds, `null` when it holds none. */
function retentionOf(contact: object): number | null {
  return 'retentionDays' in contact && typeof contact.retentionDays === 'number'
    ? contact.retentionDays
    : null;
}

/** Says whether a record of the copies store is a device copy. */
function isCopy(value: unknown): value is DeviceCopy {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'string' &&
    'text' in value &&
    typeof value.text === 'string'
  );
}

/** The device copy under `key`, or `undefined` (IHM-42). */
export async function readCopy(key: string): Promise<DeviceCopy | undefined> {
  const copy = await withStore<unknown>(COPIES, 'readonly', (store) => store.get(key));
  return isCopy(copy) ? copy : undefined;
}

/** Every device copy (CL-DSN-22). */
export async function listCopies(): Promise<DeviceCopy[]> {
  const copies = await withStore<unknown[]>(COPIES, 'readonly', (store) => store.getAll());
  return copies.filter((copy) => isCopy(copy));
}

/** Keeps `copy` on the device, replacing the copy of its key (IHM-42). */
export async function putCopy(copy: DeviceCopy): Promise<void> {
  await withStore(COPIES, 'readwrite', (store) => store.put(copy));
}

/** Deletes the device copy under `key` (IHM-42, CL-DSN-22). */
export async function deleteCopy(key: string): Promise<void> {
  await withStore(COPIES, 'readwrite', (store) => store.delete(key));
}

/** What the device last received from the server, `undefined` before any contact (CL-DSN-22). */
export async function readContact(): Promise<DeviceContact | undefined> {
  const contact = await withStore<unknown>(CONTACT, 'readonly', (store) => store.get(LAST_CONTACT));
  return typeof contact === 'object' &&
    contact !== null &&
    'withdrawnEventCount' in contact &&
    typeof contact.withdrawnEventCount === 'number'
    ? { withdrawnEventCount: contact.withdrawnEventCount, retentionDays: retentionOf(contact) }
    : undefined;
}

/** Records what the server answered at a contact (CL-DSN-22, CL-IHM-11). */
export async function putContact(contact: DeviceContact): Promise<void> {
  await withStore(CONTACT, 'readwrite', (store) => store.put(contact, LAST_CONTACT));
}

/**
 * Erases this device's copies of every draft, and what it last received from the server,
 * at logout; the server copies stay (DSN-33, CL-IHM-10, CL-DSN-17).
 */
export async function clearDeviceDrafts(): Promise<void> {
  await withStore(COPIES, 'readwrite', (store) => store.clear());
  await withStore(CONTACT, 'readwrite', (store) => store.clear());
}

/**
 * Says whether this device holds a draft whose text has not reached the server, which a
 * logout would lose, for the logout warning (CL-IHM-10).
 */
export async function hasUnsentDeviceDrafts(): Promise<boolean> {
  const copies = await listCopies();
  return copies.some((copy) => !copy.sent);
}
