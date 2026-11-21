import { build } from '../data/build';
import { Dataset } from '../data/dataset';

const HEADER =
  '#SMS_ID,Substance_Name,Is_Preferred_Name,Language,Name_Source,Substance_Domain,Status,Substance_Type,Molecular_Formula,Molecular_Weight,Inchikey,Comment,Created_Date,Last_Updated_Date,EV_Code,SVG_Flag,UNII,INN_Number,PhEur_Number,EC_List/Number,Parent_Substance,Replacement_Substance';

interface Sub {
  id: string;
  /** [name, language, source]; the first name is the preferred one. */
  names: [string, string?, string?][];
  type?: string;
  formula?: string;
  mw?: string;
  inchikey?: string;
  comment?: string;
  ev?: string;
  unii?: string;
  parent?: string;
  replacement?: string;
}

export const ID = {
  paracetamol: '100000000001',
  hclConc: '100000000002',
  hclDilute: '100000000003',
  insulinHuman: '100000000004',
  insulinGlargine: '100000000005',
  paracetamolSodium: '100000000006',
  quoted: '100000000007',
  oldA: '100000000010',
  oldB: '100000000011',
  newC: '100000000012',
  replacedOutside: '100000000020',
  loopA: '100000000030',
  loopB: '100000000031',
  twinA: '100000000040',
  twinB: '100000000041',
  twinReplaced: '100000000042',
} as const;

const TWIN_KEY = 'AAAAAAAAAAAAAA-BBBBBBBBBB-N';

const SUBS: Sub[] = [
  {
    id: ID.paracetamol,
    names: [
      ['PARACETAMOL', 'English', 'INN'],
      ['Paracétamol', 'French'],
      ['Acetaminophen', 'English', 'FDA SUBSTANCE REGISTRATION SYSTEM'],
    ],
    type: 'Chemical',
    formula: 'C8H9NO2',
    mw: '151.16',
    inchikey: 'RZVAJINKPMORJF-UHFFFAOYSA-N',
    ev: 'SUB09611MIG',
    unii: '362O9ITL9D',
  },
  {
    id: ID.hclConc,
    names: [
      ['Hydrochloric acid, concentrated', 'English', 'EUROPEAN PHARMACOPOEIA'],
      ['CONCENTRATED HYDROCHLORIC ACID', 'English', 'SPC'],
    ],
    type: 'Specified Substance Group 1',
    ev: 'SUB12050MIG',
    comment: 'Unspecified',
  },
  { id: ID.hclDilute, names: [['Hydrochloric acid, dilute', 'English']], type: 'Specified Substance Group 1', ev: 'SUB12051MIG' },
  { id: ID.insulinHuman, names: [['INSULIN HUMAN', 'English']], type: 'Protein', ev: 'SUB08196MIG' },
  { id: ID.insulinGlargine, names: [['INSULIN GLARGINE', 'English']], type: 'Protein', ev: 'SUB08197MIG' },
  { id: ID.paracetamolSodium, names: [['PARACETAMOL SODIUM', 'English']], type: 'Chemical', parent: ID.paracetamol },
  { id: ID.quoted, names: [['ALPHA "TEST" NAME', 'English']], comment: 'Invalid' },
  // A -> B -> C: A and B are replaced, C is in use.
  { id: ID.oldA, names: [['OLD A', 'English']], replacement: ID.oldB, comment: `Duplicate of ${ID.oldB}/SUB00011MIG` },
  { id: ID.oldB, names: [['OLD B', 'English']], replacement: ID.newC, ev: 'SUB00011MIG' },
  { id: ID.newC, names: [['NEW C', 'English']], ev: 'SUB00012MIG' },
  { id: ID.replacedOutside, names: [['GONE ELSEWHERE', 'English']], replacement: '999999999999' },
  { id: ID.loopA, names: [['LOOP A', 'English']], replacement: ID.loopB },
  { id: ID.loopB, names: [['LOOP B', 'English']], replacement: ID.loopA },
  { id: ID.twinA, names: [['TWIN A', 'English']], inchikey: TWIN_KEY },
  { id: ID.twinB, names: [['TWIN B', 'English']], inchikey: TWIN_KEY },
  { id: ID.twinReplaced, names: [['TWIN OLD', 'English']], inchikey: TWIN_KEY, replacement: ID.twinA },
];

const q = (v = '') => (v ? `"${v.replace(/"/g, '""')}"` : '');

/** A small export in the real layout: one row per name, CRLF line ends, a BOM, quoted fields. */
export function fixtureCsv(): string {
  const rows = [HEADER];
  for (const s of SUBS)
    s.names.forEach(([name, lang, source], i) =>
      rows.push(
        [
          q(s.id),
          q(name),
          q(i === 0 ? 'True' : 'False'),
          q(lang),
          q(source),
          q('Human use'),
          // As in real exports, replaced substances are still marked Current.
          q('Current'),
          q(s.type ?? 'Chemical'),
          q(s.formula),
          q(s.mw),
          q(s.inchikey),
          q(s.comment),
          q('2019-07-25 11:55:01'),
          q('2025-05-07 11:58:39'),
          q(s.ev),
          '',
          q(s.unii),
          '',
          '',
          '',
          q(s.parent),
          q(s.replacement),
        ].join(','),
      ),
    );
  return String.fromCharCode(0xfeff) + rows.join('\r\n') + '\r\n';
}

export const FIXTURE_FILE = 'sms-substances-list-20260102030405.csv';

export function fixture(fileName = FIXTURE_FILE): Dataset {
  const bytes = new TextEncoder().encode(fixtureCsv());
  return new Dataset(build(bytes.buffer as ArrayBuffer, fileName));
}

/** SMS IDs of substances, sorted, for order-independent comparisons. */
export const ids = (ds: Dataset, subs: ArrayLike<number>) => Array.from(subs, (s) => ds.f.id[s]).sort();
