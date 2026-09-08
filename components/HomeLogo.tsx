'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LifeFrameLogoMark } from '@/components/LifeFrameLogo';

/**
 * Top-left brand link in the header.
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
 *
 * Frank #0906 round-13 (P2 #10): the previous version rendered
 * "LifeFrame" as plain text. Now it shows the LifeFrameLogoMark
 * (a small globe with a cyan photo-marker) followed by the
 * "LifeFrame" wordmark, so the brand is visually distinct from
 * a normal link.
 */
export function HomeLogo() {
  const pathname = usePathname();
  const href = pathname === '/welcome' ? '/welcome' : '/';
  return (
    <Link
      href={href}
      className="flex items-center gap-2 text-lg font-medium tracking-wide hover:opacity-70 transition"
    >
      <LifeFrameLogoMark
        size={24}
        className="text-black dark:text-white"
      />
      <span>LifeFrame</span>
    </Link>
  );
}
