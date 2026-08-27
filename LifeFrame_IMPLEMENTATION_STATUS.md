# LifeFrame — PRD 实现状态

> 追踪每个 PRD 章节的实现状态。
> 对应源 PRD：`LifeFrame_要件定義書.md`
> 最后更新：2026-08-27

## 状态图例

- ✅ **完成** — 已上线，commit 已 push 到 main
- ⏳ **部分** — 部分实现 / 待 polish
- 🚧 **未开始** — backlog 中
- ❌ **不适用 / 延后** — 不在本期范围

---

## §4 首页设计 → ✅

Globe + Timeline + Photos 三件套联动。
- commit 55964c2 — Globe/Timeline/HomeGallery headline 加 `dark:` variants
- §17/§18 增量 — On This Day / Time Travel / Life Journey 三个 modal/overlay

## §5 3D 地球仪 → ✅

`components/Globe.tsx` — 全屏正交投影 d3-geo + Globe.gl 风格 cyan markers。
- commit d420652 — 重设计成铺满 viewport
- commit 20c76a2 — 去掉 pause/continue 按钮，点空白地球切换自转
- commit 3b5435c — cluster 点击打开 photo modal（不再只是 zoom）
- commit 55964c2 — `dark:` variants
- commit 26031f4 — `React.memo` wrap + `useCallback` handlers + TimeTravel tick 100ms→200ms（5fps 抖动优化）

## §6 时间轴 → ✅

`components/Timeline.tsx` — 单条进度条 + 可拖动 knob + 章节标记 + 缩略图 popup。
- commit 1e11345 — 重设计成播放器风格单线

## §7 时间与空间联动 → ✅

`Timeline.onChange` → `HomeGallery.setSelectedDate` → `visiblePhotos` useMemo 过滤 → `markers` useMemo → `Globe`。跨多个 commit 逐步实现，无单一 commit。

## §8 照片管理 → ✅

`app/upload/page.tsx` — 上传 form（早期 commit，photo website 阶段之前）

## §9 照片分类 → ✅

`photos.categories` 数组列 + HomeGallery filter logic（search 复用 categories 字段）

## §10 照片拍摄时间 → ✅

`photos.taken_at` 字段 + EXIF `DateTimeOriginal` 提取

## §11 照片拍摄地点 → ✅

`photos.location_name` + lat/lng + Nominatim 反查

## §12 无地理位置照片 → ✅

无 lat/lng 的照片不出现在 Globe，但仍在 On This Day / Time Travel / 照片搜索

## §13 EXIF 处理 → ✅

客户端 EXIF 读取（时间 / GPS / 相机）+ 服务器端 `sharp` 缩略图生成
- commit 95444fa — server-side thumbnail generation (256×256 webp)
- commit b3fdd4f — `chore(deps)` 加 `sharp` + .gitignore hygiene

## §14 照片详情页 → ✅

HomeGallery 的 photo detail modal：filename / taken_at / location / camera / categories / 链接。
- commit 68ff56c — ESC cascade 通过所有 3 modal（detail → on-this-day → cluster）

## §15 照片浏览 → ⏳

- ✅ **Grid View** — implicit via detail modal 缩略图
- 🚧 **Timeline View** — 按月份分组瀑布流页面，未实现

## §16 分类筛选 → ⏳

- ✅ **Search input** — 覆盖 filename / location_name / categories（commit e0af87a）
- 🚧 **显式分类筛选 UI** — P1 标签按钮组未做

## §17 人生足迹 → ✅

`components/LifeJourney.tsx` — hierarchical Country → City 面板，按 taken_at 排序 + 按连续 location_name 分组。
- commit 013a551
- onSelectEntry → 设 selectedDate 到 midpoint → Globe + Timeline 同步

## §18 时间旅行模式 → ✅

`components/TimeTravel.tsx` — full-screen overlay，rAF 推进 currentDate，1×/2×/4×/8× 速度切换，ESC 退出，空格暂停，restart 按钮。
- commit f83d8e5 — 初次实现
- commit 26031f4 — Globe memo + 5fps 抖动优化

## §19 On This Day → ✅

HomeGallery `onThisDayGrouped` useMemo + modal：today month-day 在历史上任意年份的匹配，按 year 分组瀑布流。
- commit 68ff56c — ESC cascade fix

## §20 数据模型 → ✅

Supabase `photos` 表：key / public_url / thumbnail_url / filename / taken_at / lat / lng / location_name / camera_make / camera_model / categories / visibility。

