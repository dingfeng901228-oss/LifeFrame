'use client';

import { useCallback, useState } from 'react';
import { t, type Locale } from '@/lib/i18n';

export type ExportRow = {
  country: string;
  city: string;
  count: number;
};

export type DetailedRow = {
  country: string;
  city: string;
  takenAt: string;
  key: string;
  filename: string;
  lat: number | null;
  lng: number | null;
};

type Format = 'csv' | 'json' | 'csv-detail' | 'json-detail';

type Props = {
  locale: Locale;
  // Summary rows (one per city). Used for the default
  // csv + json exports (aggregate view).
  rows: ExportRow[];
  // Detail rows (one per photo, sorted by taken_at). Used for
  // the "csv-detail" + "json-detail" exports. Independent
  // from `rows` so the user can choose between the two.
  detailedRows: DetailedRow[];
  totalPhotos: number;
  // i18n keys (resolved by the parent — see app/stats/page.tsx
  // for the t() calls). The component is client so we can't
  // re-call t() here without importing from lib/i18n — easier
  // to forward the strings.
  label: string;
  buttonLabel: string;
  csvLabel: string;
  jsonLabel: string;
  csvDetailLabel: string;
  jsonDetailLabel: string;
  downloadedLabel: string;
};

/**
 * Frank #0906 round-14 cont.: export the Stats page aggregate
 * (city + country + photo count) as CSV or JSON. The two
 * formats are generated client-side from a Blob — no server
 * round-trip, no API route. The download is triggered by
 * synthesizing an <a download> click and revoking the object
 * URL after the navigation.
 *
 * Summary CSV: one row per city, columns country, city,
 *   photo_count. Encoded with a UTF-8 BOM so Chinese /
 *   Japanese characters don't come out as mojibake in Excel
 *   on Windows.
 *
 * Summary JSON: { exportedAt, totalPhotos, countries: [{
 *   country, total, cities: [{city, count}] }] } — same shape
 *   the page already computes, so consumers can re-render it.
 *
 * Detail CSV / JSON: one row per PHOTO (not per city),
 *   columns country, city, taken_at, key, filename, latitude,
 *   longitude. The detail exports are sorted by taken_at
 *   ascending so the export reads as a chronological log.
 *   Useful for Excel pivot tables / Sheets timeline plots.
 */
