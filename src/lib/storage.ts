import { useCallback, useEffect, useState } from 'react';

const PREFIX = 'sms-viewer:';

export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key);
    if (v === null) return fallback;
    const parsed = JSON.parse(v);
    const isObj = (x: unknown) => x !== null && typeof x === 'object' && !Array.isArray(x);
    // Merge objects with defaults so newly added settings get a value.
    return isObj(fallback) && isObj(parsed) ? { ...(fallback as object), ...parsed } : parsed;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode / quota) */
  }
}

/** useState persisted to localStorage. */
export function useStored<T>(key: string, fallback: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => load(key, fallback));
  useEffect(() => save(key, value), [key, value]);
  const set = useCallback((v: T | ((p: T) => T)) => setValue(v), []);
  return [value, set];
}
