# 官网追溯读模型与遥测数据边界

## 1. 架构结论

官网不保存完整生产事实，也不把 `experimentId` 当作所有数据的共同身份。正式关系是：

```text
PostgreSQL + TimescaleDB（生产事实源）
  ├─ Farm → Zone / NutrientLoop / Tower → Position
  ├─ CropCycle → ProductionBatch → PlantInstance ↔ Position Occupancy
  ├─ HarvestBatch → PackageBatch → Package → Order
  └─ SensorInstallation → Measurement / Event / Inspection / Certificate / Recall
                         ↓ 发布审批与脱敏投影
Cloudflare D1（官网公开读模型）
                         ↓
Astro 中英文追溯页面
```

`Experiment` 只表示研发与验证上下文，可选关联一个或多个 ProductionBatch。没有实验的商业生产批次仍然成立；同一个实验也不能替代生产批次、采收批次或包装批次。

## 2. 存储职责

| 数据 | 规范位置 | 官网规则 |
| --- | --- | --- |
| 物理资产、生物实例和全量批次血缘 | PostgreSQL | D1 只接收允许公开的摘要，不复制内部 UUID |
| 原始传感器遥测 | TimescaleDB | D1 不保存高频原始样本；网页不得直接扫描原始流 |
| 聚合测量与证据来源 | TimescaleDB / PostgreSQL | 经审核后可将低频摘要投影到 D1，必须带适用范围和质量状态 |
| 图片和视频字节 | R2 | D1 保存索引、公开性和审核状态 |
| 实验记录 | Markdown / PostgreSQL 实验登记 | 作为可选上下文，通过明确关系链接 ProductionBatch |
| 公开追溯页面 | Astro Content Collection；后续可切 D1 | 第一阶段为静态只读页面，不提供写入或控制能力 |

## 3. D1 公开读模型

`migrations/0003_experiment_data_design.sql` 是未部署的官网 D1 结构草案，包含：

- `experiments`：可选研发上下文；
- `published_production_batches`：已审核的生产批次事实投影；
- `published_production_batch_localizations`：同一批次的中英文公开文案，语言版本不复制批次身份；
- `published_batch_topology`：批次在有效时段内关联的 Zone、Tower、NutrientLoop 标签；
- `published_trace_events`：不可覆盖的公开事件与更正链；
- `published_measurement_summaries`：低频、已审核、带来源范围的测量摘要；
- `published_inspections`：明确样本和适用对象的检查/检验摘要；
- `published_harvest_batches` / `published_harvest_sources`：采收批次及其多来源关系；
- `published_certificates`：带版本、状态和声明范围的公开证明。

这些表名使用 `published_` 前缀，是为了持续提醒：它们是发布投影，不是生产事实源。任何更正必须先在主库形成审计事实，再发布新版本；不能只改网页来覆盖历史。

## 4. 测量粒度

每条公开测量必须带 `resolution`、`source_scope_type` 和 `source_scope_id`：

| 分辨率 | 公开含义 | 禁止表达 |
| --- | --- | --- |
| `entity_exact` | 直接作用或测量于该实体 | 不得扩大到相邻实体 |
| `set_exact` | 明确成员集合的共同事实 | 不得称作每个成员独立测量 |
| `batch_scope` | 整个批次层级的事实 | 不得称作单株事实 |
| `shared_exposure` | 继承 Zone/Tower/NutrientLoop 的共享环境 | 不得写成某株专属 EC、pH、温湿度 |
| `mass_balance_allocation` | 依据重量或数量守恒分配 | 不得伪装成逐株称量 |
| `derived` | 有版本算法计算的结果 | 必须能追到输入范围和规则版本 |
| `unknown` | 无法可靠确定 | 不得用 0 或设计值填补 |

营养液 EC、pH、液温通常属于 NutrientLoop 或具体安装点；环境温湿度、PAR/DLI 通常属于 Zone 或覆盖范围。PlantInstance 页面若展示这些数据，只能标为“共享暴露”。

## 5. 采集与发布链

```text
RS485 传感器 → ESP32 本地读取与安全裁决 → 采集服务
                                             ├─ 原始样本 → TimescaleDB
                                             ├─ 控制事件 → PostgreSQL
                                             └─ 审核聚合 → 发布任务 → D1 / Astro
```

- `SafetySupervisor` 仍是泵启动的唯一裁决者，`ActuatorService` 仍是 DO1 的唯一写入者。
- DTU、MQTT、数据库、D1、官网或订单状态都不能开启泵、解除锁定或放宽阈值。
- 官网故障只允许影响查询和展示，不能影响本地停泵。
- 未经审核的数据不得进入公开投影；没有数据时页面显示“待记录”，不显示 0。

## 6. 第一阶段网站范围

本阶段只上线代码层面的中英文静态 ProductionBatch 追溯页：

- 展示批次身份、农场、作物、生产周期、关联塔/区域/营养液回路；
- 分开显示生产事件、共享测量、检测、采收批次和证明；
- 空集合明确显示“尚无已审核记录”；
- 实验链接仅作为可选研发上下文；
- 不提供二维码 Token、订单查询、单株公开页、召回执行后台或写入 API。

`0003` 和网站内容均未部署。接通真实 D1 前，还需要发布审批、来源版本、撤回策略、访问权限和数据脱敏评审。
