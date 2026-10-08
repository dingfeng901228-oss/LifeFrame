'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { t, type Locale } from '@/lib/i18n';

// Frank #0906 round-14 (Batch D): extracted to its own file so the
// server-side page.tsx can read cookies() via i18n-server while
// this client component keeps the useState/useRouter/useSupabase
// bits the form needs. Server components can't import this file.

function LoginInner({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Frank #7108 #5: re-entry guard so a double-click mid-await
    // doesn't double-fire the auth call or double-push.
    if (pending) return;
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push('/');
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage(
          locale === 'ja'
            ? '確認メールを送信しました。受信箱を確認してください。'
            : '已发送确认邮件，请查收邮箱。',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-2xl font-light text-black dark:text-white">
        {mode === 'signin' ? t(locale, 'login.title.signIn') : t(locale, 'login.title.signUp')}
      </h1>
      <p className="mt-2 text-sm text-black/70 dark:text-white/70">
        {t(locale, 'login.subtitle')}
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="block text-xs text-black/70 dark:text-white/70">{t(locale, 'login.field.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="mt-1 block w-full rounded border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/5 px-3 py-2 text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 focus:border-black/40 dark:focus:border-white/40 focus:outline-none"
            placeholder="you@example.com"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-black/70 dark:text-white/70">{t(locale, 'login.field.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="mt-1 block w-full rounded border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/5 px-3 py-2 text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 focus:border-black/40 dark:focus:border-white/40 focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        {message && <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
        <button
          type="submit"
          disabled={pending}
          className="block w-full rounded bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/90 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {pending ? t(locale, 'login.submit.pending') : mode === 'signin' ? t(locale, 'login.submit.signIn') : t(locale, 'login.submit.signUp')}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-black/70 dark:text-white/70">
        {mode === 'signin' ? t(locale, 'login.toggle.toSignup') : t(locale, 'login.toggle.toSignin')}
        {' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setMessage(null);
          }}
          className="text-sky-700 underline dark:text-sky-300"
        >
          {mode === 'signin' ? t(locale, 'login.toggle.cta.signUp') : t(locale, 'login.toggle.cta.signIn')}
        </button>
      </p>
    </div>
  );
}

export default function LoginForm({ locale }: { locale: Locale }) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-sm px-6 py-16 text-black/40 dark:text-white/40">
          {locale === 'ja' ? '読み込み中…' : '加载中…'}
        </div>
      }
    >
      <LoginInner locale={locale} />
    </Suspense>
  );
}