/**
 * Export versions. SMS export file names carry their creation time
 * (sms-substances-list-YYYYMMDDhhmmss.csv); that 14-digit stamp identifies the
 * export in shared links.
 */

/** The 14-digit timestamp in an export file name, or '' if it has none. */
export function stampOf(fileName: string): string {
  return fileName.match(/(?<!\d)(\d{14})(?!\d)/)?.[1] ?? '';
}

/** A stamp as a local date, or null if it is not a real date. */
export function stampDate(stamp: string): Date | null {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  // Reject overflowed values such as month 13 or 31 February.
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export const isStamp = (v: string | null | undefined): v is string => !!v && stampDate(v) !== null;
