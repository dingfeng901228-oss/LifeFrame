'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Top-left "LifeFrame" logo link.
 *
 * Frank #7097: clicking the logo on /welcome used to do nothing
 * visible — it linked to `/`, which middleware redirected back to
 * /welcome for guests. Net effect: a round-trip with no UI change,
 * looks like the link is broken.
 *
 * Fix: when the user is already on /welcome, link to /welcome
 * itself (effectively a no-op navigation, but no round-trip).
 * On every other route, link to `/` (the canonical app home for
 * authed users).
 */
export function HomeLogo() {
  const pathname = usePathname();
  const href = pathname === '/welcome' ? '/welcome' : '/';
  return (
    <Link
      href={href}
      className="text-lg font-medium tracking-wide hover:text-[var(--accent)] transition"
    >
      LifeFrame
    </Link>
  );
}