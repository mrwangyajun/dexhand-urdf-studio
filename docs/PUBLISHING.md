# 发布到 GitHub 的清单

这个仓库已经按开源项目结构整理好。账号信息已按 `mrwangyajun` 填好，推上去即可；换账号时按下面第 1 节整包替换。

## 1. 账号信息

已填写的位置：`package.json` 的 `repository` / `bugs` / `homepage`、README 的 clone 地址、CHANGELOG 的版本对比链接、issue 模板的 Discussions 与安全公告地址。换账号时整包替换：

```bash
# macOS
grep -rl "mrwangyajun" . --exclude-dir=node_modules --exclude-dir=.git | xargs sed -i '' 's/mrwangyajun/新用户名/g'

# Windows (Git Bash) / Linux
grep -rl "mrwangyajun" . --exclude-dir=node_modules --exclude-dir=.git | xargs sed -i 's/mrwangyajun/新用户名/g'
```

同时按需修改 `LICENSE` 里的 `Copyright (c) 2026 dexhand-urdf-studio contributors`（保留集体署名也可以）。

## 2. 初始化并推送

```bash
git remote add origin git@github.com:你的用户名/dexhand-urdf-studio.git
git branch -M main
git push -u origin main
```

> 仓库名建议就叫 `dexhand-urdf-studio`，与 `package.json` 的 `name` 一致。

## 3. 仓库设置（GitHub 网页端）

| 位置 | 建议 |
| --- | --- |
| Settings → General → Description | `分件赋参 → 在线拼装 → 导出灵巧手 URDF 的纯前端工具` |
| Settings → General → Topics | `urdf` `robotics` `dexterous-hand` `threejs` `solidworks` `ros2` `cad` |
| Settings → Pages | Source 选 **GitHub Actions**（若想在线演示，见下） |
| Settings → Code security | 打开 Dependabot alerts 与 secret scanning |
| Issues → Labels | 保留默认标签；CI 里用到了 `bug` / `enhancement` / `needs-triage`（`needs-triage` 需手动新建） |

## 4. CI 徽章

已在 README 顶部第一行，指向 `.github/workflows/ci.yml`（`?branch=main` 只显示主分支状态）。换仓库或换分支时改这两处 URL 即可。

## 5. 可选：在线演示（GitHub Pages）

项目是纯静态站点、`base: './'`，可直接上 Pages。新建 `.github/workflows/pages.yml`：

```yaml
name: Deploy to Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

跑通后把演示地址加到 README 顶部徽章区。

## 6. 打第一个 release

```bash
git tag -a v0.1.0 -m "首个可用版本"
git push origin v0.1.0
```

在 GitHub 的 Releases 页面基于该 tag 建 release，正文可从 `CHANGELOG.md` 的 `[0.1.0]` 段落拷贝；附件可以上传 `examples/*.zip`。

## 7. 推之前自查

```bash
npm ci && npm run ci      # 三条命令都绿
git status --short        # 工作区干净
git ls-files | wc -l      # 约 110 个文件，无 node_modules / dist / shots
du -sh .git               # 仓库体积应 < 5 MB
```
