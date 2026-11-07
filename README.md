# Flask

A fast browser for EMA SPOR **SMS substance list** exports
(`sms-substances-list-YYYYMMDDhhmmss.csv`). Search all 226k names in every
language, filter by type, domain, language, source, identifiers and data
quality, inspect a substance, and copy anything in the shape you need.

**Open it online: https://snbyrnes.github.io/Flask/**

Everything runs in your browser. The site loads the SMS export published with
it (`data/`), and any export you open or drag onto the window is read locally
and never uploaded.

## Run it locally

Double-click `start.cmd`, or:

```sh
npm install
npm start        # opens http://localhost:5178
```

The app loads the newest `*.csv` (or `*.csv.gz`) in `./data` or this folder. To
use a newer export, drop it in `./data`, or drag it onto the open app window. If
there are several exports, switch between them from the file name in the bottom
bar.

## Publish a new export

The site rebuilds and publishes itself (GitHub Actions, `.github/workflows/pages.yml`)
on every push to `main`. To update the data:

1. Put the new `sms-substances-list-….csv` in `./data` and delete the old one.
   Every export in `./data` is published; the newest opens first.
2. Commit and push. The site updates about a minute later.

The build stores each export gzipped (about 5.5 MB instead of 48 MB) and the app
decompresses it in the browser.

## Search

| Type this | To find |
| --- | --- |
| `paracetamol` | Names in any language. Case and accents are ignored. |
| `hydrochloric acid` | Every word must appear in the same name. |
| `"hydrochloric acid"` | An exact phrase. |
| `insulin -human` | Names without a word. |
| `SUB12039MIG`, `GEB06NHM23`, `100000090270` | Exact SMS ID, EV code, UNII, InChIKey, EC or INN number, or formula. IDs and codes also match by prefix from 4 characters. |
| `ev:SUB120`, `formula:C15H25`, `unii:…` | One field only (`id`, `ev`, `unii`, `inn`, `ec`, `inchikey`, `formula`, `pheur`, `parent`, `replacement`, `name`). |
| `/^insulin \w+$/` | A regular expression over names and identifiers. |

**Exact or Fuzzy.** The switch at the right of the search box picks the match
mode, and the app remembers it. *Exact* finds names that contain what you type.
*Fuzzy* also finds close matches, so `paracetemol`, `amoxicilin trihydrate` or
`imunoglobulin humain` still work. Close matches rank below exact ones and are
tagged *Close match*. If an exact search finds nothing, the app offers to try
fuzzy.

A single letter lists names that start with it. When a substance matches through
a translated or alternative name, the results show which one matched and in what
language.

## Filters

Facets show live counts:

- **Replaced substances:** all, hide them, or only them.
- **Data quality:** possible duplicates (current substances sharing an InChIKey)
  and comment categories (duplicate of another substance, Unspecified, Invalid,
  Ph. Eur. mismatch, no comment).
- Substance type, domain, name language, name source, preferred names only.
- Has / doesn't have UNII, INN, EC, InChIKey, formula, EV code, parent or child
  substances.
- Created and updated dates, molecular weight, SVG flag, status.

Language and source filters decide which names the search looks at.

## Replaced substances

Replacements are followed to the end of the chain, so a substance replaced by
one that was itself replaced points to the substance in use today. The detail
panel shows the current substance (with a copy button) and the chain that led
there. *Current SMS ID*, *Current name* and *Current EV code* are available as
columns, in exports and in copy templates.

## Copy and paste

- **Detail panel:** every identifier has a copy button, and clicking a value
  selects all of it. *Copy as…* gives your templates, a summary, a one-line
  reference, all fields for Excel, JSON, Markdown, every name with language and
  source, or a link.
- **Results:** *Copy all* (or *Copy N* with a selection) copies with a
  template, as a table for Excel, as a column of names, SMS IDs, EV codes or
  UNIIs, as CSV, Markdown or JSON, or downloads CSV (one row per substance or
  one row per name).
- **Excel-safe tables:** table copies include an HTML version, so Excel keeps
  12-digit SMS IDs and EC numbers as text.

### Copy templates

Display settings → *Copy templates…* (or *Edit templates…* in the Copy menu).
Each template is a line of text with fields:

| Write | Means |
| --- | --- |
| `{name}`, `{id}`, `{ev}`, `{unii}`, `{current}`, … | A field. Any column works; the editor lists them all. |
| `[, EV code {ev}]` | Optional: left out when a field inside it is empty. |
| `\t`, `\n` | A tab (new Excel column) or a new line. |

Three starter templates are included, for example
`{name} (SMS ID {id}[, EV code {ev}])`. Press `1`–`9` to copy the current row or
the selection with that template. Each substance becomes one line.

## Lookup list

Paste a column of IDs, codes or names (from Excel or anywhere). You get one
result row per input line, in the same order, ready to paste back next to your
original column. Pasting several lines anywhere in the app opens it. Options:

- **Ignore strengths and suffixes:** retries without `500 mg`, `10 %`, `w/w`,
  `BP`, `Ph. Eur.` and brackets.
- **Use the current substance for replaced ones:** maps replaced matches to the
  substance in use today and notes the change.
- **Suggest close matches:** for lines with no match, shows up to three similar
  substances with a score. Accept one with a click, or accept every suggestion
  scoring 90% or more from *More*.

## Lists and saved views

- **Lists:** collect substances across searches in named lists. `P` adds or
  removes the current row from the chosen list, and the Copy menu adds the whole
  selection. From the Lists panel you can copy a list (table, IDs, names or a
  template), show it in the results, rename or delete it.
- **Saved views:** *Views* next to the sort menu saves the current search,
  filters, sort and match mode under a name, and brings it back in one click.

## Keyboard

`/` search, `↑` `↓` move, `Space` select, `Shift`-click range, `Ctrl A` select
all, `Ctrl C` copy rows, `N` `I` `E` `U` copy name / SMS ID / EV code / UNII,
`1`–`9` copy with a template, `P` add to list, `L` lookup list, `Esc` back out,
`?` all shortcuts. Double-click any cell or name to copy it, right-click a row
for more.

## Notes

- The URL keeps the search, filters and open substance, so you can bookmark or
  share a view. Links to the online site open on the same data for everyone.
- Lists, saved views, templates and settings are stored in each person's
  browser, not on the site.
- Structure images are optional and come from PubChem by InChIKey, so they need
  internet access. Turn on automatic loading in display settings.
- Built with Vite, React and TypeScript. `npm run build` type-checks and builds
  the static site to `dist/` (including the gzipped exports and
  `datasets.json`). `npm run preview` serves that build.
- Data: EMA SPOR Substance Management Service (SMS) substance list.
