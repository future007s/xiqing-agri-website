# 官网公开遥测数据边界

两路压力、EC、pH 的原始样本由 ESP32-S3 经 USB 进入现场主机和 PostgreSQL/TimescaleDB；独立环境 DTU 经 MQTT 入现场库。官网只接收经质量筛选的十分钟等低频公开摘要，接收接口在 [`functions/api/telemetry/publish.ts`](../functions/api/telemetry/publish.ts)，网站读模型见 [`migrations/0005_public_telemetry.sql`](../migrations/0005_public_telemetry.sql)。

公开摘要的过期清理统一由 [`workers/telemetry-retention/`](../workers/telemetry-retention/) 的独立定时任务负责，每天北京时间 08:10（UTC 00:10，计划表达式 `10 0 * * *`）运行一次，删除超过 30 天的数据。上传接口只校验、过滤过期输入并写入摘要，不再触发清理，避免同一张表被重复检查。查询接口仍按最近 30 天筛选；即使刚过期的记录尚未到下一次清理时间，也不会显示在公开页面中。清理正常运行时，物理删除最多滞后约 24 小时，数据库中的摘要最多保留约 31 天；每日清理用于减少无过期数据时仍重复扫描整表的读取消耗，不改变现场采集或官网十分钟摘要的频率。

这个独立任务的运行计划须单独同步至 Cloudflare；仅推送网站仓库、触发 Pages 构建，不会更新它的定时计划。更新时替换原计划，并核对线上只保留一个每日计划及原有 D1 绑定；不新增第二种清理方式。

现场发布器的唯一源码已转至私有[系统仓库 `ingestor/website_publisher.py`](https://github.com/future007s/xiqing-agri-system/blob/main/ingestor/website_publisher.py)，本公开网站仓库不再复制。D1/页面没有泵控制权限；网站汇总不是高频原始事实。生产批次、实验和传感器安装范围须按真实关系表达，不能把共享回路或环境读数伪造成单株独立测量。
