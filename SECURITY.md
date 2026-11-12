# 安全策略

## 报告漏洞

本项目是**纯前端、无后端、无账号体系**的静态站点：所有数据留在浏览器里，导出时才落盘。因此常见风险集中在解析与打包环节。

如果你发现了问题，请**不要**开公开 issue，改用 GitHub 的 [私密漏洞报告](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)（Security → Report a vulnerability），或直接邮件联系维护者。

请在报告里包含：复现步骤、受影响的版本（commit hash）、构造的输入样本（例如一段会触发异常的质量属性文本或工程 JSON），以及你判断的影响范围。

## 已知的设计边界

| 项目 | 说明 |
| --- | --- |
| 上传的网格 | 仅使用 Three.js 的 `STLLoader` / `OBJLoader` / `DAELoader` 解析几何，不执行文件内脚本；DAE 的外部贴图与 `ref` 不加载 |
| 工程 JSON | `JSON.parse` 后按固定 schema 逐字段校验，未知字段被忽略；网格以 base64 内嵌，不做解压执行 |
| 质量属性文本 | 纯正则解析，不做 `eval`；解析失败保留原文，不抛未捕获异常 |
| 导出 zip | 由 JSZip 在内存中生成，`robot.urdf` 中的所有名称经 `[A-Za-z0-9_]` 白名单清洗，避免路径穿越 |
| 第三方脚本 | 无 CDN、无统计、无远程请求；页面加载后不发起任何网络调用（示例数据来自同源静态文件） |
| localStorage | 仅存工程 JSON；单个网格 > 3.5 MB 时剥离 base64，防止配额溢出 |

## 依赖

运行时依赖只有 4 个（`react`、`react-dom`、`three`、`jszip`）。升级依赖时请在 PR 中说明变更原因，CI 会跑一遍完整测试。
