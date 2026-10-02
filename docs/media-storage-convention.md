# 官网媒体存储边界

图片和视频字节保存在 Cloudflare R2；D1 保存媒体索引、实验关系、审核状态和删除审计。静态页面与 [`functions/api/experiments/[experimentId]/media.ts`](../functions/api/experiments/[experimentId]/media.ts) 只展示允许公开、已确认的内容。上传和管理接口在 [`functions/api/media/`](../functions/api/media/)；D1 网站迁移在 [`migrations/`](../migrations/)。

Pages 的媒体口令只配置在 Cloudflare 加密变量中，不提交真实值到 GitHub。R2 对象是否私有必须由对象访问控制保证；不在列表中显示不等于保密。原始照片/视频、含人员或现场细节的私有素材不进入本仓库。完整现场数据与系统边界见私有[系统仓库](https://github.com/future007s/xiqing-agri-system/blob/main/docs/ARCHITECTURE.md)。
