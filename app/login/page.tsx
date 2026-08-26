'use client';

import { Suspense, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        if (mode === 'signin') {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (error) throw error;
          router.push(next);
          router.refresh();
        } else {
          const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${window.location.origin}/login?next=${encodeURIComponent(next)}`,
            },
          });
          if (error) throw error;
          // If email confirmation is disabled in Supabase, session is created
          // immediately and we can redirect. Otherwise prompt user to check mail.
          if (data.session) {
            router.push(next);
            router.refresh();
          } else {
            setMessage('注册成功！请到邮箱点击确认链接后再登录。');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-light text-black dark:text-white">
        {mode === 'signin' ? '登录' : '注册'}
      </h1>
      <p className="mt-2 text-sm text-black/50 dark:text-white/50">
        LifeFrame 私人照片空间。
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="block text-xs text-black/60 dark:text-white/60">邮箱</span>
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
          <span className="block text-xs text-black/60 dark:text-white/60">密码</span>
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
          {pending ? '处理中…' : mode === 'signin' ? '登录' : '注册'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-black/50 dark:text-white/50">
        {mode === 'signin' ? '还没有账号？' : '已有账号？'}{' '}
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
            setMessage(null);
          }}
          className="text-sky-700 underline dark:text-sky-300"
        >
          {mode === 'signin' ? '注册' : '登录'}
        </button>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-sm px-6 py-16 text-black/40 dark:text-white/40">加载中…</div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}