import { useEffect, useRef } from 'react';
import { APP_TITLE, ISSUES_URL, REPO_URL, SPOR_URL, citation } from '../about';
import type { Dataset } from '../data/dataset';
import { fmtDateObj, fmtInt } from '../lib/format';
import { CopyButton } from '../ui/bits';
import { IconExternal, IconX } from '../ui/icons';

/** Closes a dialog on Escape before any other key handler sees it, and focuses it on open. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return ref;
}

export function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="ext-link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
      <IconExternal size={12} />
    </a>
  );
}

export function AboutDialog({ ds, onClose, onWelcome }: { ds: Dataset; onClose: () => void; onWelcome: () => void }) {
  const ref = useDialog(onClose);
  const cite = citation(ds);
  const replaced = ds.flagTotals.replaced;

  return (
    <div className="drawer-scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-label="About this tool and its data" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2>{APP_TITLE}</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="about">
          <p className="about-lead">
            A browser for the substance list of the EMA SPOR Substance Management Service (SMS). It reads one export file
            and makes it searchable, filterable and easy to copy from.
          </p>

          <div className="about-warn" role="note">
            <strong>Not an official EMA service.</strong> This is an independent tool, not affiliated with or endorsed by
            the European Medicines Agency. It shows a copy of the data taken on the date below, so it can be out of date.
            Check anything you rely on for a regulatory submission or a clinical system against{' '}
            <Ext href={SPOR_URL}>the SPOR portal</Ext>.
          </div>

          <h3>The data you are looking at</h3>
          <dl className="about-facts">
            <div>
              <dt>Source</dt>
              <dd>EMA SPOR SMS substance list export</dd>
            </div>
            <div>
              <dt>File</dt>
              <dd className="mono">{ds.raw.fileName}</dd>
            </div>
            <div>
              <dt>Exported</dt>
              <dd>{ds.exportDate ? fmtDateObj(ds.exportDate) : 'Unknown: the file name has no date'}</dd>
            </div>
            <div>
              <dt>Contents</dt>
              <dd>
                {fmtInt(ds.n)} substances, {fmtInt(ds.raw.nameCount)} names, {fmtInt(ds.raw.langs.length)} languages
              </dd>
            </div>
          </dl>

          <h3>What comes from SMS and what this tool adds</h3>
          <p>
            Every value is shown as it appears in the export. Three things are worked out here and are not SMS fields:
          </p>
          <ul>
            <li>
              <strong>Current substance.</strong> The export marks every substance as <em>Current</em>, including the{' '}
              {fmtInt(replaced)} that have a replacement. This tool follows each replacement to the end of its chain.
            </li>
            <li>
              <strong>Possible duplicate.</strong> Substances in use that share an InChIKey. A prompt to check, not a
              ruling.
            </li>
            <li>
              <strong>Comment categories and close matches.</strong> Groupings and typo-tolerant suggestions made for
              searching. Close matches are always labelled.
            </li>
          </ul>

          <h3>Privacy</h3>
          <p>
            Everything runs in your browser. Files you open, lists you paste and searches you run are not uploaded. Lists,
            saved views and settings stay in this browser. The only outside requests are structure images from PubChem,
            and only if you ask for them.
          </p>

          <h3>Cite this export</h3>
          <div className="about-cite">
            <p>{cite}</p>
            <CopyButton value={cite} what="citation" label="Copy" />
          </div>
          <p className="muted small">
            Links copied from this tool record the export they were made on, so a reader is told if the data has changed
            since.
          </p>

          <div className="about-actions">
            <Ext href={ISSUES_URL}>Report a problem or suggest a change</Ext>
            <Ext href={REPO_URL}>Source code (Apache 2.0)</Ext>
            <button type="button" className="link-btn" onClick={onWelcome}>
              Show the getting started screen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
