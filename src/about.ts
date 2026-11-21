import type { Dataset } from './data/dataset';
import { fmtDateObj } from './lib/format';

export const APP_NAME = 'Flask';
export const APP_TAGLINE = 'SMS Substance Browser';
export const APP_TITLE = `${APP_NAME}: ${APP_TAGLINE}`;

export const SITE_URL = 'https://snbyrnes.github.io/Flask/';
export const REPO_URL = 'https://github.com/snbyrnes/Flask';
export const ISSUES_URL = `${REPO_URL}/issues/new`;
export const SPOR_URL = 'https://spor.ema.europa.eu/';

/** "export of 7 Nov 2026", or the file name when it carries no date. */
export function exportLabel(ds: Dataset): string {
  return ds.exportDate ? `export of ${fmtDateObj(ds.exportDate)}` : ds.raw.fileName;
}

/** A reference line for documents that rely on what this export says. */
export function citation(ds: Dataset): string {
  const file = ds.exportDate ? ` (${ds.raw.fileName})` : '';
  return `EMA SPOR Substance Management Service (SMS) substance list, ${exportLabel(ds)}${file}. Viewed with ${APP_TITLE}, ${SITE_URL}`;
}
