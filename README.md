# 曦清农业官网 V0.1

曦清农业（XIQING AGRI）的静态官网与公开实验记录入口。

核心原则：事实 > 宣传、实测 > 推测、未知 ≠ 0、设计值 ≠ 实测值、失败数据不删除。

## 技术栈

- Astro
- TypeScript（strict）
- Markdown Content Collections
- 静态生成，无数据库、无服务端运行时

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

1. 复制 `src/content/experiments/t01-001.md`。
2. 按实验编号重命名，例如 `src/content/experiments/t01-002.md`。
3. 更新 frontmatter 与正文。
4. 未实测的数值字段留空，不要写 `0`。

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

完成首次部署后会得到一个 `*.pages.dev` 测试域名。之后每次 `git push`，Cloudflare Pages 会自动重新构建和部署。

## 绑定域名

首次 Pages 部署成功后：

```text
Pages
→ Custom domains
→ Set up a domain
→ xiqingagri.com
```

若域名 DNS 尚不在 Cloudflare，请以 Cloudflare 当前页面给出的实际 Nameserver 为准，到域名注册商处修改；不要使用示例或猜测的 Nameserver。
