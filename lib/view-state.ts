// Frank #7243 round-3: URL hash view-state.
//
// Inspired by OldMapsOnline / TimeMap, which keeps the whole view
// in the URL:
//
//   https://www.oldmapsonline.org/zh/history/regions
//     #position=6/35.69/139.692&year=1850
//              ^zoom/lng/lat        ^the moment being shown
//
// That makes any view shareable and bookmarkable, and makes the
// browser's back/forward buttons work as "go to the previous
// moment".
//
// LifeFrame's equivalent — the globe auto-rotates, so its rotation
// is not worth sharing. What IS worth sharing is:
//   at     the selected date (the moment being shown)
//   q      the search query
//
// The open photo is deliberately NOT here: PhotoViewer already
// owns its own `/p/{key}` pushState routing, and two features
// writing the URL would fight each other.
//
// Format (hash, no leading #):
//   at=2022-09-29&q=%E5%A8%81%E6%B5%B7
//
// The globe's own rotation deliberately stays out of the URL — a
// shared link should land on the same *photos*, not the same
// orientation, and the globe turns on its own anyway.

export type ViewState = {
  /** Selected date, YYYY-MM-DD. */
  at: string | null;
  /** Search query. */
  q: string | null;
};

export const EMPTY_VIEW_STATE: ViewState = { at: null, q: null };

/** YYYY-MM-DD for a Date, in LOCAL time (matches what the UI shows). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD key back into a local Date, or null if invalid. */
export function fromDateKey(key: string | null): Date | null {
  if (!key) return null;
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // Reject impossible dates BEFORE constructing the Date — otherwise
  // JS silently rolls "2022-13-01" over to January 2023, and a
  // hand-edited URL would open the wrong moment.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check: catches 2023-02-29 → 2023-03-01.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Parse a location.hash into a ViewState. Unknown keys and
 * malformed values are ignored rather than throwing — a hand-edited
 * URL must never break the page.
 */
export function parseHash(hash: string): ViewState {
  const out: ViewState = { ...EMPTY_VIEW_STATE };
  const raw = hash.replace(/^#/, '');
  if (!raw) return out;
  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    if (!value) continue;
    if (key === 'at' && fromDateKey(value)) out.at = value;
    else if (key === 'q') out.q = value.slice(0, 120);
  }
  return out;
}

/**
 * Build a hash string from a ViewState. Returns '' when there is
 * nothing to encode, so a pristine page has no '#'.
 */
export function buildHash(state: ViewState): string {
  const parts: string[] = [];
  if (state.at) parts.push(`at=${encodeURIComponent(state.at)}`);
  // Trim before encoding — a whitespace-only query is noise in a
  // shared URL, and " " is a legal but pointless value.
  const q = state.q ? state.q.trim() : '';
  if (q) parts.push(`q=${encodeURIComponent(q)}`);
  return parts.join('&');
}

/** True when the two states differ in a way worth writing to the URL. */
export function sameViewState(a: ViewState, b: ViewState): boolean {
  return a.at === b.at && a.q === b.q;
}
