import { DEFAULT_TABLE_COLUMNS, type ColKey } from './data/columns';
import { DEFAULT_TEMPLATES, type CopyTemplate } from './lib/template';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  columns: ColKey[];
  /** Fetch structure images from PubChem automatically. */
  structures: boolean;
  detailWidth: number;
  /** Lookup list output columns. */
  lookupColumns: ColKey[];
  /** Exact: substring matches only. Fuzzy: also close matches for typos. */
  searchMode: 'exact' | 'fuzzy';
  templates: CopyTemplate[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  density: 'comfortable',
  columns: DEFAULT_TABLE_COLUMNS,
  structures: false,
  detailWidth: 440,
  lookupColumns: ['id', 'name', 'ev', 'type', 'current'],
  searchMode: 'exact',
  templates: DEFAULT_TEMPLATES,
};
