# LifeFrame — Supabase 数据库恢复手册

> Frank #7243 round-2 · 2026-10-08
>
> **发生了什么（已查实）**：承载 LifeFrame 照片元数据的 Supabase
> 项目 `utikkddqzilphrsszjpw` **被暂停了**（Management API 状态
> `INACTIVE`），不是被删除。免费版项目长期无请求会被自动暂停，
> 暂停后子域名不再解析 DNS —— 所以从外面看像是"消失了"。
>
> **数据从头到尾没有丢**，一行都没少：
>
> | 表 | 行数 |
> |---|---|
> | `photos` | 239 |
> | 其中带 GPS | 207 |
> | `photo_likes` | 5 |
> | `photo_comments` | 0（本来就没有评论）|
>
> **恢复动作**：`POST /v1/projects/{ref}/restore`，约 3.5 分钟
> 走完 COMING_UP → RESTORING → ACTIVE_HEALTHY。
>
> **⚠️ 诊断教训（我踩过的坑）**：**DNS NXDOMAIN 不能用来判断
> 项目是否被删除**。暂停和删除的项目子域名都不解析，看起来完全
> 一样。我一开始据此判定"已删除、数据永久丢失、要从 R2 重建"，
> 全套重建工具链都写好了 —— 结果 Management API 一查是
> `INACTIVE`，一键恢复，239 行连点赞一起全回来了。
>
> **正确顺序**：
> 1. 先用 Management API 查状态（`GET /v1/projects`）—— 这是
>    唯一权威来源
> 2. 只有当目标 ref **完全不在列表里**时，才是真被删了
> 3. `INACTIVE` → `restore`；不在列表 → 走重建流程
>
> **备用重建流程仍然保留**（见下），因为 R2 里的原图带完整
> EXIF（277 张，105 张带 GPS），真被删也能重建出可用的库。
> 但重建会丢失用户**手动指定**的位置（原库 207 张带 GPS，
> EXIF 只能恢复 105 张）和点赞数据 —— 所以**恢复 > 重建**。

---

## 你的操作（只有一步需要你亲自做）

### 第 1 步：创建 personal access token

打开 <https://supabase.com/dashboard/account/tokens> → 新建 token。
**token 只显示一次**，先复制到一个文件里，比如
`C:\Users\Frank\Downloads\sbptoken.txt`。

### 第 2 步：把 token 写进 .env.local

在你自己的终端（Git Bash）里跑这一行 —— 它会读文件、写入
.env.local、然后删掉临时文件：

```bash
cd /f/WebSite/LifeFrame_photo_websit && \
TOKEN=$(cat /c/Users/Frank/Downloads/sbptoken.txt) && \
sed -i "s|^SUPABASE_ACCESS_TOKEN=.*|SUPABASE_ACCESS_TOKEN=$TOKEN|" .env.local && \
rm /c/Users/Frank/Downloads/sbptoken.txt && \
echo "token written"
```

`.env.local` 已被 `.gitignore` 覆盖（`.gitignore:22 .env*`），
token 不会进仓库，也不会被我打印到任何地方。

### 第 3 步：告诉 Frank「好了」

之后剩下的全部由脚本完成。

---

## 之后会发生什么（Frank 执行）

```bash
cd F:/WebSite/LifeFrame_photo_websit

# 1) 诊断：列出你的所有项目 + 目标 ref 的真实状态
node scripts/supabase-recover.mjs diagnose

# 2a) 如果状态是 PAUSED —— 数据完好，一键恢复
node scripts/supabase-recover.mjs restore

# 2b) 如果目标 ref 不在列表里 —— 已被永久删除，走重建
node scripts/supabase-recover.mjs create
node scripts/supabase-recover.mjs schema    # 跑 infra/restore-all.sql
node scripts/supabase-recover.mjs env       # 写回 .env.local 的 URL + key
node scripts/supabase-recover.mjs reindex   # 从 R2 重建 photos 表
```

**顺序不能换**：`env` 必须在 `reindex` 之前 —— reindex 脚本从
`.env.local` 读 `NEXT_PUBLIC_SUPABASE_URL`，不先更新就会打到
已死的旧 ref。

### 最后一步：更新 Vercel 环境变量

在 Vercel 项目 Settings → Environment Variables 里更新三项：

| Key | 值 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<新 ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 新项目的 anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | 新项目的 service_role key |

然后 redeploy。`node scripts/supabase-recover.mjs env` 会把这三项
直接写进本地 `.env.local`（只回显前 6 位），Vercel 上的值需要
Frank 在 dashboard 里手动同步 —— 我没有 Vercel 凭证。

---

## 备用方案（不走脚本）

如果不想用 API，也可以纯手工：

1. Supabase dashboard 新建项目（选 Tokyo 区）
2. SQL Editor → New query → 粘贴 `infra/restore-all.sql` 全文 → Run
3. Project Settings → API → 复制 anon + service_role key
4. 更新 `.env.local` 与 Vercel env
5. `node scripts/reindex-r2-to-supabase.mjs --dry-run` 先看数据摘要，
   去掉 `--dry-run` 正式写入

---

## 防复发

- **给 Supabase 项目开备份**：免费版 0 天备份保留，付费版 7–30 天。
  个人照片库这种"不可再生"的数据，值得每月跑一次：
  ```bash
  npx supabase db dump --db-url "$NEXT_PUBLIC_SUPABASE_URL" -f backup-$(date +%F).sql
  ```
  （或把 R2 的 EXIF 当作事实上的元数据备份 —— 本次就是这样
  救回来的。）
- **改用「暂停」代替「删除」**：暂停的项目数据保留 1 年，可在
  dashboard 一键恢复；删除则是永久的，连备份一起删。
- **别把 Supabase 当唯一真相源**：R2 里的原始文件才是。这次
  元数据全丢但照片全在，就是因为文件本身带 EXIF。
