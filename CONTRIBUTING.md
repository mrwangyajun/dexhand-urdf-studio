# 贡献指南

感谢你愿意改进 **灵巧手 URDF Studio**。这是一个纯前端工具，所有与 CAD/URDF 相关的逻辑都放在 `src/core/` 里、与 UI 解耦，所以大部分改动都能用 `npm run selftest` 直接验证，不需要开浏览器。

## 环境准备

```bash
node -v          # 需要 >= 18（推荐 20 LTS）
npm ci           # 严格按 package-lock.json 安装
npm run dev      # http://localhost:5173
```

## 提交前自检

```bash
npm run ci       # selftest(82 项) + verify(导出包实测) + build
```

改了 UI 或布局，再跑：

```bash
npm run dev                 # 另开一个终端
E2E_URL=http://localhost:5173/ npm run e2e   # 真实交互断言，截图落在 shots/
npm run layout              # 1280~1920 五档宽度横向溢出体检
```

`npm run e2e` 需要一个 Chromium 内核浏览器。默认自动探测 Chrome / Edge / Chromium，也可以用 `E2E_BROWSER=/path/to/chrome` 指定。

## 代码约定

| 主题 | 约定 |
| --- | --- |
| 模块边界 | `src/core/*` 不导入 React、不碰 DOM，能被 Node 直接 import（selftest 就是这么跑的） |
| 单位 | 内存与导出**永远 SI**（m / kg / rad / kg·m²）；只在输入控件边界做换算，换算表在 `core/units.js` |
| 数值输出 | 不用科学计数法，用 `core/units.js` 的 `fmt()`；改格式必须同步 `selftest` 里的断言 |
| URDF 字段名 | 保持英文（`<inertial>`、`<limit>`…），界面文案用中文 |
| 样式 | 全部在 `src/styles.css`，沿用现有 CSS 变量（`--bg`、`--line`、`--accent`…），不要引入 UI 框架 |
| 依赖 | 新增运行时依赖前先开 issue 说明理由；目标是把依赖数量压在个位数 |
| 注释 | 只写「为什么」，不写「是什么」；数值来源（如上游 URDF 的哪个字段）要写清 |

## 修改核心逻辑时

`src/core/` 的任何行为变更都要在 `scripts/selftest.mjs` 里补断言 —— 那里已经覆盖了解析、平行轴换算、URDF 文本、校验规则、打包和三个示例工程。校验规则新增一条时，请同时补一条「该规则能拦住坏数据」和一条「好数据不被误拦」的用例。

## 提交信息

采用 Conventional Commits 前缀，一句话说清改动对象：

```
feat(ui): 示例库弹窗 + 视角预设
fix(parser): 中文标签「重心」后跟单位时漏解析
test: 补 Barrett 示例的惯量三角不等式断言
docs: 补充从 SolidWorks 导出的步骤
chore: 升级 three 到 0.169
```

一个提交只做一件事；纯格式化、重命名的改动单独提交。

## Pull Request

1. 从 `main` 切分支：`feat/xxx`、`fix/xxx`。
2. PR 描述里写清**动机 / 改动点 / 验证方式**（贴 `npm run ci` 输出，UI 改动附 `shots/` 截图）。
3. CI 必须绿；新增功能请同步更新 README 对应章节。
4. 我们会优先合并「小、可独立验证、带测试」的 PR。

## 报告问题

请用仓库的 issue 模板，并尽量附上：

- 复现步骤 + 期望 / 实际结果；
- 涉及到的质量属性文本（**删掉真实型号与公司信息**后贴），或工程 JSON；
- 浏览器与 Node 版本（`node -v`、Chrome 版本号）。

## 许可证

提交即表示你同意以 [MIT](./LICENSE) 许可证贡献这些代码。
