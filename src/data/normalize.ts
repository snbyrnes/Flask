/**
 * Search normalisation shared by the parser worker and the UI.
 * Lower-cases, strips diacritics and folds Greek final sigma so that
 * "Paracétamol", "PARACETAMOL" and "paracetamol" all compare equal.
 */
const MARKS = /\p{M}+/gu;
const ASCII = /^[\x00-\x7F]*$/;

export function norm(s: string): string {
  if (ASCII.test(s)) return s.toLowerCase();
  return s.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/ς/g, 'σ');
}

/**
 * Normalises a string while keeping a map from each normalised character
 * back to its source index, so matches can be highlighted in the original.
 */
export function normWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const n = norm(ch);
    for (let k = 0; k < n.length; k++) map.push(i);
    text += n;
    i += ch.length;
  }
  map.push(s.length);
  return { text, map };
}
