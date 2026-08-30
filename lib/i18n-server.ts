// Frank #7304: server-only locale resolver.
//
// `cookies()` from next/headers only works in server contexts.
// Importing it from a client component (or accidentally letting
// it leak into a client bundle) makes the build blow up at
// "next/headers" + "use client" combo. Splitting into a separate
// file lets client components safely import t() from lib/i18n
// without dragging cookies() into the bundle.
//
// The 'server-only' import below makes the dependency explicit:
// bundlers will treat this module as server-only and any client
// import fails loudly.
import 'server-only';
import { cookies } from 'next/headers';
import { COOKIE_NAME, DEFAULT_LOCALE, type Locale } from './i18n';

export async function getLocale(): Promise<Locale> {
  // Next.js 15: cookies() is async.
  const store = await cookies();
  const val = store.get(COOKIE_NAME)?.value;
  if (val === 'ja') return 'ja';
  return DEFAULT_LOCALE;
}
