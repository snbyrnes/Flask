import { APP_NAME, APP_TAGLINE, exportLabel } from '../about';
import type { Dataset, FlagKey } from '../data/dataset';
import { fmtInt } from '../lib/format';
import { IconFlask, IconList, IconSearch, IconX } from '../ui/icons';
import { useDialog } from './AboutDialog';

/** Comment categories that mark a record as needing attention (not "duplicate of", which is a resolved pointer). */
export function flaggedComments(ds: Dataset): string[] {
  return ds.comment.values.filter((v) => v && v !== 'Duplicate of another substance');
}

export type QualityCheck = { flag: FlagKey } | { comments: string[] };

interface Props {
  ds: Dataset;
  onClose: () => void;
  onSearch: () => void;
  onLookup: () => void;
  onQuality: (check: QualityCheck) => void;
  onAbout: () => void;
}

/** First-visit screen: what this is, and the three jobs people come to do. */
export function WelcomeDialog({ ds, onClose, onSearch, onLookup, onQuality, onAbout }: Props) {
  const ref = useDialog(onClose);
  const flagged = flaggedComments(ds);
  const flaggedCount = ds.comment.values.reduce((n, v, i) => (flagged.includes(v) ? n + ds.comment.totals[i] : n), 0);
  const total = (k: FlagKey) => ds.flagTotals[k];
  const has = (k: FlagKey) => total(k) > 0;

  return (
    <div className="drawer-scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" tabIndex={-1} ref={ref}>
        <button type="button" className="btn btn-icon welcome-close" onClick={onClose} aria-label="Close">
          <IconX size={16} />
        </button>
        <div className="welcome-head">
          <IconFlask size={30} />
          <div>
            <h2 id="welcome-title">
              {APP_NAME} <span className="welcome-tagline">{APP_TAGLINE}</span>
            </h2>
            <p>
              The EMA SMS substance list, without the spreadsheet: {fmtInt(ds.n)} substances and{' '}
              {fmtInt(ds.raw.nameCount)} names from the {exportLabel(ds)}.
            </p>
          </div>
        </div>

        <div className="welcome-cards">
          <section className="welcome-card">
            <h3>
              <IconSearch size={16} /> Find a substance
            </h3>
            <p>
              Type a name in any of {fmtInt(ds.raw.langs.length)} languages, or an SMS ID, EV code, UNII or InChIKey.
              Spelling slips are forgiven with Fuzzy on.
            </p>
            <button type="button" className="btn btn-primary" onClick={onSearch}>
              Start searching
            </button>
          </section>

          <section className="welcome-card">
            <h3>
              <IconList size={16} /> Map my list
            </h3>
            <p>
              Paste a column of names or codes from Excel. You get the SMS ID and current substance for each line, in
              the same order, ready to paste back.
            </p>
            <button type="button" className="btn btn-primary" onClick={onLookup}>
              Open the lookup list
            </button>
          </section>

          <section className="welcome-card">
            <h3>Review data quality</h3>
            <p>Jump to the records that need a second look.</p>
            <ul className="welcome-checks">
              {has('replaced') && (
                <li>
                  <button type="button" className="link-btn" onClick={() => onQuality({ flag: 'replaced' })}>
                    Replaced substances
                  </button>
                  <span className="muted">{fmtInt(total('replaced'))}</span>
                </li>
              )}
              {has('sharedIk') && (
                <li>
                  <button type="button" className="link-btn" onClick={() => onQuality({ flag: 'sharedIk' })}>
                    Possible duplicates
                  </button>
                  <span className="muted">{fmtInt(total('sharedIk'))}</span>
                </li>
              )}
              {flaggedCount > 0 && (
                <li>
                  <button type="button" className="link-btn" onClick={() => onQuality({ comments: flagged })}>
                    Flagged in comments
                  </button>
                  <span className="muted">{fmtInt(flaggedCount)}</span>
                </li>
              )}
            </ul>
          </section>
        </div>

        <p className="welcome-foot">
          Independent tool, not an official EMA service. Everything runs in your browser and nothing you paste is
          uploaded.{' '}
          <button type="button" className="link-btn" onClick={onAbout}>
            About this tool and its data
          </button>
        </p>
      </div>
    </div>
  );
}
