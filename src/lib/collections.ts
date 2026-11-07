import { useCallback, useMemo } from 'react';
import { load, useStored } from './storage';

/** A named list of SMS IDs the user collects across searches. */
export interface SavedList {
  id: string;
  name: string;
  ids: string[];
}

/** A named search: query, filters and sort, stored as a URL hash. */
export interface SavedView {
  id: string;
  name: string;
  hash: string;
  fuzzy: boolean;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

let initial: SavedList[] | null = null;
/** First run of this version: carry over the old single "Pinned" list. */
function initialLists(): SavedList[] {
  if (!initial) initial = [{ id: 'pinned', name: 'Pinned', ids: load<string[]>('pinned', []) }];
  return initial;
}

export function useLists() {
  const [stored, setLists] = useStored<SavedList[]>('lists', initialLists());
  const lists = stored.length ? stored : initialLists();
  const [activeId, setActiveId] = useStored<string>('activeList', lists[0].id);
  const active = lists.find((l) => l.id === activeId) ?? lists[0];
  const activeSet = useMemo(() => new Set(active.ids), [active]);

  const update = useCallback(
    (id: string, fn: (l: SavedList) => SavedList) =>
      setLists((ls) => (ls.length ? ls : initialLists()).map((l) => (l.id === id ? fn(l) : l))),
    [setLists],
  );

  /** Adds ids to a list (skipping ones already there). Returns how many were new. */
  const add = useCallback(
    (listId: string, ids: string[]) => {
      // Count from the current render: the state updater below runs later.
      const current = new Set(lists.find((l) => l.id === listId)?.ids ?? []);
      const added = new Set(ids.filter((x) => !current.has(x))).size;
      update(listId, (l) => {
        const have = new Set(l.ids);
        const fresh: string[] = [];
        for (const x of ids) {
          if (have.has(x)) continue;
          have.add(x);
          fresh.push(x);
        }
        return { ...l, ids: [...l.ids, ...fresh] };
      });
      return added;
    },
    [lists, update],
  );

  const remove = useCallback(
    (listId: string, ids: string[]) => {
      const drop = new Set(ids);
      update(listId, (l) => ({ ...l, ids: l.ids.filter((x) => !drop.has(x)) }));
    },
    [update],
  );

  const create = useCallback(
    (name: string, ids: string[] = []) => {
      const l: SavedList = { id: newId(), name, ids: [...new Set(ids)] };
      setLists((ls) => [...(ls.length ? ls : initialLists()), l]);
      setActiveId(l.id);
      return l;
    },
    [setLists, setActiveId],
  );

  const rename = useCallback((listId: string, name: string) => update(listId, (l) => ({ ...l, name })), [update]);

  const deleteList = useCallback(
    (listId: string) => {
      setLists((ls) => {
        const rest = ls.filter((l) => l.id !== listId);
        return rest.length ? rest : [{ id: newId(), name: 'Pinned', ids: [] }];
      });
    },
    [setLists],
  );

  return { lists, active, activeSet, setActiveId, add, remove, create, rename, deleteList };
}

export type ListsApi = ReturnType<typeof useLists>;
