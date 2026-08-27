'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

/**
 * Header link to /admin, visible only when the signed-in user has
 * app_metadata.role = 'admin'. Returns null otherwise — no flicker
 * during initial load (we don't render anything until we know).
 *
 * §2 of 需求0827: admin entry point is /admin/photos. The link is
 * "🛠️ 后台" with an amber color so it visually distinguishes from
 * the regular nav.
 */
export function AdminLink() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const apply = (u: User | null) => {
      if (!mounted) return;
      const role = (u?.app_metadata as { role?: string } | undefined)?.role;
      setIsAdmin(role === 'admin');
      setLoading(false);
    };
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data }) => apply(data.user));
      const { data } = supabase.auth.onAuthStateChange((_e, session) => {
        apply(session?.user ?? null);
      });
      // No subscription handle to unsubscribe (onAuthStateChange in
      // browser client doesn't return one in this version) — on
      // logout the auth state change fires and we re-render.
    } catch {
      setLoading(false);
    }
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || !isAdmin) return null;

  return (
    <Link
      href="/admin/photos"
      className="text-amber-400/80 transition hover:text-amber-300"
      title="后台管理"
    >
      🛠️ 后台
    </Link>
  );
}