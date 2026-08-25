# 实验媒体存储与关联规范

这套规范将“原始文件”“媒体索引”“实验记录”分开：R2 保存图片和视频字节，D1 保存可检索的媒体元数据，Markdown 或接口快照保存公开实验记录。这样既不会让 Git 历史被视频撑大，也不会把二进制文件塞进数据库。

## 1. R2 目录

```text
experiments/{experimentId}/{yyyy-mm-dd}/{uuid}-{safeFileName}.{extension}
```

示例：

```text
experiments/T01-001/2026-08-25/2a7f...-root-check.webp
experiments/T01-001/2026-08-25/8d12...-spray-test.mp4
```

约束：

- `experimentId` 必须与实验记录中的 `id` 完全一致。
- 文件名只保留英文字母、数字、点、下划线和短横线；唯一性由 UUID 保证。
- 原图/原视频只写入一次，不用同名覆盖；修订版本生成新的媒体 ID。
- `public` 媒体通过 `MEDIA_PUBLIC_BASE_URL` 对外提供；`private` 媒体不应写入公开 Markdown。
- R2 桶建议绑定自定义域名 `media.xiqingagri.com`，不要把 `r2.dev` 作为生产地址。

## 2. D1 媒体索引

迁移文件：`migrations/0001_experiment_media.sql`、`migrations/0002_media_management.sql`。

关键关联字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 图片/视频唯一 ID，例如 `IMG-T01-001-2a7f3c1b` |
| `experiment_id` | 关联实验 |
| `event_id` | 关联搭建、维护、故障、收获等事件 |
| `plant_id` | 关联单株或样本 |
| `captured_at` | 拍摄或采集时间 |
| `object_key` | R2 对象路径 |
| `visibility` | `public` 或 `private` |
| `review_status` | `pending`、`confirmed`、`rejected` |
| `checksum` | SHA-256，用于去重与追溯 |
| `deleted_at` | 软删除时间；非空时不在公开页显示 |
| `delete_reason` | 删除原因，便于复盘和恢复 |

原始文件不进入 D1。D1 只保存路径、描述、类型、时间、审核和关联关系。

## 3. 上传流程

```text
手动页面 / 采集程序
        ↓ POST /api/media/upload
Cloudflare Worker 校验口令、实验编号、类型和大小
        ↓
R2 写入原文件
        ↓
D1 写入 experiment_media
        ↓
返回媒体 ID、src、objectKey 和可复制 YAML
```

如果 R2 已写入但 D1 尚未绑定，接口返回 `202` 和 `metadataStatus: pending_db`，文件不会被静默删除；返回的 YAML 可以暂存，迁移完成后重新写入索引。

## 4. 公开显示规则

公开实验页只显示：

```text
visibility = 'public'
AND review_status = 'confirmed'
```

静态 Markdown 中已有的媒体在构建时显示；详情页还会请求 `/api/experiments/{experimentId}/media`，因此后续新上传并审核的媒体无需重新提交网站代码即可显示。

## 5. 缩略图策略

- 图片：上传接口将 `thumbnail` 初始设为原图 URL；接入 Cloudflare Images Transformations 后，可改为宽度 800 的优化地址。
- 视频：保留 `poster` 字段，先使用人工上传的封面图；没有封面时由浏览器显示视频首帧。
- 原图链接仍保留在 `src`，详情页点击图片可查看原始版本。

## 6. 安全与备份

- `MEDIA_UPLOAD_TOKEN` 只能配置为 Cloudflare Pages 加密 Secret，不能提交到 Git。
- 上传页面不保存口令；上传请求使用 `Authorization: Bearer`。
- 未审核媒体可以上传，但默认不出现在公开页面。
- 定期把 R2 对象同步到独立备份位置；D1 记录的 `checksum` 用于校验备份完整性。
- 如果实验照片包含人员、住址或未公开设备细节，应选择 `private`，不要只依赖页面隐藏。

## 7. 当前接口

```text
POST   /api/media/upload
GET    /api/experiments/{experimentId}/media
GET    /api/media?experimentId={experimentId}
PATCH  /api/media/{mediaId}
DELETE /api/media/{mediaId}                    # 软删除
POST   /api/media/{mediaId}/restore
POST   /api/media/{mediaId}/purge               # 彻底删除，需显式确认
```

管理接口和上传接口共用 `MEDIA_UPLOAD_TOKEN`，管理页面位于 `/media-manage`。修改只更新 D1 元数据；软删除保留 R2 对象并可恢复；彻底删除会先删除 R2 对象，再删除 D1 记录，并写入 `experiment_media_audit`。

自动采集程序、DTU 网关和未来 OCR 服务只需要复用这套媒体记录字段，不要另造一套图片表。
