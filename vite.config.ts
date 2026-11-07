import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * Makes SMS substance list exports (*.csv or *.csv.gz) in the project root or
 * ./data available to the app, newest first.
 *
 * Dev server:
 *   GET /datasets.json         -> [{ name, size, modified, url }]
 *   GET /api/datasets/<file>   -> the file as stored
 *
 * Build (GitHub Pages or any static host):
 *   dist/datasets.json         -> the same listing
 *   dist/data/<name>.csv.gz    -> each export, gzipped (the app decompresses it)
 */
function datasetsPlugin(): Plugin {
  const root = process.cwd();
  const dirs = [root, path.join(root, 'data')];

  interface Found {
    /** Name shown in the app, always ending in .csv */
    name: string;
    /** File name on disk */
    fileName: string;
    file: string;
    gz: boolean;
    size: number;
    modified: number;
  }

  function listDatasets(): Found[] {
    const out: Found[] = [];
    for (const dir of dirs) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const fileName of entries) {
        const lower = fileName.toLowerCase();
        const gz = lower.endsWith('.csv.gz');
        if (!gz && !lower.endsWith('.csv')) continue;
        const file = path.join(dir, fileName);
        try {
          const st = fs.statSync(file);
          if (!st.isFile()) continue;
          const name = gz ? fileName.slice(0, -3) : fileName;
          if (out.some((d) => d.name === name)) continue;
          out.push({ name, fileName, file, gz, size: st.size, modified: st.mtimeMs });
        } catch {
          /* ignore unreadable files */
        }
      }
    }
    // Prefer the timestamp embedded in SMS export names (sms-substances-list-YYYYMMDDhhmmss.csv)
    const stamp = (n: string) => n.match(/(\d{14})/)?.[1] ?? '';
    out.sort((a, b) => stamp(b.name).localeCompare(stamp(a.name)) || b.modified - a.modified);
    return out;
  }

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (url === '/datasets.json') {
      const list = listDatasets().map((d) => ({
        name: d.name,
        size: d.size,
        modified: d.modified,
        url: 'api/datasets/' + encodeURIComponent(d.fileName),
      }));
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(list));
      return;
    }
    if (url.startsWith('/api/datasets/')) {
      const fileName = url.slice('/api/datasets/'.length);
      // Only serve files that appear in the listing (no path traversal).
      const hit = listDatasets().find((d) => d.fileName === fileName);
      if (!hit) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      res.setHeader('Content-Type', hit.gz ? 'application/gzip' : 'text/csv; charset=utf-8');
      res.setHeader('Content-Length', String(hit.size));
      res.setHeader('Cache-Control', 'no-cache');
      fs.createReadStream(hit.file).pipe(res);
      return;
    }
    next();
  };

  return {
    name: 'sms-datasets',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    generateBundle() {
      const manifest = listDatasets().map((d) => {
        const data = fs.readFileSync(d.file);
        const gz = d.gz ? data : zlib.gzipSync(data, { level: 9 });
        const fileName = `data/${d.name}.gz`;
        this.emitFile({ type: 'asset', fileName, source: gz });
        // A gzip file ends with the uncompressed size (mod 2^32).
        const size = d.gz ? data.readUInt32LE(data.length - 4) : data.length;
        return { name: d.name, size, modified: d.modified, url: fileName };
      });
      if (!manifest.length) this.warn('No SMS export (*.csv) found in the project folder or ./data. The site will ask visitors to open one.');
      this.emitFile({ type: 'asset', fileName: 'datasets.json', source: JSON.stringify(manifest) });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works from any folder (e.g. a GitHub Pages project site).
  base: './',
  plugins: [react(), datasetsPlugin()],
  server: { port: 5178 },
  preview: { port: 5178 },
  worker: { format: 'es' },
});