## §21 推荐技术架构 → ✅

Next.js 15 + React 19 + TypeScript + Tailwind v4 + Supabase + Cloudflare R2 + `sharp` + 自绘 SVG + Web Speech API。

## §22 图片存储 → ✅

Cloudflare R2（object storage），不在数据库存图。

## §23 图片处理 → ✅

服务器端 `sharp` 生成 256×256 webp 缩略图（commit 95444fa + b3fdd4f）

## §24 隐私设计 → ✅

`visibility: private | unlisted | public`
- commit 4180118 — /p/[key] public page + dynamic sitemap + JSON-LD
- private 照片 404 via Supabase RLS（anon key 不能 SELECT private）
- 公开页面只显示 `location_name`（城市），不暴露具体 lat/lng

## §25 UI 视觉方向 → ✅

Minimal / Quiet / Personal / Editorial / Memory。
- 黑白主色 + cyan accent
- 大留白 + 小字号 + 极少按钮
- 照片为主视觉，地球仪为核心

## §26 第一阶段 MVP → ✅

全部 11 个 P0 功能完成（登录 / 上传 / EXIF / 时间 / 地点 / 分类 / Globe / Timeline / 联动 / 点击查看 / 详情）

## §28 第三阶段 AI → 🚧

按 PRD §28 明确延后到 Phase 3，本期不实现。

## §29 最终产品结构 → ✅

3D Globe + Timeline + Photos + Categories → Memory 完整产品定位成立。

---

## Theme 系统（额外，不在 PRD 章节内）

- commit d5806b7 — `ThemeToggle`（Light / Dark / System）+ CSS variables + anti-FOUC bootstrap
- commit 55964c2 — Globe/Timeline/HomeGallery headline `dark:` variants
- commit 273f6c1 — 4 个 page.tsx（welcome/login/upload/p-key）全 `dark:` variants

---

## 最近 commit 时间线（2026-08-27）

| commit    | 类型    | 说明 |
| --------- | ------- | ---- |
| 26031f4 | perf    | Globe `React.memo` + `useCallback` + TimeTravel 5fps |
| e0af87a | feat    | §27 照片搜索（filename / location_name / categories） |
| 68ff56c | fix     | ESC cascade 通过所有 3 modal |
| 013a551 | feat    | §17 Life Journey panel |
| f83d8e5 | feat    | §18 Time Travel overlay |
| 273f6c1 | feat    | welcome/login/upload/p-key `dark:` variants |
| b3fdd4f | chore   | `sharp` + `.gitignore` hygiene |

---

## 未完成 backlog

### §27 第二阶段扩展
- 🚧 **Timeline View**（新页面 `/timeline`）— 按月份分组瀑布流浏览
- 🚧 **国家 / 城市统计** — analytics page（哪些国家最多 / 时间分布）
- 🚧 **批量编辑** — multi-select + bulk edit location / categories

### §28 第三阶段 AI（明确延后）
- 🚧 自动识别（人物 / 风景 / 建筑 / 美食 / 宠物）
- 🚧 Monthly Memory 自动生成文案

### Polish 项
- ⏳ Globe 5fps during TimeTravel — 性能 vs 平滑度 trade-off
- ⏳ §16 显式分类筛选 UI（目前只能通过 search）
- ⏳ Search 是 client-side filter（limit 500 photos fetch）— 大数据量需 server-side search index
- ⏳ 没有照片删除 UI（PRD §14 提到 Edit/Delete，目前 placeholder）

### 待 review
- 🚧 `需求0827.docx`（2026-08-27 新需求，GBK 编码）— Frank drop 后未读，待 review 决定优先级

---

## 已知 trade-off / 设计决定

1. **TimeTravel 5fps vs 10fps**（commit 26031f4）— 减半 Globe re-render 抖动，动画速度不变。仅在 TimeTravel playback 时生效；其他交互保持 60fps。
2. **Modals 不用 dark: variants** — overlay 设计成 dark backdrop 永远（`bg-black/80 backdrop-blur-sm`），跨 light/dark 不变。
3. **On This Day + Time Travel + Life Journey 用全量 photos** — 不应用 search filter。这些是"全局"特性，按 PRD 设计遍历整个人生。
4. **Search 是 client-side substring** — 简单实现，500 张照片内足够用。规模化需 Postgres GIN index + `ILIKE`。