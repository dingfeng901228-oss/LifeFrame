// Frank #7304: site-wide i18n for Chinese + Japanese.
//
// This file is the SHARED (non-server) portion: translation dict +
// LOCALES list + t() helper + Locale type. Safe to import from
// client components (HomeGallery, OnboardingFlow, etc.) — no
// next/headers / cookies() import here.
//
// Server-only getLocale() lives in lib/i18n-server.ts so it
// isn't pulled into the client bundle. Server components import
// both this file and lib/i18n-server.ts; client components
// import only this file.

export type Locale = 'zh' | 'ja';

export const DEFAULT_LOCALE: Locale = 'zh';
export const COOKIE_NAME = 'lifeframe-locale';

export const LOCALES: Array<{ code: Locale; label: string }> = [
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
];

type Dict = Record<string, Record<Locale, string>>;

// Translation table. Keys are dotted paths (section.field).
// Missing translations fall back to Chinese (the original
// language of this codebase), then to the key itself, then to
// an empty string — so a typo'd key is visible rather than
// silently producing "undefined" or "null".
const dict: Dict = {
  // ─── Header / nav ─────────────────────────────────────────────
  'nav.start': {
    zh: '开始记录',
    ja: '記録を始める',
  },

  // ─── Hero (HomeGallery) ───────────────────────────────────────
  'hero.japaneseSubtitle': {
    zh: '写真で、暮らしの軌跡を残す',
    ja: '写真で、暮らしの軌跡を残す',
  },
  'hero.title': {
    zh: '用照片，留下生活的痕迹。',
    ja: '写真で、暮らしの痕跡を残す。',
  },
  'hero.subtitle.loading': {
    zh: '加载中…',
    ja: '読み込み中…',
  },
  'hero.subtitle.empty': {
    zh: '首页 3D 地球仪 — 上传第一张照片点亮地点',
    ja: '3D 地球儀 — 最初の写真をアップロードして地点を灯す',
  },
  // {count} placeholder — replaced at call site via t(locale, key, { count: n }).
  'hero.subtitle.countNoFilter': {
    zh: '{count} 张照片已点亮地点',
    ja: '{count} 枚の写真を地点に表示',
  },
  'hero.cta.primary': {
    zh: '开始创建我的 LifeFrame',
    ja: 'LifeFrame を作り始める',
  },
  'hero.cta.secondary': {
    zh: '先看看它如何工作',
    ja: '仕組みを見る',
  },
  'hero.searchPlaceholder': {
    zh: '🔍 搜索照片 (文件名 / 地点 / 分类)...',
    ja: '🔍 写真を検索 (ファイル名 / 場所 / カテゴリー)...',
  },
  // aria-label on the search input — same as placeholder minus the icon.
  'hero.searchAriaLabel': {
    zh: '搜索照片 (文件名 / 地点 / 分类)',
    ja: '写真を検索 (ファイル名 / 場所 / カテゴリー)',
  },
  'hero.onThisDay': {
    zh: '📅 历史上这一天',
    ja: '📅 历史上的この日',
  },
  'hero.timeTravel': {
    zh: '▶ 时间旅行 · Explore My Life',
    ja: '▶ タイムトラベル · Explore My Life',
  },
  'hero.lifeJourney': {
    zh: '🌏 人生足迹 · Life Journey',
    ja: '🌏 人生の軌跡 · Life Journey',
  },
  'hero.fetchError': {
    zh: '加载照片失败：',
    ja: '写真の読み込みに失敗：',
  },
  'hero.fetchErrorHint': {
    zh: '检查 Supabase URL/anon key 是否在 Vercel Environment Variables 配齐。',
    ja: 'Supabase URL/anon key が Vercel の環境変数に設定されているか確認してください。',
  },

  // ─── Features section (app/page.tsx) ─────────────────────────
  'features.eyebrow': {
    zh: 'Features',
    ja: '特徴',
  },
  'features.heading': {
    zh: '三项核心能力',
    ja: '3つのコア機能',
  },
  'features.timeTravel.title': {
    zh: '时间旅行',
    ja: 'タイムトラベル',
  },
  'features.timeTravel.body': {
    zh: '按年月重看生活的片段。',
    ja: '年月単位で人生のひとコマを振り返る。',
  },
  'features.lifeJourney.title': {
    zh: '人生足迹',
    ja: '人生の軌跡',
  },
  'features.lifeJourney.body': {
    zh: '将照片中的地点汇成一张专属地图。',
    ja: '写真の中の場所をひとつの専有マップに。',
  },
  'features.autoOrganize.title': {
    zh: '照片自动整理',
    ja: '写真を自動で整理',
  },
  'features.autoOrganize.body': {
    zh: '读取拍摄时间与地点，减少手动分类。',
    ja: '撮影日時と場所を読み取って、手動の分類を減らす。',
  },

  // ─── Footer (app/page.tsx) ───────────────────────────────────
  'footer.copyright': {
    zh: '© 2026 Frank Ding · LifeFrame',
    ja: '© 2026 Frank Ding · LifeFrame',
  },
  'footer.siteUrl': {
    zh: 'lifeframe.frank2025.com',
    ja: 'lifeframe.frank2025.com',
  },
  'footer.productIntro': {
    zh: '产品介绍',
    ja: '製品紹介',
  },
  'footer.contactDev': {
    zh: '联系开发者',
    ja: '開発者に連絡',
  },
  'footer.tagline': {
    zh: '位置数据可选择保留或移除',
    ja: '位置データは保持・削除を選択可能',
  },

  // ─── Language switcher ───────────────────────────────────────
  'language.switcherLabel': {
    zh: '选择语言',
    ja: '言語を選択',
  },

  // ─── Auth button + profile menu (Frank #7323) ───────────────
  'auth.login': {
    zh: '登录',
    ja: 'ログイン',
  },
  'auth.userMenu': {
    zh: '用户菜单',
    ja: 'ユーザーメニュー',
  },
  'auth.userId': {
    zh: '用户 ID',
    ja: 'ユーザー ID',
  },
  'auth.copy': {
    zh: '复制',
    ja: 'コピー',
  },
  'auth.copied': {
    zh: '已复制',
    ja: 'コピー済み',
  },
  'auth.registrationDate': {
    zh: '注册日期',
    ja: '登録日',
  },
  'auth.signOut': {
    zh: '登出',
    ja: 'サインアウト',
  },
  'auth.signingOut': {
    zh: '退出中…',
    ja: 'サインアウト中…',
  },
};

export function t(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let str = dict[key]?.[locale] ?? dict[key]?.zh ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}
