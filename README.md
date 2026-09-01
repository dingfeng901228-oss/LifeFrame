# LifeFrame

> 用照片，留下生活的痕迹。
> 写真で、暮らしの軌跡を残す。

个人照片生活记录 + 时空记忆展示网站。3D 地球仪 × 时间轴联动，将照片按时间 × 空间 × 分类可视化。

完整产品定义见：[LifeFrame_要件定義書.md](./LifeFrame_要件定義書.md)

## 当前进度

**MVP P0 骨架** —— 跑通最短路径「选择图片 → Cloudflare R2 直接 PUT 成功」。

- `/`：首页空 3D 地球仪（Globe.gl）+ Slogan
- `/upload`：选图 → 客户端向 `POST /api/upload-url` 拿签名 → 直传 R2 → 展示对象 key / 公开 URL

**尚未接入**：登录、EXIF、分类、时间轴、地点聚合、人脸 / 风景、AI。
按 §26 P0 列表逐步推进。

## 技术栈

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 框架 | Next.js 15（App Router）+ React 19 + TypeScript | 和日站同栈，技能复用 |
| 样式 | Tailwind CSS v4 | PostCSS 插件 `@tailwindcss/postcss` |
| 3D | **cobe**（canvas WebGL，零 three.js 依赖） | MVP 「空 Globe」用 cobe；后续接入照片地点后再换 `react-globe.gl` / 自绘 three.js |
| 存储 | Cloudflare R2（S3 兼容） | 签名 URL 直传、不经应用服务器 |
| Auth/DB | Supabase（待接入）| 新开一个 project，只挂对象存储不动 |
| EXIF | exifr | 后续在浏览器侧读 `takenAt / GPS / Make / Model` |

## 起步

### 1. 申请 R2 凭据
1. Cloudflare Dashboard → **R2** → **Create bucket** → 命名（如 `lifeframe-uploads`）
2. 桶 Settings → **Public Access** → 打开 Public URL（拿到 `pub-xxx.r2.dev`）
3. **R2** → **Manage R2 API Tokens** → Create token
   - Permissions: **Object Read & Write**
   - 指定到上一步的 bucket
4. 把以下五个变量填进 `.env.local`：

```
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
R2_BUCKET=lifeframe-uploads
R2_PUBLIC_BASE=https://pub-xxxxxxxxxxxx.r2.dev
```

参考 `.env.example`。

### 2. 安装并启动

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 看首页 Globe；`/upload` 选一张图试整条直传链路。

### 3. 部署
- Vercel / Cloudflare Pages（Next 静态 + Node runtime）
- 把上面 5 个 R2 变量加进部署环境

## 目录

```
app/
  layout.tsx                全局 layout，header + nav
  globals.css               Tailwind v4 入口
  page.tsx                  首页（Globe + Slogan）
  upload/page.tsx           上传页（Server Component）
  upload/UploadForm.tsx     上传表单（Client Component）
  api/upload-url/route.ts   生成 R2 PUT 签名 URL
components/
  Globe.tsx                 cobe（canvas WebGL）的客户端组件（'use client'）
lib/
  r2.ts                     R2 客户端 / 签名 URL 工厂（共享给后续 thumbnails / metadata）
types/
  react-globe.gl.d.ts       模块声明 shim（react-globe.gl 默认导出在严格 TS 下会报错）
public/
```

## 为什么 MVP 用 cobe 而不是 react-globe.gl

- react-globe.gl 在 P0 skeleton 阶段只需要一颗「空地球转」。它依赖 `three-render-objects@1.42`，该版本要求 `three@>=0.179` 来导入新版的 `Timer` 类，但我们项目装的是 `three@0.170`，触发 webpack 的 named export 报错
- cobe 是 Vercel 出品的 4KB WebGL 球体，无 three 依赖，对 React 19 / Next 15 友好，足够应付「空转地球」阶段
- 加照片地点这一步时再换：`react-globe.gl` 或自写 three.js layer（参见要件定義書 §21）

## 下一阶段路线（P0）

1. Supabase Auth 接入 → 用户登录
2. 上传前 `exifr.parse(file)` 读 `takenAt / lat / lng / Make / Model` 写进 metadata
3. 上传成功后写一行到 `photos` 表（user_id / key / taken_at / latitude / longitude / camera_*）
4. 首页 Globe 用 `pointsData` 把照片地点点出来
5. 时间轴基础结构 + 与 Globe 联动
6. 照片详情页 + 编辑地点（GPS / 地图选点 / 当前位置三选一）

## PhotoViewer 手动验证 Checklist

> Photo Detail Viewer（commit `050707c`）已通过 Playwright 自测 12/12，剩 3 项需要人眼/人手感确认。脚本模拟不了。

### 1. 🐢 慢速网络（3G throttle）
- **怎么测**：DevTools → Network → Throttling: **Slow 3G**
- **操作**：点开任意 cluster → 进 viewer → 连续按 → 翻 5 张
- **期望**：
  - 翻页不会卡死（prev/current/next 预加载策略生效）
  - 图片加载失败时出现"重试"按钮（不是空白）
  - `/p/{key}` URL 仍然同步

### 2. 👆 快速连续切换
- **怎么测**：打开 viewer 后 100-200ms 内狂点 → 键（或桌面左右区）
- **操作**：连点 20 次，看会不会跳错 / 卡死 / 计数错位
- **期望**：
  - `transitioningRef` 防 transition 重入工作（不会跳 2 张）
  - 键盘不会把 textarea 评论框的输入抢走
  - like/comment 计数不会被双击 +1

### 3. 📐 Layout Shift 视觉检查
- **怎么测**：DevTools → Performance → 录制 → 在 viewer 里翻 5-10 张
- **操作**：看 Layout Shifts 面板有没有红色 CLS
- **期望**：
  - **0 Shift**（aspect-ratio cache + 容器预留比例生效）
  - controls / position indicator 不抖动

---

## 隐私口径（先在心里挂上）

- 默认私人；公开档位只暴露城市级 GPS，不暴露精确 lat/lng
- `visibility` 字段从一开始进 schema，避免后置补丁
