# 曦清农业官网 V0.2

曦清农业（XIQING AGRI）的静态官网、公开实验记录与生产批次追溯入口。

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

1. 日常在 Obsidian 命令面板执行 **气雾培：新建实验记录**（QuickAdd），生成一份本地实验记录；也可以直接调用 `/Users/jim/Documents/自用综合/templates/气雾培-新建实验记录.md`。
2. 完成审核后，把本地记录复制为网站发布副本，例如 `src/content/experiments/t01-002.md`。
3. 更新 frontmatter 与正文；实验内的事件、人工观察、OCR 和媒体使用实验 `id` 关联。若实验对应实际生产批次，另填 `productionBatchId`，不要用实验编号替代生产批次身份。
4. 未实测的数值字段留空，不要写 `0`。

如果暂时不使用 Obsidian，再复制 [`docs/experiment-record-template.md`](docs/experiment-record-template.md) 中的 YAML 模板手动创建文件。网站发布副本按项目文档目录中的 `../文档/13-实验数据录入标准作业流程.md` 检查并推送到 GitHub。

详情页会自动渲染实验目标、传感器、事件时间线、自动采集摘要、人工观察、植物分析和已确认的图片/视频。

媒体相关文件：

- [`docs/media-storage-convention.md`](docs/media-storage-convention.md)：R2 目录、D1 索引、审核和备份规则。
- [`docs/telemetry-data-design.md`](docs/telemetry-data-design.md)：生产事实源、官网公开读模型、测量适用范围和自动采集边界。
- [`migrations/0001_experiment_media.sql`](migrations/0001_experiment_media.sql)：D1 媒体索引表。
- [`migrations/0002_media_management.sql`](migrations/0002_media_management.sql)：软删除、恢复和操作审计字段。
- [`migrations/0003_experiment_data_design.sql`](migrations/0003_experiment_data_design.sql)：D1 公开追溯读模型草案；不包含高频原始遥测，尚未执行。
- [`wrangler.toml.example`](wrangler.toml.example)：可选独立 Worker 部署的 R2/D1 绑定示例；Pages 生产环境的口令和绑定在 Pages 项目设置中配置。
- `/media-upload`：后台手动上传页面（不出现在公开导航和 sitemap），上传成功后生成可复制的 `media` YAML 字段。
- `/media-manage`：后台管理媒体元数据、审核状态、软删除、恢复和彻底删除（不出现在公开导航和 sitemap）。

实验列表、详情页与 sitemap 会在构建时自动生成。

## 产品追溯

- 中文入口：`/trace`、`/trace/{productionBatchId}`；
- 英文入口：`/en/trace`、`/en/trace/{productionBatchId}`；
- 中文内容位于 `src/content/trace-batches/`，英文内容位于 `src/content/trace-batches-en/`；同一批次两份文件使用相同业务 ID；
- 当前只实现静态、只读的生产批次公开页，分开呈现生产事件、共享测量、检测、证明和采收批次血缘；
- 未实现二维码访问令牌、订单查询、单株公开页、召回后台或写入接口，也未部署 D1 `0003` 草案。

完整生产事实的结构基线位于上级架构目录 `database/traceability_v1_schema.sql`。PostgreSQL + TimescaleDB 是事实源；D1 和 Astro 内容只保存经过审核的公开投影。

### 中英文页面

- 中文是默认语言，沿用 `/`、`/about`、`/experiments/...` 等原网址，并新增 `/trace/...`。
- 英文页面使用 `/en`、`/en/about`、`/en/experiments/...` 和 `/en/trace/...`。
- 公共页面页头提供中英文切换，并尽量跳转到当前页面的对应语言版本。
- 中文实验源文件位于 `src/content/experiments/`；英文译文位于 `src/content/experiments-en/`。新增或修改公开实验时，两份同名文件应同步更新；英文页面仍使用相同的 `experimentId` 读取动态媒体。

### 自动采集与追溯数据状态

`experimentId` 只标识研发实验，`productionBatchId` 标识生产管理分组，两者通过可选关系关联。传感器安装、原始遥测和聚合数据应进入 PostgreSQL + TimescaleDB，并绑定真实生产区域、营养液回路、种植塔或测点范围；D1 只接收经审核的低频公开摘要。ESP32 以太网 MQTT、可选 MQTT-DTU、主数据库和遥测发布链尚未接通。P1/P2/EC 仍由 ESP32 作为安全总线唯一 Modbus 主站采集，DTU 只接独立环境总线或作备用上报。

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
