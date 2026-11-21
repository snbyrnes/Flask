import { describe, expect, it } from 'vitest';
import { FIXTURE_FILE, ID, fixture, ids } from '../test/fixture';
import { COL } from './columns';
import { FLAG_DEFS, commentCategory } from './dataset';
import { cleanName, suggest } from './fuzzy';

const ds = fixture();
const sub = (id: string) => {
  const s = ds.byId(id);
  if (s === undefined) throw new Error(`${id} is not in the fixture`);
  return s;
};
const bit = (key: string) => FLAG_DEFS.find((d) => d.key === key)!.bit;
const has = (id: string, key: string) => (ds.flags[sub(id)] & bit(key)) !== 0;

describe('parsing an export', () => {
  it('groups name rows into substances', () => {
    expect(ds.n).toBe(Object.keys(ID).length);
    expect(ds.raw.nameCount).toBe(ds.n + 3);
    const [a, b] = ds.nameRange(sub(ID.paracetamol));
    expect(ds.raw.nameText.slice(a, b)).toEqual(['PARACETAMOL', 'Paracétamol', 'Acetaminophen']);
  });

  it('uses the preferred name, and keeps quotes and commas inside names', () => {
    expect(ds.prefName(sub(ID.paracetamol))).toBe('PARACETAMOL');
    expect(ds.prefName(sub(ID.quoted))).toBe('ALPHA "TEST" NAME');
    expect(ds.prefName(sub(ID.hclConc))).toBe('Hydrochloric acid, concentrated');
  });

  it('reads the export date from the file name', () => {
    expect(FIXTURE_FILE).toContain(ds.stamp);
    expect(ds.stamp).toBe('20260102030405');
    expect(ds.exportDate).toEqual(new Date(2026, 0, 2, 3, 4, 5));
    expect(fixture('my-list.csv').stamp).toBe('');
    expect(fixture('my-list.csv').exportDate).toBeNull();
  });

  it('links children to their parent', () => {
    expect(ids(ds, ds.children.get(sub(ID.paracetamol)) ?? [])).toEqual([ID.paracetamolSodium]);
  });
});

describe('replaced substances', () => {
  it('flags a substance with a replacement as replaced even though its status says Current', () => {
    expect(ds.f.status[sub(ID.oldA)]).toBe('Current');
    expect(has(ID.oldA, 'replaced')).toBe(true);
    expect(has(ID.newC, 'replaced')).toBe(false);
  });

  it('follows a replacement chain to the substance in use', () => {
    expect(ds.replacementChain(sub(ID.oldA))).toEqual([sub(ID.oldB), sub(ID.newC)]);
    expect(ds.current(sub(ID.oldA))).toBe(sub(ID.newC));
    expect(ds.current(sub(ID.oldB))).toBe(sub(ID.newC));
    expect(ds.current(sub(ID.newC))).toBe(sub(ID.newC));
  });

  it('offers the current substance as columns for copying and export', () => {
    expect(COL.current.get(ds, sub(ID.oldA), {})).toBe(ID.newC);
    expect(COL.currentName.get(ds, sub(ID.oldA), {})).toBe('NEW C');
    expect(COL.currentEv.get(ds, sub(ID.oldA), {})).toBe('SUB00012MIG');
    expect(COL.current.get(ds, sub(ID.newC), {})).toBe('');
  });

  it('does not invent a current substance when the chain leaves the export', () => {
    expect(ds.replacementChain(sub(ID.replacedOutside))).toEqual([]);
    expect(ds.currentOf[sub(ID.replacedOutside)]).toBe(-2);
    expect(COL.current.get(ds, sub(ID.replacedOutside), {})).toBe('');
  });

  it('stops on a replacement loop instead of hanging or picking a side', () => {
    expect(ds.currentOf[sub(ID.loopA)]).toBe(-2);
    expect(ds.currentOf[sub(ID.loopB)]).toBe(-2);
    expect(COL.current.get(ds, sub(ID.loopA), {})).toBe('');
  });

  it('lists what a substance replaces', () => {
    expect(ids(ds, ds.replaces.get(sub(ID.newC)) ?? [])).toEqual([ID.oldB]);
  });
});

describe('possible duplicates', () => {
  it('flags substances in use that share an InChIKey, but not replaced ones', () => {
    expect(has(ID.twinA, 'sharedIk')).toBe(true);
    expect(has(ID.twinB, 'sharedIk')).toBe(true);
    expect(has(ID.twinReplaced, 'sharedIk')).toBe(false);
    expect(has(ID.paracetamol, 'sharedIk')).toBe(false);
    expect(ds.flagTotals.sharedIk).toBe(2);
  });

  it('lists every other substance with the same InChIKey', () => {
    expect(ids(ds, ds.sameInchikey(sub(ID.twinA)))).toEqual([ID.twinB, ID.twinReplaced]);
  });
});

describe('comment categories', () => {
  it('groups "Duplicate of ..." comments and leaves the rest as written', () => {
    expect(commentCategory('Duplicate of 100000000011/SUB00011MIG')).toBe('Duplicate of another substance');
    expect(commentCategory('  unspecified ')).toBe('Unspecified');
    expect(commentCategory('')).toBe('');
  });
});

describe('lookup list', () => {
  it('matches identifiers exactly, ignoring case, and says which one matched', () => {
    expect(ds.lookup(ID.paracetamol, true, true)).toEqual({ subs: [sub(ID.paracetamol)], by: 'SMS ID' });
    expect(ds.lookup(' sub09611mig ', true, true)).toEqual({ subs: [sub(ID.paracetamol)], by: 'EV code' });
    expect(ds.lookup('362O9ITL9D', true, true).by).toBe('UNII');
    expect(ds.lookup('rzvajinkpmorjf-uhfffaoysa-n', true, true).by).toBe('InChIKey');
  });

  it('matches names in any language, ignoring case and accents', () => {
    expect(ds.lookup('paracetamol', true, true)).toEqual({ subs: [sub(ID.paracetamol)], by: 'Name' });
    expect(ds.lookup('PARACÉTAMOL', true, true).subs).toEqual([sub(ID.paracetamol)]);
    expect(ds.lookup('acetaminophen', true, true).subs).toEqual([sub(ID.paracetamol)]);
  });

  it('needs the whole name, so a partial name is not a match', () => {
    expect(ds.lookup('paracetamol sod', true, true).subs).toEqual([]);
    expect(ds.lookup('hydrochloric acid', true, true).subs).toEqual([]);
  });

  it('respects the identifiers-only and names-only options', () => {
    expect(ds.lookup('paracetamol', true, false).subs).toEqual([]);
    expect(ds.lookup('SUB09611MIG', false, true).subs).toEqual([]);
  });

  it('strips strengths and pharmacopoeia suffixes before a retry', () => {
    expect(cleanName('Paracetamol 500 mg')).toBe('Paracetamol');
    expect(cleanName('Paracetamol 120 mg/5 ml')).toBe('Paracetamol');
    expect(cleanName('Hydrochloric acid, dilute 10 % w/w Ph. Eur.')).toBe('Hydrochloric acid, dilute');
    expect(ds.lookup(cleanName('Insulin human (100 IU/ml)'), false, true).subs).toEqual([sub(ID.insulinHuman)]);
  });

  it('suggests the closest substance for a misspelt name', () => {
    const [best] = suggest(ds, 'paracetemol');
    expect(best && ds.f.id[best.s]).toBe(ID.paracetamol);
    expect(suggest(ds, 'zzzzqqqq')).toEqual([]);
  });
});
