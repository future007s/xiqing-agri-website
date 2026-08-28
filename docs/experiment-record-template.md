# 实验记录标准模板

本文件是官网发布格式和字段说明。日常建议在 Obsidian 中调用 `/Users/jim/Documents/自用综合/templates/气雾培-新建实验记录.md`，让 Templater 生成一份独立的本地实验记录，再把完成后的发布副本放入 `src/content/experiments/T01-002.md`。这样每次实验都会保留一个本地 Markdown 文档，不会覆盖模板或旧记录。接口以后也应生成同样的字段结构，避免人工记录和自动记录使用两套格式。

原则：

- `id` 是实验上下文的唯一关联键，实验内事件、图片、视频和 OCR 可通过它关联；它不是生产、采收、包装和订单的万能主键。
- 实验进入实际生产时用 `productionBatchId` 显式关联 ProductionBatch；一个实验与多个生产批次的关系应进入主数据库关系模型，不能复制或拼接编号代替。
- 时间统一使用 ISO 8601，例如 `2026-08-25T14:30:00+08:00`。
- 不确定的数值留空，不要写 `0`；没有数据和测得为零不是一回事。
- 原始遥测不可覆盖；修正值应产生新的记录并保留质量状态。
- `reviewStatus: pending` 的人工记录、OCR 和媒体不会显示在公开官网。

## 可复制模板

```yaml
---
# 模板版本。接口写入时固定为 1，未来结构变化再升版本。
templateVersion: 1

# 实验身份
id: "T01-002"
productionBatchId: "PB-QDF01-20260825-01" # 可选；只在已登记真实生产批次时填写
title: "第二代气雾培种植塔 · 首轮验证"
tower: "XQ-T1"
status: "preparing" # preparing | running | completed | failed | paused
startDate: "2026-08-25"
endDate:
harvestDate:
plant: "待定"
cultivar:
location:
timezone: "Asia/Shanghai"
operator:

# 设计参数与结果摘要
towerHeightM: 2.0
designPlants: 48
survivalRate:
yieldKg:
electricityKwh:
waterL:
costCny:

# 这一轮实验要回答的问题
objectives:
  - "验证……"
  - "测量……"

# 传感器和数据源清单
sensors:
  - id: "EC-001"
    name: "EC/TDS 传感器"
    kind: "EC/TDS"
    protocol: "RS485"
    location: "营养液箱"
    unit: "mS/cm"
    status: "planned" # planned | online | offline | fault
  - id: "PRESS-001"
    name: "压力传感器 1"
    kind: "压力"
    protocol: "RS485"
    location: "喷雾管路"
    unit: "MPa"
    status: "planned"

# 实验过程事件。事件是“发生了什么”，不是连续传感器数据。
events:
  - id: "EVT-T01-002-001"
    at: "2026-08-25T10:00:00+08:00"
    type: "setup" # setup | planting | calibration | maintenance | fault | harvest | other
    title: "完成种植塔搭建"
    status: "completed" # planned | completed | failed | paused
    summary: "记录本次搭建内容、变更和结果。"
    operator: ""

# 自动采集数据的公开摘要，不放完整原始数据流。
# 原始数据应进入时序数据库，接口只把经过聚合的摘要写到这里。
telemetry:
  - at: "2026-08-25T12:00:00+08:00"
    source: "CTRL-T01" # P1/P2/EC 主采集源；独立环境总线可写 DTU-001
    status: "observed" # observed | partial | pending | invalid
    metrics:
      - key: "ec"
        label: "EC"
        value: 1.42
        unit: "mS/cm"
        quality: "observed" # observed | estimated | pending | invalid
      - key: "pressure_line_1"
        label: "管路压力 1"
        value: "待同步"
        unit: "MPa"
        quality: "pending"

# 人工植物状态、故障、维护和现场观察。
observations:
  - id: "OBS-T01-002-001"
    at: "2026-08-25T16:00:00+08:00"
    category: "plant" # plant | root | environment | equipment | fault | other
    subject: "叶片状态"
    summary: "填写现场可观察到的事实，不写未经验证的结论。"
    detail: "可补充颜色、萎蔫、根系、病虫害和处理动作。"
    severity: "info" # info | attention | critical
    reviewStatus: "confirmed" # pending | confirmed | rejected

# OCR、视觉模型或人工复核的分析结果。
analyses:
  - id: "AI-T01-002-001"
    at: "2026-08-25T16:30:00+08:00"
    method: "plant-vision-v1"
    subject: "叶片颜色分析"
    result: "模型输出必须写成可复核的描述。"
    confidence: 0.82
    sourceMediaId: "IMG-T01-002-001"
    reviewStatus: "pending"

# 图片和视频。src 可以是 /media/... 的静态路径，也可以是 R2/CDN HTTPS 地址。
# 原始文件放 R2，D1 媒体索引保存关联关系；不要把二进制内容写进 Markdown 或数据库。
media:
  - id: "IMG-T01-002-001"
    kind: "image" # image | video
    src: "/media/T01-002/setup-001.webp"
    poster:
    thumbnail:
    at: "2026-08-25T10:05:00+08:00"
    eventId: "EVT-T01-002-001"
    plantId:
    caption: "种植塔完成搭建"
    alt: "第一代气雾培种植塔完成搭建后的现场照片"
    visibility: "public" # public | private
    reviewStatus: "confirmed"
    storage: "r2" # static | r2 | external
    objectKey: "experiments/T01-002/2026-08-25/setup-001.webp"
    mimeType: "image/webp"
    sizeBytes:
    checksum:
    source: "manual_upload" # manual_upload | camera | dtu | ocr | external
    uploadedAt: "2026-08-25T10:06:00+08:00"

  - id: "VID-T01-002-001"
    kind: "video"
    src: "https://media.example.com/T01-002/spray-test-001.mp4"
    poster: "https://media.example.com/T01-002/spray-test-001.webp"
    thumbnail:
    at: "2026-08-25T11:00:00+08:00"
    eventId: "EVT-T01-002-001"
    plantId:
    caption: "喷雾系统测试"
    alt: "气雾培喷雾系统运行测试视频"
    visibility: "public"
    reviewStatus: "confirmed"
    storage: "r2"
    objectKey: "experiments/T01-002/2026-08-25/spray-test-001.mp4"
    mimeType: "video/mp4"
    sizeBytes:
    checksum:
    source: "manual_upload"
    uploadedAt: "2026-08-25T11:01:00+08:00"

featured: false
---

## 实验目标

写这一轮实验的背景、边界和判定标准。

## 设计与变更

记录结构、配方、控制策略、软件版本、硬件变更和校准方法。

## 结果与讨论

只总结已经确认的数据，并明确区分设计值、实测值、估算值和待验证假设。

## 故障与失败记录

记录发生时间、影响、临时处理、根因假设和后续验证，不删除失败记录。

## 下一步

列出下一轮要验证的事项。
```

