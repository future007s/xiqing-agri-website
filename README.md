# 曦清农业官网

本仓库是 [xiqingagri.com](https://xiqingagri.com/) 的**唯一网站源码仓库**：Astro 页面、Cloudflare Pages Functions、D1/R2 网站迁移和公开数据接收接口。网站代码保持在这里，`main` 与 Cloudflare Pages 的构建部署关联。

控制器固件、RS485/USB 采集、现场 PostgreSQL/TimescaleDB、MQTT 入库和现场数据发布器在另一个**私有**仓库 [xiqing-agri-system](https://github.com/future007s/xiqing-agri-system)。公开网站不能控制泵，D1 也不是高频原始数据的事实源。跨仓库修改时应记录两边的提交 SHA，不复制同一个服务的源码。

## 本地开发

```sh
npm ci
npm test
npm run check
npm run build
```

构建输出为 `dist/`。在本机预览可运行 `npm run dev`。生产网站由 GitHub `main` 经 Cloudflare Pages 构建；Pages 的加密变量和 R2/D1 绑定在 Cloudflare 项目中维护，**不在仓库中保存真实口令**。`src/worker.ts` 与 `wrangler.toml` 是可选独立 Worker 适配，不是当前 Pages 生产入口。

## 代码与内容入口

- `src/pages/`、`src/components/`：中英文页面和组件。
- `src/content/experiments/` 与 `src/content/experiments-en/`：经审核的网站实验发布副本。
- `src/content/trace-batches/` 与 `src/content/trace-batches-en/`：静态追溯公开副本；生产批次不是实验编号。
- `src/content.config.ts`：网站内容字段校验；实际示例见 `t01-001.md`。
- `functions/api/`：媒体与公开数据接口；`migrations/`：D1 网站侧迁移。
- `workers/telemetry-retention/`：网站侧公开摘要保留任务。
- [现场运行与维护入口](docs/field-management.md)：官网链接到本地私有页面，实时读数和控制服务不经过官网。
- `ops/telemetry-publisher/README.md`：现场发布器已迁至系统仓库的说明，不再存两份源码。

实验原始记录、未审核观察、照片/视频原件及运行日志不应直接提交进网站仓库。媒体对象保存在 R2，D1 保存索引和审核后的公开读模型；官网只展示允许公开的内容。详见[实验发布入口](docs/experiment-record-template.md)、[媒体边界](docs/media-storage-convention.md)和[遥测边界](docs/telemetry-data-design.md)。

## 发布前核对

推送 `main` 可能触发生产构建。先运行上述测试和构建，再核对实验资料的中英文对应关系、隐私与审核状态、以及 Pages 生产设置。推送成功不等于现场数据发布器或控制器已经更新；它们有独立部署和验收流程。
