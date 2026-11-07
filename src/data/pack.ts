import { FIELD_KEYS, type FieldKey, type RawDataset } from './types';

/**
 * Structured-cloning ~1.5M small strings from the worker is slow. Joining each
 * column into one NUL-separated string and splitting it again on the UI thread
 * is several times faster. build.ts strips NUL from the input, so it can't
 * collide with real values.
 */
const SEP = '\0';

export type PackedDataset = Omit<RawDataset, 'fields' | 'nameText' | 'extra'> & {
  packedFields: Record<FieldKey, string>;
  packedNames: string;
  packedExtra: { header: string; values: string }[];
};

export function pack(d: RawDataset): PackedDataset {
  const { fields, nameText, extra, ...rest } = d;
  return {
    ...rest,
    packedFields: Object.fromEntries(FIELD_KEYS.map((k) => [k, fields[k].join(SEP)])) as Record<FieldKey, string>,
    packedNames: nameText.join(SEP),
    packedExtra: extra.map((e) => ({ header: e.header, values: e.values.join(SEP) })),
  };
}

function split(s: string, n: number): string[] {
  if (n === 0) return [];
  const out = s.split(SEP);
  if (out.length !== n) throw new Error(`Corrupt column: expected ${n} values, got ${out.length}.`);
  return out;
}

export function unpack(p: PackedDataset): RawDataset {
  const { packedFields, packedNames, packedExtra, ...rest } = p;
  return {
    ...rest,
    fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, split(packedFields[k], p.subCount)])) as Record<
      FieldKey,
      string[]
    >,
    nameText: split(packedNames, p.nameCount),
    extra: packedExtra.map((e) => ({ header: e.header, values: split(e.values, p.subCount) })),
  };
}