## 接口写入约定

实验接口使用 `experimentId`（数据库列名为 `experiment_id`）定位实验上下文；生产事实必须使用相应的 Position、PlantInstance、ProductionBatch、HarvestBatch 或 PackageBatch 身份，不能只接收 `experimentId`：

```text
GET  /api/experiments/{experimentId}
GET  /api/experiments/{experimentId}/telemetry
POST /api/experiments/{experimentId}/events
POST /api/experiments/{experimentId}/telemetry-snapshots
POST /api/experiments/{experimentId}/observations
POST /api/experiments/{experimentId}/media
POST /api/experiments/{experimentId}/analyses

# 媒体文件上传与动态读取
POST /api/media/upload
GET /api/experiments/{experimentId}/media
```

`POST /api/media/upload` 接收 multipart/form-data：`experimentId`、`kind`、`file`、`capturedAt`、`caption`、`alt`、`eventId`、`plantId`、`visibility` 和 `reviewStatus`。上传口令通过 `Authorization: Bearer` 传递。接口负责校验字段、生成唯一 ID、写入 R2 和 D1，并返回同结构的媒体 YAML。官网只展示 `visibility: public` 且 `reviewStatus: confirmed` 的内容。

如果 R2 已写入但 D1 尚未配置，接口会返回 `202` 和 `metadataStatus: pending_db`，保留返回字段用于补写索引。

## 自动采集数据边界

- `experiments` 保存实验身份；传感器是长期设备，通过带有效期的 SensorInstallation 绑定到真实测点和 MeasurementScope，不随实验重建身份。
- 连续采集的原始数据进入 PostgreSQL + TimescaleDB，至少保留安装来源、测量范围、测量时间、指标、数值、单位、质量状态和原始 payload。
- 原始样本只追加；修正数据新增记录并引用原记录，不覆盖历史。
- 分钟、小时、日摘要在主库生成；只有经审核、带 `resolution`、`source_scope_type` 和 `source_scope_id` 的低频摘要才可发布到 D1 或 Markdown。
- 营养液和环境数据属于回路、区域或测点；在植株页面只能标为共享暴露，不能伪造成单株测量。
- `POST /api/experiments/{experimentId}/telemetry-snapshots` 是导入/摘要接口，不等于 MQTT 自动采集已经完成。
- 具体表结构见 [`docs/telemetry-data-design.md`](telemetry-data-design.md) 和 [`migrations/0003_experiment_data_design.sql`](../migrations/0003_experiment_data_design.sql)。
