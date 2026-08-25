# 曦清农业官网 V0.1

曦清农业（XIQING AGRI）的静态官网与公开实验记录入口。

核心原则：事实 > 宣传、实测 > 推测、未知 ≠ 0、设计值 ≠ 实测值、失败数据不删除。

## 技术栈

- Astro
- TypeScript（strict）
- Markdown Content Collections
- 静态生成，媒体 API 由 Cloudflare Worker 运行

媒体上传能力通过 Cloudflare Worker 提供：Worker 负责媒体 API 和 Astro 静态资产，R2 保存图片/视频，D1 保存媒体索引；未绑定这两个资源时，官网仍可作为纯静态站点运行。

## 本地启动

```bash
npm install
npm run dev
```

默认访问 `http://localhost:4321`。

## 构建

```bash
npm run build
```

构建产物位于 `dist/`。

## 本地预览

```bash
npm run preview
```

## 新增实验

1. 优先复制 [`docs/experiment-record-template.md`](docs/experiment-record-template.md) 中的 YAML 模板。
2. 按实验编号保存，例如 `src/content/experiments/t01-002.md`。
3. 更新 frontmatter 与正文；事件、遥测摘要、人工观察、OCR 和媒体都使用同一个 `id` 关联。
4. 未实测的数值字段留空，不要写 `0`。

详情页会自动渲染实验目标、传感器、事件时间线、自动采集摘要、人工观察、植物分析和已确认的图片/视频。

媒体相关文件：

- [`docs/media-storage-convention.md`](docs/media-storage-convention.md)：R2 目录、D1 索引、审核和备份规则。
- [`migrations/0001_experiment_media.sql`](migrations/0001_experiment_media.sql)：D1 媒体索引表。
- [`migrations/0002_media_management.sql`](migrations/0002_media_management.sql)：软删除、恢复和操作审计字段。
- [`wrangler.toml.example`](wrangler.toml.example)：可选独立 Worker 部署的 R2/D1 绑定示例；Pages 生产环境的口令和绑定在 Pages 项目设置中配置。
- `/media-upload`：后台手动上传页面（不出现在公开导航和 sitemap），上传成功后生成可复制的 `media` YAML 字段。
- `/media-manage`：后台管理媒体元数据、审核状态、软删除、恢复和彻底删除（不出现在公开导航和 sitemap）。

实验列表、详情页与 sitemap 会在构建时自动生成。

支持的状态：

- `preparing`：准备中
- `running`：运行中
- `completed`：已完成
- `failed`：未通过
- `paused`：暂停

## 部署到 Cloudflare Pages

代码推送到 GitHub 后，在 Cloudflare Dashboard 中依次进入：

```text
Workers & Pages
→ Create
→ Pages
→ Connect to Git
→ GitHub
→ xiqing-agri-website
```

Cloudflare Pages 配置：

```text
Framework preset: Astro
Build command: npm run build
Build output directory: dist
```

生产环境使用 Cloudflare Pages + Pages Functions：自定义域名、静态官网、媒体 API、R2/D1 绑定和 `MEDIA_UPLOAD_TOKEN` 都在 Pages 项目 `xiqing-agri-website` 的生产设置中维护。之后每次 `git push`，Cloudflare Pages 会自动重新构建和部署。

仓库中的 [`src/worker.ts`](src/worker.ts) 和 [`wrangler.toml`](wrangler.toml) 只是可选的独立 Worker 适配器，不是 `xiqingagri.com` 的生产入口；如果不使用 `workers.dev`，不要在 Worker 服务设置里重复配置媒体口令。

## 绑定域名

首次 Pages 部署成功后：

```text
Pages
→ Custom domains
→ Set up a domain
→ xiqingagri.com
```

若域名 DNS 尚不在 Cloudflare，请以 Cloudflare 当前页面给出的实际 Nameserver 为准，到域名注册商处修改；不要使用示例或猜测的 Nameserver。