export function StatsExport({
  locale,
  rows,
  detailedRows,
  totalPhotos,
  label,
  buttonLabel,
  csvLabel,
  jsonLabel,
  csvDetailLabel,
  jsonDetailLabel,
  downloadedLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [lastFormat, setLastFormat] = useState<Format | null>(null);

  // Group by country for the JSON export (richer shape). The
  // page already does this for the cards; we duplicate the
  // grouping here so the export can produce the same nested
  // shape without round-tripping through the DOM.
  const countriesForJson = (() => {
    const m = new Map<string, { country: string; cities: Array<{ city: string; count: number }> }>();
    for (const r of rows) {
      const entry = m.get(r.country) ?? { country: r.country, cities: [] };
      entry.cities.push({ city: r.city, count: r.count });
      m.set(r.country, entry);
    }
    return Array.from(m.values())
      .map((c) => ({ ...c, total: c.cities.reduce((s, n) => s + n.count, 0) }))
      .sort((a, b) => b.total - a.total);
  })();

  const trigger = useCallback(
    (format: Format) => {
      const stamp = new Date().toISOString().slice(0, 10);
      // CSV escape: wrap fields containing comma, quote, or
      // newline in double quotes; double up internal quotes.
      // Re-used by both the summary and detail CSV branches.
      const csvEscape = (f: string | number) => {
        const s = String(f);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so the click has a chance to
        // start the download before we tear down the URL.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      };
      if (format === 'csv') {
        const header = 'country,city,photo_count\n';
        const body = rows
          .map((r) =>
            [r.country, r.city, r.count].map(csvEscape).join(','),
          )
          .join('\n');
        downloadBlob(
          new Blob(['\ufeff' + header + body], {
            type: 'text/csv;charset=utf-8',
          }),
          `lifeframe-stats-${stamp}.csv`,
        );
      } else if (format === 'json') {
        downloadBlob(
          new Blob(
            [
              JSON.stringify(
                {
                  exportedAt: new Date().toISOString(),
                  totalPhotos,
                  countries: countriesForJson,
                },
                null,
                2,
              ),
            ],
            { type: 'application/json;charset=utf-8' },
          ),
          `lifeframe-stats-${stamp}.json`,
        );
      } else if (format === 'csv-detail') {
        // One row per photo. Columns: country, city, taken_at,
        // key, filename, latitude, longitude. UTF-8 BOM so
        // Excel for Windows opens the file as UTF-8.
        const header =
          'country,city,taken_at,key,filename,latitude,longitude\n';
        const body = detailedRows
          .map((r) =>
            [
              r.country,
              r.city,
              r.takenAt,
              r.key,
              r.filename,
              r.lat ?? '',
              r.lng ?? '',
            ]
              .map(csvEscape)
              .join(','),
          )
          .join('\n');
        downloadBlob(
          new Blob(['\ufeff' + header + body], {
            type: 'text/csv;charset=utf-8',
          }),
          `lifeframe-photos-${stamp}.csv`,
        );
      } else {
        // json-detail: same shape as the row above, in a
        // flat array. { exportedAt, totalPhotos, photos: [{ ... }] }
        // — easier to iterate than the nested country > city
        // structure for spreadsheet / chart consumers.
        downloadBlob(
          new Blob(
            [
              JSON.stringify(
                {
                  exportedAt: new Date().toISOString(),
                  totalPhotos,
                  photos: detailedRows,
                },
                null,
                2,
              ),
            ],
            { type: 'application/json;charset=utf-8' },
          ),
          `lifeframe-photos-${stamp}.json`,
        );
      }
      setLastFormat(format);
      setOpen(false);
    },
    [rows, totalPhotos, countriesForJson, detailedRows],
  );

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 text-sm text-white transition hover:border-white/40 hover:bg-white/[0.08]"
      >
        <span aria-hidden="true">📥</span>
        {buttonLabel}
        <span
          aria-hidden="true"
          className={`text-xs transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-64 rounded-lg border border-white/15 bg-[#0a0e1a] p-1 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => trigger('csv')}
            className="block w-full rounded px-3 py-2 text-left text-sm text-white/90 transition hover:bg-white/10"
          >
            <div className="font-medium">{csvLabel}</div>
            <div className="text-[11px] text-white/50">
              {t(locale, 'export.csvHint')}
            </div>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => trigger('json')}
            className="block w-full rounded px-3 py-2 text-left text-sm text-white/90 transition hover:bg-white/10"
          >
            <div className="font-medium">{jsonLabel}</div>
            <div className="text-[11px] text-white/50">
              {t(locale, 'export.jsonHint')}
            </div>
          </button>
          {/* Frank #0906 round-14 cont.: per-photo (detail)
              exports sit under a divider so the menu reads
              as "Summary  |  Per-photo". Useful for users who
              want to drive Excel pivot tables off the actual
              taken_at timestamps. */}
          <div className="my-1 h-px bg-white/10" />
          <button
            type="button"
            role="menuitem"
            onClick={() => trigger('csv-detail')}
            className="block w-full rounded px-3 py-2 text-left text-sm text-white/90 transition hover:bg-white/10"
          >
            <div className="font-medium">{csvDetailLabel}</div>
            <div className="text-[11px] text-white/50">
              {t(locale, 'export.csvDetailHint')}
            </div>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => trigger('json-detail')}
            className="block w-full rounded px-3 py-2 text-left text-sm text-white/90 transition hover:bg-white/10"
          >
            <div className="font-medium">{jsonDetailLabel}</div>
            <div className="text-[11px] text-white/50">
              {t(locale, 'export.jsonDetailHint')}
            </div>
          </button>
        </div>
      )}
      {lastFormat && (
        <span
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full mt-1 whitespace-nowrap text-[11px] text-emerald-300/80"
        >
          ✓ {downloadedLabel} ({lastFormat.toUpperCase()})
        </span>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}