'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let mounted = true;
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data }) => {
        if (!mounted) return;
        setEmail(data.user?.email ?? null);
        setLoading(false);
      });
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!mounted) return;
        setEmail(session?.user?.email ?? null);
      });
      sub = data.subscription;
    } catch {
      // Env not configured — treat as logged out
      setLoading(false);
    }
    return () => {
      mounted = false;
      sub?.unsubscribe();
    };
  }, []);

  function signOut() {
    startTransition(async () => {
      await fetch('/api/auth/signout', { method: 'POST' });
      window.location.href = '/';
    });
  }

  if (loading) {
    return <span className="text-xs text-white/30">…</span>;
  }

  if (email) {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-white/50 sm:inline">{email}</span>
        <button
          type="button"
          onClick={signOut}
          disabled={pending}
          className="text-sm text-white/60 hover:text-white disabled:opacity-50"
        >
          {pending ? '退出中…' : '登出'}
        </button>
      </div>
    );
  }

  return (
    <Link href="/login" className="text-sm text-white/60 hover:text-white">
      登录
    </Link>
  );
}
