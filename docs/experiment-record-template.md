# 实验记录的网站发布副本

日常原始实验记录仍由用户在本地项目手册/Obsidian 中保存；本仓库只放**审核后的公开发布副本**。这里的可运行字段定义是 [`src/content.config.ts`](../src/content.config.ts)，现有中英文示例分别是 [`t01-001.md`](../src/content/experiments/t01-001.md) 和 [`t01-001.md` 英文版](../src/content/experiments-en/t01-001.md)。复制新文件时先核对 schema，再填写真实实验数据；没有实测值留空，不以 0 代替未知。

`id`/`experimentId` 是研发实验上下文，不是生产批次、采收批次或包装批次的替代 ID。图片和视频经上传、审核后与该实验关联；未审核/私有媒体不能仅靠不出现在导航栏来保密。详细身份与数据范围见私有[系统架构仓库](https://github.com/future007s/xiqing-agri-system/blob/main/docs/ARCHITECTURE.md)。

本文件不再维护第二套可复制 YAML 模板，避免与网站 schema 及本地 Obsidian 原始记录产生版本分叉。
