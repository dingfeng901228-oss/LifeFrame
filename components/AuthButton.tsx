'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';
import { COOKIE_NAME, t, type Locale } from '@/lib/i18n';

type Role = 'admin' | 'user' | null;

// Frank #7323: avatar trigger (replaces the email-text button).
// Initials derived from the email local part; background color
// from a stable hash of the user_id so the same user always
// sees the same color across sessions. No external API call
// (Gravatar / ui-avatars) — keeps the page offline-friendly
// and avoids a 3rd-party privacy hop.
const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-lime-500',
  'bg-emerald-500',
  'bg-cyan-500',
  'bg-blue-500',
  'bg-violet-500',
] as const;

function hashUserId(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h << 5) - h + userId.charCodeAt(i);
    h |= 0; // force to 32-bit
  }
  return Math.abs(h);
}

function getAvatarColor(userId: string): string {
  return AVATAR_COLORS[hashUserId(userId) % AVATAR_COLORS.length];
}

function getInitials(email: string): string {
  // e.g. "dingfeng901112@gmail.com" → "D"
  // e.g. "john.doe@example.com"     → "JD"
  const local = email.split('@')[0] || email;
  const parts = local.split(/[._+-]/).filter(Boolean);
  if (parts.length === 0) return (email[0] ?? '?').toUpperCase();
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

function Avatar({
  email,
  userId,
  size = 32,
}: {
  email: string;
  userId: string;
  size?: number;
}) {
  const colorClass = getAvatarColor(userId);
  const initials = getInitials(email);
  return (
    <div
      // Rounded + colored bg + white text + slight shadow. aria-
      // hidden because the email/role/etc. in the dropdown are
      // already announced — the avatar is just a visual trigger.
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-sm ring-1 ring-white/10 ${colorClass}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

function formatRegistrationDate(iso: string, locale: Locale): string {
  // YYYY-MM-DD in the user's chosen locale (zh-CN or ja-JP).
  const d = new Date(iso);
  return d.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Header identity widget.
 *
 * - Logged out: simple "登录" link.
 * - Logged in: avatar trigger (Frank #7323 — replaces the email-
 *   text button). Click opens a profile menu with:
 *     • large avatar + email + role badge
 *     • user_id with one-click copy
 *     • registration date (from auth.user.created_at)
 *     • sign-out
 *   Locale is read from the `lifeframe-locale` cookie directly
 *   (the parent layout doesn't pass it down to this client
 *   component) and re-read on every open so the dropdown stays
 *   in sync with the LanguageSwitcher.
 *
 * Theme note: dark-only dropdown styling (matches the original
 * comment). Email + role colors are still dark-mode-tuned.
 */
export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userCreatedAt, setUserCreatedAt] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [locale, setLocale] = useState<Locale>('zh');
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Sync the dropdown's locale with the LanguageSwitcher.
  // Re-read on every open (cheap — single regex match) so the
  // user sees the labels flip after they pick a new language
  // and re-open the menu.
  useEffect(() => {
    if (!open) return;
    const match = document.cookie.match(/(?:^|;\s*)lifeframe-locale=(zh|ja)/);
    if (match) setLocale(match[1] as Locale);
  }, [open]);

  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null;
    let mounted = true;
    const applyUser = (u: User | null) => {
      if (!mounted) return;
      setEmail(u?.email ?? null);
      setUserId(u?.id ?? null);
      setUserCreatedAt(u?.created_at ?? null);
      // Supabase types app_metadata as a free-form record; narrow
      // to the shape we actually use (role) at the read site.
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
      window.prompt(t(locale, 'auth.copy'), userId);
    }
  }

  if (loading) {
    return <span className="text-xs text-white/30">…</span>;
  }

  if (!email) {
    return (
      <Link
        href="/login"
        className="text-sm text-white/60 transition hover:text-white"
      >
        {t(locale, 'auth.login')}
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
        aria-label={t(locale, 'auth.userMenu')}
        className="flex items-center gap-1.5 rounded-full focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
      >
        {userId && <Avatar email={email} userId={userId} />}
        <span aria-hidden="true" className="text-xs text-white/50">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t(locale, 'auth.userMenu')}
          className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-white/10 bg-[var(--bg-elevated)] p-3 text-xs shadow-2xl backdrop-blur-sm"
        >
          {/* Avatar + email + role badge */}
          <div className="mb-3 flex items-center gap-3">
            {userId && <Avatar email={email} userId={userId} size={40} />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-white/85">
                {email}
              </div>
              {role && (
                <span
                  className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    role === 'admin'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-cyan-500/20 text-cyan-300'
                  }`}
                >
                  {role}
                </span>
              )}
            </div>
          </div>

          {/* user_id with one-click copy (Frank #7117 #5) */}
          <div className="mb-2 rounded border border-white/10 bg-black/30 p-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-white/40">
              {t(locale, 'auth.userId')}
            </div>
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
                {copied ? t(locale, 'auth.copied') : t(locale, 'auth.copy')}
              </button>
            </div>
          </div>

          {/* Registration date (Frank #7323) — from
              auth.user.created_at. The Supabase Auth response
              already includes this; we just surface it. */}
          {userCreatedAt && (
            <div className="mb-3 rounded border border-white/10 bg-black/30 p-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-white/40">
                {t(locale, 'auth.registrationDate')}
              </div>
              <div className="font-mono text-[11px] text-white/70">
                {formatRegistrationDate(userCreatedAt, locale)}
              </div>
            </div>
          )}

          {/* Sign-out */}
          <button
            type="button"
            onClick={signOut}
            disabled={pending}
            className="w-full rounded border border-white/15 px-3 py-1.5 text-center text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
          >
            {pending ? t(locale, 'auth.signingOut') : t(locale, 'auth.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
