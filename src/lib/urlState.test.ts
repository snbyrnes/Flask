import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS } from '../data/filter';
import { stampDate, stampOf } from '../data/version';
import { buildHash, parseHash, type UrlState } from './urlState';

const base: UrlState = { q: '', filters: EMPTY_FILTERS, sort: { key: 'relevance', dir: 'desc' }, sel: null, view: 'browse' };
const V = '20261107032836';

describe('export version stamps', () => {
  it('reads the stamp from an export file name', () => {
    expect(stampOf('sms-substances-list-20261107032836.csv')).toBe(V);
    expect(stampOf('sms-substances-list-20261107032836.csv.gz')).toBe(V);
    expect(stampOf('my-list.csv')).toBe('');
    expect(stampOf('list-2026.csv')).toBe('');
  });

  it('turns a stamp into a date and rejects impossible ones', () => {
    expect(stampDate(V)).toEqual(new Date(2026, 10, 7, 3, 28, 36));
    expect(stampDate('20261307032836')).toBeNull();
    expect(stampDate('20260231000000')).toBeNull();
    expect(stampDate('2026')).toBeNull();
  });
});

describe('shareable links', () => {
  it('survives a round trip', () => {
    const state: UrlState = {
      q: '"hydrochloric acid" -dilute',
      filters: {
        ...EMPTY_FILTERS,
        type: ['Chemical', 'Protein'],
        lang: ['French'],
        prefOnly: true,
        flags: { replaced: 'no', unii: 'yes' },
        updated: ['2025-01-01', ''],
        mw: ['100', '200'],
      },
      sort: { key: 'updated', dir: 'asc' },
      sel: '100000075989',
      view: 'browse',
      v: V,
    };
    expect(parseHash(buildHash(state))).toEqual(state);
  });

  it('records the export version whenever the link points at something', () => {
    expect(buildHash({ ...base, sel: '100000075989', v: V })).toBe(`#s=100000075989&v=${V}`);
    expect(buildHash({ ...base, q: 'insulin', v: V })).toBe(`#q=insulin&v=${V}`);
  });

  it('leaves the bare page unpinned so it always opens the newest export', () => {
    expect(buildHash({ ...base, v: V })).toBe('');
  });

  it('leaves the version out when the export has none, and out of saved views', () => {
    expect(buildHash({ ...base, q: 'insulin', v: '' })).toBe('#q=insulin');
    expect(buildHash({ ...base, q: 'insulin' })).toBe('#q=insulin');
  });

  it('ignores a version that is not a real export stamp', () => {
    expect(parseHash('#q=insulin&v=latest').v).toBeNull();
    expect(parseHash('#q=insulin&v=20261399999999').v).toBeNull();
    expect(parseHash('#q=insulin').v).toBeNull();
    expect(parseHash(`#q=insulin&v=${V}`).v).toBe(V);
  });

  it('drops long ID lists from links but keeps them for saved views', () => {
    const list = Array.from({ length: 301 }, (_, i) => String(100000000000 + i));
    const state = { ...base, filters: { ...EMPTY_FILTERS, list, listName: 'my list' } };
    expect(buildHash(state)).toBe('');
    expect(parseHash(buildHash(state, { allIds: true })).filters.list).toEqual(list);
  });
});
