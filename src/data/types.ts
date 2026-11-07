/** Substance-level fields we know about. Header names are matched case-insensitively. */
export const SUBSTANCE_FIELDS = {
  id: 'SMS_ID',
  domain: 'Substance_Domain',
  status: 'Status',
  type: 'Substance_Type',
  formula: 'Molecular_Formula',
  mw: 'Molecular_Weight',
  inchikey: 'Inchikey',
  comment: 'Comment',
  created: 'Created_Date',
  updated: 'Last_Updated_Date',
  ev: 'EV_Code',
  svg: 'SVG_Flag',
  unii: 'UNII',
  inn: 'INN_Number',
  pheur: 'PhEur_Number',
  ec: 'EC_List/Number',
  parent: 'Parent_Substance',
  replacement: 'Replacement_Substance',
} as const;

export type FieldKey = keyof typeof SUBSTANCE_FIELDS;
export const FIELD_KEYS = Object.keys(SUBSTANCE_FIELDS) as FieldKey[];

/** Name-level columns (one row per name in the export). */
export const NAME_FIELDS = {
  name: 'Substance_Name',
  preferred: 'Is_Preferred_Name',
  language: 'Language',
  source: 'Name_Source',
} as const;

/** What the parser worker hands back to the UI thread. */
export interface RawDataset {
  fileName: string;
  /** Original header order (without the leading '#'). */
  header: string[];
  rowCount: number;
  subCount: number;
  nameCount: number;
  /** Known substance fields, one string per substance. Missing columns are all ''. */
  fields: Record<FieldKey, string[]>;
  /** Any extra substance-level columns not in SUBSTANCE_FIELDS. */
  extra: { header: string; values: string[] }[];
  /** Names, grouped so each substance's names are contiguous. */
  nameText: string[];
  nameLang: Uint16Array;
  nameSource: Uint16Array;
  namePref: Uint8Array;
  nameSub: Uint32Array;
  subNameStart: Uint32Array;
  subNameCount: Uint32Array;
  subPrefName: Int32Array;
  langs: string[];
  sources: string[];
  /** '\n' + norm(name0) + '\n' + norm(name1) ... + '\n' */
  nameHay: string;
  /** Start offset of each normalised name in nameHay; length nameCount + 1. */
  nameOffsets: Uint32Array;
  parseMs: number;
}

export type WorkerIn = { type: 'parse'; buffer: ArrayBuffer; fileName: string };
export type WorkerOut =
  | { type: 'progress'; phase: 'parse' | 'index'; fraction: number }
  | { type: 'done'; data: import('./pack').PackedDataset }
  | { type: 'error'; message: string };
