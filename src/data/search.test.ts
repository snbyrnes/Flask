import { describe, expect, it } from 'vitest';
import { ID, fixture, ids } from '../test/fixture';
import { EMPTY_FILTERS, compute, type Filters } from './filter';
import { parseQuery, runText } from './search';

const ds = fixture();

/** SMS IDs found by a search, as the results table would list them. */
function find(q: string, opts: { fuzzy?: boolean; filters?: Partial<Filters> } = {}) {
  const text = runText(ds, parseQuery(q), opts.fuzzy ?? false);
  return ids(ds, compute(ds, text, { ...EMPTY_FILTERS, ...opts.filters }).results);
}

describe('name search', () => {
  it('finds names in any language, ignoring case and accents', () => {
    const hits = [ID.paracetamol, ID.paracetamolSodium];
    expect(find('paracetamol')).toEqual(hits);
    expect(find('PARACÉTAMOL')).toEqual(hits);
    expect(find('acetaminophen')).toEqual([ID.paracetamol]);
  });

  it('needs every word in the same name, in any order', () => {
    expect(find('hydrochloric acid')).toEqual([ID.hclConc, ID.hclDilute]);
    expect(find('acid hydrochloric')).toEqual([ID.hclConc, ID.hclDilute]);
    expect(find('hydrochloric insulin')).toEqual([]);
  });

  it('treats quotes as an exact phrase', () => {
    expect(find('"concentrated hydrochloric"')).toEqual([ID.hclConc]);
    expect(find('"hydrochloric concentrated"')).toEqual([]);
  });

  it('leaves out names containing a minus word', () => {
    expect(find('insulin -human')).toEqual([ID.insulinGlargine]);
  });

  it('returns nothing for a misspelling in exact mode and the right substance in fuzzy mode', () => {
    expect(find('paracetemol')).toEqual([]);
    expect(find('paracetemol', { fuzzy: true })).toContain(ID.paracetamol);
  });

  it('supports regular expressions and reports a bad one', () => {
    expect(find('/^insulin \\w+$/')).toEqual([ID.insulinHuman, ID.insulinGlargine]);
    const bad = parseQuery('/(/');
    expect(bad.error).toMatch(/Invalid regular expression/);
    expect(bad.empty).toBe(true);
  });
});

describe('identifier search', () => {
  it('finds a substance by exact SMS ID, EV code or UNII', () => {
    expect(find(ID.newC)).toEqual([ID.newC]);
    expect(find('SUB12050MIG')).toEqual([ID.hclConc]);
    expect(find('sub12050mig')).toEqual([ID.hclConc]);
    expect(find('362O9ITL9D')).toEqual([ID.paracetamol]);
  });

  it('matches codes by prefix and can be limited to one field', () => {
    expect(find('ev:SUB1205')).toEqual([ID.hclConc, ID.hclDilute]);
    expect(find('formula:C8H9')).toEqual([ID.paracetamol]);
    expect(find('unii:SUB1205')).toEqual([]);
  });
});

describe('filters', () => {
  const replaced = [ID.oldA, ID.oldB, ID.replacedOutside, ID.loopA, ID.loopB, ID.twinReplaced].sort();

  it('lists everything when nothing is searched or filtered', () => {
    expect(find('')).toHaveLength(ds.n);
  });

  it('shows only, or hides, replaced substances', () => {
    expect(find('', { filters: { flags: { replaced: 'yes' } } })).toEqual(replaced);
    const current = find('', { filters: { flags: { replaced: 'no' } } });
    expect(current).toHaveLength(ds.n - replaced.length);
    expect(current).not.toContain(ID.oldA);
  });

  it('finds possible duplicates and comment categories', () => {
    expect(find('', { filters: { flags: { sharedIk: 'yes' } } })).toEqual([ID.twinA, ID.twinB]);
    expect(find('', { filters: { comment: ['Unspecified', 'Invalid'] } })).toEqual([ID.hclConc, ID.quoted]);
    expect(find('', { filters: { comment: ['Duplicate of another substance'] } })).toEqual([ID.oldA]);
  });

  it('combines a search with a filter', () => {
    expect(find('insulin', { filters: { type: ['Chemical'] } })).toEqual([]);
    expect(find('paracetamol', { filters: { flags: { parent: 'yes' } } })).toEqual([ID.paracetamolSodium]);
  });
});
