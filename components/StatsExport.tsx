'use client';

import { useCallback, useState } from 'react';
import { t, type Locale } from '@/lib/i18n';

export type ExportRow = {
  country: string;
  city: string;
  count: number;
};

type Format = 'csv' | 'json';

type Props = {
  locale: Locale;
  rows: ExportRow[];
  totalPhotos: number;
  // i18n keys (resolved by the parent — see app/stats/page.tsx
  // for the t() calls). The component is client so we can't
  // re-call t() here without importing from lib/i18n — easier
  // to forward the strings.
  label: string;
  buttonLabel: string;
  csvLabel: string;
  jsonLabel: string;
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
 * CSV: one row per city, columns country, city, photo_count.
 *   Excel / Google Sheets pick this up by default. Encoded
 *   with a UTF-8 BOM so Chinese / Japanese characters don't
 *   come out as mojibake in Excel on Windows.
 *
 * JSON: full structured export with metadata
 *   { exportedAt, totalPhotos, countries: [{country, total,
 *   cities: [{city, count}]}] } — same shape the page already
 *   computes, so consumers can re-render it.
 */
export function StatsExport({
  locale,
  rows,
  totalPhotos,
  label,
  buttonLabel,
  csvLabel,
  jsonLabel,
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
      if (format === 'csv') {
        const header = 'country,city,photo_count\n';
        const body = rows
          .map((r) => {
            // CSV escape: wrap fields containing comma, quote,
            // or newline in double quotes; double up internal
            // quotes. Cities / countries are plain CJK or
            // English in practice so this rarely fires, but
            // defensive for "Plan 4, Zone 1" style names.
            const fields = [r.country, r.city, String(r.count)];
            return fields
              .map((f) =>
                /[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f,
              )
              .join(',');
          })
          .join('\n');
        // UTF-8 BOM (\ufeff) so Excel for Windows opens the
        // file as UTF-8 (otherwise it guesses cp936 and the
        // Chinese / Japanese city names come out garbled).
        const blob = new Blob(['\ufeff' + header + body], {
          type: 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lifeframe-stats-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so the click has a chance to
        // start the download before we tear down the URL.
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } else {
        const payload = {
          exportedAt: new Date().toISOString(),
          totalPhotos,
          countries: countriesForJson,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lifeframe-stats-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setLastFormat(format);
      setOpen(false);
    },
    [rows, totalPhotos, countriesForJson],
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
          className="absolute right-0 z-10 mt-2 w-56 rounded-lg border border-white/15 bg-[#0a0e1a] p-1 shadow-xl"
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