# 曦清农业官网

本仓库是 [xiqingagri.com](https://xiqingagri.com/) 的**唯一网站源码仓库**：Astro 页面、Cloudflare Pages Functions及D1/R2网站迁移。2026-10-13 起传感数据页移入登录后的本地现场管理，公开遥测查询与上传接口关闭；网站代码保持在这里，`main` 与 Cloudflare Pages 的构建部署关联。

控制器固件、RS485/USB 采集、现场 PostgreSQL/TimescaleDB、MQTT 入库和现场数据发布器在另一个**私有**仓库 [xiqing-agri-system](https://github.com/future007s/xiqing-agri-system)。公开网站不能控制泵，D1 也不是高频原始数据的事实源。跨仓库修改时应记录两边的提交 SHA，不复制同一个服务的源码。

## 本地开发

```sh
npm ci
npm test
npm run check
npm run build
```

构建输出为 `dist/`。在本机预览可运行 `npm run dev`。生产网站由 GitHub `main` 经 Cloudflare Pages 构建；Pages 的加密变量和 R2/D1 绑定在 Cloudflare 项目中维护，**不在仓库中保存真实口令**。`src/worker.ts` 与 `wrangler.toml` 是可选独立 Worker 适配，不是当前 Pages 生产入口。

页面跟随系统明暗模式，页脚在深色模式使用深底浅字，不随正文颜色变量反转成浅底；浅色模式保留原深色页脚。构建后可运行 `npm run test:theme` 做浏览器专项检查（需可用的 Playwright，或通过 `THEME_TEST_PLAYWRIGHT` 指定其模块位置，`THEME_TEST_BROWSER` 指定浏览器）。测试使用构建产物并阻断网络，覆盖中英文页面、桌面/手机、无需刷新切换和文字对比度，不访问现场服务。

## 中英文内容

公开实验和生产批次的中文发布副本保留为事实源；`src/i18n/records-en.json` 保存已核对的英文译文。开发和构建时，`scripts/sync-english-records.mjs` 从同一份记录生成对应英文副本，日期、记录 ID、数量、测量值和照片地址不变。新增观察或批次时先补齐完整译文，再运行 `node scripts/sync-english-records.mjs` 生成副本并执行测试；缺少译文会明确报错，不再将中文记录回退显示到英文页面。原有示例模板不参与公开发布。

英文详情使用独立的 `/en/record-days/` 日期接口；实验与批次之间的链接、语言切换、日期选择、照片说明及加载提示均保持当前语言。品牌字标“曦清”和语言切换入口“中文”保留原文。

构建后执行 `npm run test:i18n` 检查所有英文页面、每个记录日期、对应中文页的往返切换、日历与错误状态，以及手机/桌面和明暗主题。该检查使用本地产物，不访问现场服务。可通过 `I18N_TEST_PLAYWRIGHT`、`I18N_TEST_BROWSER` 指定本机 Playwright 模块和浏览器。

## 代码与内容入口

- `src/pages/`、`src/components/`：中英文页面和组件。
- `src/content/experiments/` 与 `src/content/experiments-en/`：经审核的网站实验发布副本。
- `src/content/trace-batches/` 与 `src/content/trace-batches-en/`：静态追溯公开副本；生产批次不是实验编号。
- `src/content.config.ts`：网站内容字段校验；真实实验见 `nursery-20261024-01.md`。
- `functions/api/`：媒体与公开数据接口；`migrations/`：D1 网站侧迁移。
- `workers/telemetry-retention/`：网站侧公开摘要保留任务。
- [现场运行与维护入口](docs/field-management.md)：官网链接到本地私有页面，实时读数和控制服务不经过官网。
- `ops/telemetry-publisher/README.md`：现场发布器已迁至系统仓库的说明，不再存两份源码。

实验原始记录、未审核观察、照片/视频原件及运行日志不应直接提交进网站仓库。媒体对象保存在 R2，D1 保存索引和审核后的公开读模型；官网只展示允许公开的内容。详见[实验发布入口](docs/experiment-record-template.md)、[媒体边界](docs/media-storage-convention.md)和[遥测边界](docs/telemetry-data-design.md)。

`src/lib/public-records.ts` 集中管理公开记录入口。原 `T01-001` 实验及其八月生产批次模板保留在源码中，不生成公开详情路由，也不进入首页、列表和站点地图。真实生产批次通过 `sourceExperimentId` 关联实验，页面据此生成双向链接；静态批次建档与现场数据库写入分别执行。

关联单一生产批次的按日页面合并展示当天记录，不按育苗材料分组；原来源合同仍保留各自的播种日期和育苗记录。数量更正同时保留原报数、更正数与更正日期，后续照片只归到其观察日期。

## 发布前核对

推送 `main` 可能触发生产构建。先运行上述测试和构建，再核对实验资料的中英文对应关系、隐私与审核状态、以及 Pages 生产设置。推送成功不等于现场数据发布器或控制器已经更新；它们有独立部署和验收流程。
