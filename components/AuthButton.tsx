'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

type Role = 'admin' | 'user' | null;

/**
 * Header identity widget.
 *
 * - Logged out: simple "登录" link.
 * - Logged in: shows email as a button that opens a dropdown with
 *   the user's UUID + role badge + a one-click "copy user_id" +
 *   sign-out. Frank can now see his own auth.users.id without going
 *   to the Supabase dashboard (asked in 2026-08-27).
 *
 * Theme note: dark-only for now. The dropdown background uses
 * --bg-elevated so it blends with the page in dark mode and stays
 * readable if Frank flips to light later (text colors are still
 * dark-only — separate ticket if he actually wants the email chip
 * theme-adaptive).
 */
export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let mounted = true;
    const applyUser = (u: User | null) => {
      if (!mounted) return;
      setEmail(u?.email ?? null);
      setUserId(u?.id ?? null);
      // Supabase types app_metadata as a free-form record; narrow to
      // the shape we actually use (role) at the read site.
      const metaRole = (u?.app_metadata as { role?: string } | undefined)?.role;
      if (metaRole === 'admin') setRole('admin');
      else if (u) setRole('user');
      else setRole(null);
    };
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data }) => {
        if (!mounted) return;
        applyUser(data.user);
        setLoading(false);
      });
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        applyUser(session?.user ?? null);
      });
      sub = data.subscription;
    } catch {
      // Env not configured — treat as logged out.
      setLoading(false);
    }
    return () => {
      mounted = false;
      sub?.unsubscribe();
    };
  }, []);

  // Close the dropdown when the user clicks anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (dropdownRef.current && target && !dropdownRef.current.contains(target)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  function signOut() {
    startTransition(async () => {
      await fetch('/api/auth/signout', { method: 'POST' });
      setOpen(false);
      window.location.href = '/';
    });
  }

  async function copyUserId() {
    if (!userId) return;
    try {
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browser or permission denied — fall back to a
      // selectable text field via prompt().
      window.prompt('复制 user_id', userId);
    }
  }

  if (loading) {
    return <span className="text-xs text-white/30">…</span>;
  }

  if (!email) {
    return (
      <Link href="/login" className="text-sm text-white/60 hover:text-white">
        登录
      </Link>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 text-sm text-white/60 transition hover:text-white"
      >
        <span className="hidden max-w-[180px] truncate sm:inline">{email}</span>
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-white/10 bg-[var(--bg-elevated)] p-3 text-xs shadow-2xl backdrop-blur-sm"
        >
          {/* Email + role badge */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="truncate text-white/80">{email}</span>
            {role === 'admin' && (
              <span className="flex-shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-300">
                admin
              </span>
            )}
            {role === 'user' && (
              <span className="flex-shrink-0 rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-300">
                user
              </span>
            )}
          </div>

          {/* user_id with one-click copy */}
          <div className="mb-3 rounded border border-white/10 bg-black/30 p-2">
            <div className="mb-1 text-white/40">user_id</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate font-mono text-[10px] text-white/70">
                {userId ?? '—'}
              </code>
              <button
                type="button"
                onClick={copyUserId}
                disabled={!userId}
                className="flex-shrink-0 rounded border border-white/20 px-2 py-0.5 text-[10px] text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-40"
              >
                {copied ? '✓ 已复制' : '复制'}
              </button>
            </div>
          </div>

          {/* Sign-out — promoted to its own row now that there's room */}
          <button
            type="button"
            onClick={signOut}
            disabled={pending}
            className="w-full rounded border border-white/15 px-3 py-1.5 text-center text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
          >
            {pending ? '退出中…' : '登出'}
          </button>
        </div>
      )}
    </div>
  );
}