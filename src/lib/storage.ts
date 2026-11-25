const KEYS = {
  oldText: 'opendiff:old',
  newText: 'opendiff:new',
  draft: 'difflens:text-draft',
  options: 'opendiff:opts',
  viewMode: 'opendiff:view',
  wrap: 'opendiff:wrap',
  lineNumbers: 'opendiff:lineNums',
  theme: 'opendiff:theme',
  syntax: 'opendiff:syntax',
} as const;

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadString(key: string, fallback: string): string {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    if (typeof value === 'string') {
      localStorage.setItem(key, value);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // storage full or unavailable — ignore
  }
}

export const storageKeys = KEYS;
