'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

const STORAGE_KEY = 'lifeframe-onboarded';

type Step = 1 | 2 | 3;

const STEPS: Array<{
  title: string;
  body: string;
  cta?: { label: string; href: string };
}> = [
  {
    title: '📤 上传第一张照片',
    body: '上传页面支持批量（最多 30 张），自动读取 EXIF 中的拍摄时间、GPS 和相机型号。所有照片默认「私密」，只有登录后才能查看。',
    cta: { label: '去上传', href: '/admin/upload' },
  },
  {
    title: '📍 选择是否保留位置',
    body: '默认会上传时清除原图 EXIF 中的 GPS 坐标（保护隐私）。如果想保留拍摄位置，勾选「保留原图 EXIF GPS 坐标」即可。',
  },
  {
    title: '🌍 生成时间线 + 地图',
    body: '上传完成后地球仪点亮照片位置，时间轴标记拍摄时间。试试「▶ 时间旅行」按年月重看，「🌏 人生足迹」按地点重看。',
  },
];

/**
 * First-time login onboarding flow (Task 5 of 优化需求.docx).
 *
 * "登录后第一次进入产品，使用三步引导：
 *  1. 上传照片；
 *  2. 选择是否保留拍摄位置；
 *  3. 生成时间线与地图。"
 *
 * Triggers the first time a signed-in user lands on any page (per
 * the doc, after they sign in they bounce back to / which mounts
 * this component via the root layout). Once dismissed — either via
 * "知道了", "跳过", or clicking through the step-1 CTA to upload
 * — the dismissal is persisted in localStorage so subsequent
 * sign-ins don't re-trigger it.
 *
 * localStorage (not a DB column) is intentional: this is a UX
 * tutorial, not a security boundary; per-device / per-browser
 * dismissal is the right semantics. If Frank clears browser data
 * the tour shows again — that's the natural reset behavior.
 *
 * The component is always mounted (in app/layout.tsx) but renders
 * nothing until both conditions are met:
 *   - session is present (any user, not just admin)
 *   - localStorage key is absent
 */
export function OnboardingFlow() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(STORAGE_KEY) === 'true') return;
    let mounted = true;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        if (data.session?.user) setOpen(true);
      } catch {
        // Env not configured or session check failed — don't show
        // the tour; the rest of the app handles that case via its
        // own error states.
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function persistDismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // localStorage disabled (private mode, quota, etc.) — best
      // effort; the tour will show again on next mount, which is
      // the least-bad fallback.
    }
  }

  function skip() {
    persistDismiss();
    setOpen(false);
  }

  function next() {
    if (step < 3) {
      setStep((s) => (s + 1) as Step);
    } else {
      persistDismiss();
      setOpen(false);
    }
  }

  if (!open) return null;

  const current = STEPS[step - 1];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-lg border border-cyan-500/40 bg-[var(--bg-elevated)] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between text-xs">
          <span className="text-white/50">首次使用引导</span>
          <span className="tabular-nums text-white/40" aria-hidden="true">
            {step}/3
          </span>
        </div>
        <h2
          id="onboarding-title"
          className="text-lg font-medium text-white"
        >
          {current.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/70">
          {current.body}
        </p>

        {/* Step progress dots — presentational; the dialog's title
            and the numeric "1/3" already announce step transitions. */}
        <div
          className="mt-5 flex items-center gap-1.5"
          role="presentation"
          aria-hidden="true"
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-cyan-400' : 'bg-white/15'
              }`}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={skip}
            className="text-xs text-white/40 underline transition hover:text-white/70"
          >
            跳过
          </button>
          <div className="flex gap-2">
            {step === 1 && current.cta && (
              <Link
                href={current.cta.href}
                onClick={skip}
                className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/80 transition hover:border-white/40 hover:text-white"
              >
                {current.cta.label} →
              </Link>
            )}
            <button
              type="button"
              onClick={next}
              className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-black transition hover:bg-cyan-300"
            >
              {step < 3 ? '下一步' : '知道了'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}