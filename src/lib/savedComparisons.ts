import type { ComparisonSession } from './session';

export interface SavedComparison {
  id: string;
  name: string;
  savedAt: string;
  autosave: boolean;
}

export class SavedComparisonConflict extends Error {
  constructor() {
    super('The saved copy changed in another tab. Your edits are still open; save them as a new comparison.');
  }
}

let opening: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('difflens-comparisons', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('entries', { keyPath: 'id' });
      request.result.createObjectStore('sessions');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      db.onclose = () => { opening = undefined; };
      resolve(db);
    };
    request.onblocked = () => reject(new Error('Local storage is busy in another tab.'));
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listSavedComparisons(): Promise<SavedComparison[]> {
  const db = await database();
  return readRequest(db.transaction('entries').objectStore('entries').getAll());
}

export async function readSavedComparison(id: string): Promise<{
  entry: SavedComparison;
  session: ComparisonSession;
}> {
  const db = await database();
  const tx = db.transaction(['entries', 'sessions']);
  const [entry, session]: [SavedComparison | undefined, ComparisonSession | undefined] = await Promise.all([
    readRequest(tx.objectStore('entries').get(id)),
    readRequest(tx.objectStore('sessions').get(id)),
  ]);
  if (!entry || !session) throw new Error('This comparison no longer exists.');
  return { entry, session: { ...session, name: entry.name } };
}

async function mutate(
  id: string,
  apply: (current: SavedComparison | undefined) =>
    { entry: SavedComparison | undefined; session?: ComparisonSession },
): Promise<SavedComparison | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'sessions'], 'readwrite');
    const entries = tx.objectStore('entries');
    const sessions = tx.objectStore('sessions');
    let result: SavedComparison | undefined;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Local storage is unavailable.'));
    const request = entries.get(id);
    request.onsuccess = () => {
      try {
        const { entry, session } = apply(request.result);
        result = entry;
        if (!entry) {
          entries.delete(id);
          sessions.delete(id);
        } else {
          entries.put(entry);
          if (session) sessions.put(session, id);
        }
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}

export async function addSavedComparison(
  session: ComparisonSession,
  autosave: boolean,
): Promise<SavedComparison> {
  const entry = { id: crypto.randomUUID(), name: session.name, savedAt: session.savedAt, autosave };
  await mutate(entry.id, () => ({ entry, session }));
  return entry;
}

export async function updateSavedComparison(
  id: string,
  updates: { name?: string; autosave?: boolean } | {
    session: ComparisonSession;
    baseRevision: string;
    automatic?: boolean;
  },
): Promise<SavedComparison> {
  const entry = await mutate(id, (current) => {
    if ('session' in updates) {
      if (!current || updates.baseRevision !== current.savedAt || (updates.automatic && !current.autosave)) {
        throw new SavedComparisonConflict();
      }
      const savedAt = new Date(Math.max(Date.now(), Date.parse(current.savedAt) + 1)).toISOString();
      return { entry: { ...current, savedAt }, session: { ...updates.session, savedAt } };
    }
    if (!current) throw new Error('This comparison no longer exists.');
    return {
      entry: {
        ...current,
        name: updates.name ?? current.name,
        autosave: updates.autosave ?? current.autosave,
      },
    };
  });
  if (!entry) throw new Error('This comparison no longer exists.');
  return entry;
}

export async function deleteSavedComparison(id: string): Promise<void> {
  await mutate(id, () => ({ entry: undefined }));
}
