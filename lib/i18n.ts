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
  // Frank #0906 round-13 (P1 #6): search results dropdown copy
  // — clear button, match counter, no-results state, "more
  // results below the fold" hint.
  'search.clear': {
    zh: '清除搜索',
    ja: '検索をクリア',
  },
  'search.resultsLabel': {
    zh: '匹配结果',
    ja: '一致した写真',
  },
  'search.noResults': {
    zh: '没有找到匹配 "{query}" 的照片',
    ja: '「{query}」に一致する写真は見つかりません',
  },
  'search.clearAndBrowse': {
    zh: '清除并浏览全部',
    ja: 'クリアして全て表示',
  },
  'search.moreHint': {
    zh: '还有 {count} 张匹配照片，已过滤到 Globe 标记上',
    ja: '残り {count} 枚の一致写真は地球儀マーカーに表示中',
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
  // Frank #0906 round-13 (P1 #8): new footer copy.
  'footer.brand.title': {
    zh: '用照片，留下生活的痕迹',
    ja: '写真で、暮らしの痕跡を残す',
  },
  'footer.brand.subtitle': {
    zh: '私人照片地图 · 3D 地球仪 + 时间轴 + EXIF 自动整理',
    ja: 'プライベート写真地図 · 3D 地球儀 + タイムライン + EXIF 自動整理',
  },
  'footer.sources': {
    zh: '源代码',
    ja: 'ソースコード',
  },
  'footer.privacy.icon': {
    zh: '🔒',
    ja: '🔒',
  },
  'footer.privacy.tooltip': {
    zh: '位置数据默认移除。如需保留，勾选「保留原图 EXIF GPS 坐标」即可。',
    ja: '位置情報はデフォルトで削除されます。保持したい場合は「元画像の EXIF GPS 座標を保持」にチェック。',
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

  // ─── Photo detail viewer (Frank #7509) ──────────────────────
  'viewer.label': {
    zh: '照片详情查看器',
    ja: '写真ビューア',
  },
  'viewer.close': {
    zh: '关闭',
    ja: '閉じる',
  },
  'viewer.prev': {
    zh: '上一张',
    ja: '前の写真',
  },
  'viewer.next': {
    zh: '下一张',
    ja: '次の写真',
  },
  'viewer.like': {
    zh: '点赞',
    ja: 'いいね',
  },
  'viewer.unlike': {
    zh: '取消点赞',
    ja: 'いいねを取り消す',
  },
  'viewer.likeSignInHint': {
    zh: '登录后点赞',
    ja: 'ログインしていいね',
  },
  'viewer.comments': {
    zh: '评论',
    ja: 'コメント',
  },
  'viewer.noComments': {
    zh: '还没有评论',
    ja: 'まだコメントはありません',
  },
  'viewer.loading': {
    zh: '加载中…',
    ja: '読み込み中…',
  },
  'viewer.you': {
    zh: '你',
    ja: 'あなた',
  },
  'viewer.delete': {
    zh: '删除',
    ja: '削除',
  },
  'viewer.commentPlaceholder': {
    zh: '写下你的评论…',
    ja: 'コメントを書く…',
  },
  'viewer.commentSignInHint': {
    zh: '登录后可以发表评论。',
    ja: 'ログインするとコメントできます。',
  },
  'viewer.post': {
    zh: '发布',
    ja: '投稿',
  },
  'viewer.posting': {
    zh: '发布中…',
    ja: '投稿中…',
  },
  'viewer.unableToLoad': {
    zh: '无法加载照片',
    ja: '写真を読み込めません',
  },
  'viewer.retry': {
    zh: '重试',
    ja: '再試行',
  },
  // Frank #0903 doc/0903.md — Action Bar replaces the old ⋯ overflow
  // menu. 3 equal-weight buttons (Like / View Original / Share). No
  // media-query hack; "查看原图"/"原图" swap per breakpoint via
  // Tailwind responsive classes.
  'viewer.actions': {
    zh: '照片操作',
    ja: '写真アクション',
  },
  'viewer.viewOriginal': {
    zh: '查看原图',
    ja: '原画を見る',
  },
  'viewer.viewOriginalShort': {
    zh: '原图',
    ja: '原画',
  },
  'viewer.share': {
    zh: '分享',
    ja: '共有',
  },
  'viewer.copied': {
    zh: '✓ 已复制',
    ja: '✓ コピー済み',
  },
  // Frank #0906 round-13: visitor welcome banner copy. Shown
  // once on the home page for un-authenticated visitors who
  // haven't dismissed it.
  'welcome.aria': {
    zh: 'LifeFrame 欢迎横幅',
    ja: 'LifeFrame ウェルカムバナー',
  },
  'welcome.message': {
    zh: 'LifeFrame 是一张私人照片地图——按时间和地点，把你的生活故事画在地球上。',
    ja: 'LifeFrame はプライベート写真地図。時間と場所で、あなたの暮らしを地球に描く。',
  },
  'welcome.messageShort': {
    zh: '把生活画在地球上的私人照片地图',
    ja: '暮らしを地球に描くプライベート写真地図',
  },
  'welcome.cta': {
    zh: '开始记录',
    ja: '記録を始める',
  },
  'welcome.dismiss': {
    zh: '关闭',
    ja: '閉じる',
  },
  // Frank #0906 round-13: OnboardingFlow 3-step tour copy
  // for signed-in first-time users. P0 #4 — previously the
  // tour was hard-coded Chinese only, so a Japanese-locale
  // visitor signing in saw Chinese copy. Now it follows the
  // site-wide locale.
  'onboarding.tag': {
    zh: '首次使用引导',
    ja: 'はじめての案内',
  },
  'onboarding.step': {
    zh: '{current}/3',
    ja: '{current}/3',
  },
  'onboarding.step1.title': {
    zh: '📤 上传第一张照片',
    ja: '📤 最初の写真をアップロード',
  },
  'onboarding.step1.body': {
    zh: '上传页面支持批量（最多 30 张），自动读取 EXIF 中的拍摄时间、GPS 和相机型号。所有照片默认「私密」，只有登录后才能查看。',
    ja: 'アップロードページは一括対応（最大 30 枚）。EXIF の撮影時刻・GPS・カメラ情報を自動読み取り。写真はすべてデフォルトで「非公開」、ログイン後にのみ閲覧可能。',
  },
  'onboarding.step1.cta': {
    zh: '去上传',
    ja: 'アップロードへ',
  },
  'onboarding.step2.title': {
    zh: '📍 选择是否保留位置',
    ja: '📍 位置情報を残すか選択',
  },
  'onboarding.step2.body': {
    zh: '默认会上传时清除原图 EXIF 中的 GPS 坐标（保护隐私）。如果想保留拍摄位置，勾选「保留原图 EXIF GPS 坐标」即可。',
    ja: 'デフォルトではアップロード時に EXIF の GPS 座標を削除（プライバシー保護）。撮影位置を残したい場合は「元画像の EXIF GPS 座標を保持」にチェック。',
  },
  'onboarding.step3.title': {
    zh: '🌍 生成时间线 + 地图',
    ja: '🌍 タイムライン + 地図を生成',
  },
  'onboarding.step3.body': {
    zh: '上传完成后地球仪点亮照片位置，时间轴标记拍摄时间。试试「▶ 时间旅行」按年月重看，「🌏 人生足迹」按地点重看。',
    ja: 'アップロード完了後、地球儀に写真の位置が灯り、タイムラインに撮影時刻が並びます。「▶ タイムトラベル」で年月順に、「🌏 人生の軌跡」で場所順に再生できます。',
  },
  'onboarding.skip': {
    zh: '跳过',
    ja: 'スキップ',
  },
  'onboarding.next': {
    zh: '知道了',
    ja: '了解',
  },
  // Frank #0906 round-13 (P0 #4 cont.): welcome page i18n.
  // Previously hard-coded Chinese only — now matches locale.
  'welcome.tagline': {
    zh: '个人照片生活记录与时空记忆展示网站。3D 地球仪 + 时间轴 + EXIF 自动读取，把你的照片按时间和空间重新组织成可探索的「生活博物馆」。',
    ja: '個人の写真で暮らしと時空の記録を残すサイト。3D 地球儀 + タイムライン + EXIF 自動解析で、写真を時と場所で再構成し、探索できる「暮らしの博物館」に。',
  },
  'welcome.hero.eyebrow': {
    zh: 'Personal photo journal',
    ja: 'Personal photo journal',
  },
  'welcome.hero.title': {
    zh: '用照片，留下生活的痕迹',
    ja: '写真で、暮らしの痕跡を残す',
  },
  'welcome.hero.subtitle': {
    zh: '写真で、暮らしの軌跡を残す',
    ja: '写真で、暮らしの軌跡を残す',
  },
  'welcome.intro.p1': {
    zh: 'LifeFrame 是一个个人照片生活记录与时空记忆展示网站。把你的照片按时间和空间重新组织成可探索的「生活博物馆」。',
    ja: 'LifeFrame は個人の写真で暮らしと時空の記録を残すためのサイトです。写真を時間と空間で再構成し、探索できる「暮らしの博物館」にします。',
  },
  'welcome.intro.p2': {
    zh: '不是传统的瀑布流相册。是一颗会慢慢自转的 3D 地球仪、一条像播放器进度条一样的时间轴，以及一张「今天历史上」卡片。',
    ja: '従来のギャラリーではありません。ゆっくり自転する 3D 地球儀、再生バーのようなタイムライン、「今日の歴史」カードで構成されています。',
  },
  'welcome.features.heading': {
    zh: '核心功能',
    ja: '主な機能',
  },
  'welcome.features.globe.title': {
    zh: '🌍 3D 地球仪',
    ja: '🌍 3D 地球儀',
  },
  'welcome.features.globe.body': {
    zh: '每张照片按 GPS 投射到地球仪上。点击照片点进入详情。多张照片在同一位置会聚合成「集群」数字徽章，可一键展开查看。',
    ja: '各写真を GPS で地球儀上に投影。写真マスをクリックすると詳細へ。同地点の複数写真は「クラスタ」数字バッジに集約され、ワンクリックで展開できます。',
  },
  'welcome.features.timeline.title': {
    zh: '⏳ 时间轴',
    ja: '⏳ タイムライン',
  },
  'welcome.features.timeline.body': {
    zh: '一条从 1990 到现在的进度条。每张照片是一个章节标记。拖动筛选 ±30 天的地球仪照片，像播放器一样「拖动滑块」。',
    ja: '1990 年から現在までの進行バー。各写真がチャプターマーク。「スライダーをドラッグ」する感覚で ±30 日の地球儀写真を絞り込めます。',
  },
  'welcome.features.onthisday.title': {
    zh: '📅 On This Day',
    ja: '📅 On This Day',
  },
  'welcome.features.onthisday.body': {
    zh: '「今天历史上」——显示去年、前年拍的同一天照片。最适合每年生日/纪念日翻开看。',
    ja: '「今日の歴史」── 去年、一昨年の同じ日に撮った写真を表示。誕生日や記念日に毎年めくるのに最適。',
  },
  'welcome.features.exif.title': {
    zh: '📷 EXIF 自动',
    ja: '📷 EXIF 自動解析',
  },
  'welcome.features.exif.body': {
    zh: '上传自动读取拍摄时间、GPS、相机型号。没有 GPS 的老照片也能手动选地点（地图选点 / 使用当前位置）。',
    ja: 'アップロード時に撮影時刻・GPS・カメラ機種を自動読み取り。GPS のない古い写真も、手動で地点を選べます（地図で選択 / 現在地を使用）。',
  },
  'welcome.features.tags.title': {
    zh: '🏷️ 多标签分类',
    ja: '🏷️ 複数タグ分類',
  },
  'welcome.features.tags.body': {
    zh: '人物 / 风景等分类多选。所有照片上传后都能重新组织。',
    ja: '人物 / 風景など複数カテゴリで選択可能。アップロード後も全写真を再整理できます。',
  },
  'welcome.features.private.title': {
    zh: '🔒 私人默认',
    ja: '🔒 デフォルト非公開',
  },
  'welcome.features.private.body': {
    zh: '所有照片默认私人（登录才能看）。后续会加公开/私密切换，让你能把精选的旅行照片分享给朋友。',
    ja: '写真はすべてデフォルト非公開（ログイン後に閲覧可）。今後 公開 / 非公開の切替を追加し、選り抜きの旅行写真を友人と共有できるようにします。',
  },
  'welcome.cta.hint': {
    zh: '邮箱 + 密码注册。或直接以游客模式浏览地球仪上的公开风景照。',
    ja: 'メール + パスワードで登録。 またはゲストモードで地球儀上の公開風景写真をそのまま閲覧できます。',
  },
  'welcome.cta.primary': {
    zh: '登录 / 注册 →',
    ja: 'ログイン / 登録 →',
  },
  'welcome.cta.secondary': {
    zh: '🌍 游客模式浏览',
    ja: '🌍 ゲストモードで見る',
  },
  'welcome.footer.tagline': {
    zh: '个人照片生活记录与时空记忆展示网站。',
    ja: '個人の写真で暮らしと時空の記録を残すサイト。',
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
