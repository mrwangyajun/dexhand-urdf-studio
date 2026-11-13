# 变更日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 与 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构。

## [Unreleased]

### 计划中

- 批量 CSV/JSON 导入（一表多零件 + 一表多关节，导入前做列校验与 diff 预览）
- 拖拽对齐：`TransformControls` 直接把 child 拖到父关节，回写 `origin`
- URDF 反向导入
- 碰撞体简化（凸包 / 胶囊）

## [0.1.0] - 2026-11-13

首个可用版本：从零零件到可被 RViz / MuJoCo / Isaac 加载的 URDF 全链路打通。

### 新增

- **零件入库**：多文件拖拽上传 STL/OBJ/DAE，每个 link 独立颜色；网格单位换算（m / mm / cm / in），默认 mm→m，导出时写入 `<mesh scale>` 而不改动原始字节。
- **参数编辑**：质量、质心 xyz、惯量 6 分量（ixx ixy ixz iyy iyz izz）；输入单位可切 kg/g、m/mm、kg·m²/kg·mm²/g·mm²；惯量参考系可切「质心 / 输出坐标系」。
- **SolidWorks 质量属性识别**：解析 TXT / CSV / 窗口复制文本 / PDF 复制文本，中英文标签均可；识别 g/kg/mg/lb、mm/cm/m/in、`g·mm²` 等表头单位；优先取相对质心的惯量，只有输出坐标系惯量时用平行轴定理换算；解析失败的字段高亮，可手填或一键占位（带 `placeholder` 标记，导出时告警）。
- **在线拼装**：按 parent/child/type/origin/axis/limit 建关节；改父子、改名、删件、切 root，成环与多父检测。
- **3D 视口**（Three.js）：link 坐标轴、关节轴箭头、质心小球、选中高亮 + 包围盒、关节拖动滑块、适应视图、等轴/前视/俯视/侧视四档视角预设；`RoomEnvironment` + PMREM 环境反射、三点光、受光地台与实时阴影。
- **实时预览**：URDF 文本随参数即时更新，可单独下载。
- **校验**：20+ 条规则分「错误（阻断导出）/ 警告 / 提示」三级，条目可点击定位到对应 link 或 joint。
- **工程文件**：保存/打开 JSON（网格以 base64 内嵌，可单文件搬走），localStorage 自动保存，`Ctrl+S` 保存。
- **导出**：`robot.urdf` + `meshes/`（原始字节）+ `params.json` + `check_urdf.py`（纯标准库）+ `README.md`（单位、版本、ROS 2 / MuJoCo / Isaac 加载步骤）。
- **示例库**：三套工程一键载入 —— 单指（4/3）、三指对称（10/9）、Barrett Hand BH8-280（9/8，运动学与惯性参数取自公开的 `barrett_model`）。

### 修复

- 导出数值改为自适应小数位，避免 `1e-7` 量级的微小惯量被截断成 0。

### 工程

- 三层测试：`selftest` 82 项核心逻辑断言、`verify-export` 导出包 + Python 校验器实测（含坏包反例）、`e2e` 49 项无头浏览器交互断言。
- `layout-check` 在 1280~1920 五档宽度下检查横向溢出与元素越界。
- `examples/*.zip` 提供三套示例的导出成品，可直接解压校验。

[Unreleased]: https://github.com/mrwangyajun/dexhand-urdf-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mrwangyajun/dexhand-urdf-studio/releases/tag/v0.1.0
