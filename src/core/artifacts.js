/**
 * 导出包里的附加文件：README、check_urdf.py
 */
import { APP_NAME, APP_VERSION } from './urdf.js'

export const CHECK_URDF_PY = String.raw`#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_urdf.py —— 轻量 URDF 静态检查（不依赖 ROS，只用 Python 标准库）
用法:
    python3 check_urdf.py robot.urdf
    python3 check_urdf.py robot.urdf --strict   # 警告也当作失败
返回码: 0 通过 / 1 有问题
"""
import sys, os, math
import xml.etree.ElementTree as ET


def fnum(node, attr, default=0.0):
    try:
        return float(node.get(attr, default))
    except (TypeError, ValueError):
        return default


def parse_vec(node, attr="xyz"):
    """解析 URDF 的 "x y z" 形式属性，返回三元组；格式不对返回 None"""
    s = node.get(attr)
    if s is None:
        return None
    parts = s.replace(",", " ").split()
    if len(parts) != 3:
        return None
    try:
        return tuple(float(p) for p in parts)
    except ValueError:
        return None


def main(argv):
    if len(argv) < 2:
        print("用法: python3 check_urdf.py <robot.urdf> [--strict]")
        return 1
    path = argv[1]
    strict = "--strict" in argv[2:]
    errors, warns = [], []

    if not os.path.isfile(path):
        print("找不到文件: %s" % path)
        return 1
    try:
        tree = ET.parse(path)
    except ET.ParseError as e:
        print("[ERROR] XML 解析失败: %s" % e)
        return 1
    root = tree.getroot()
    if root.tag != "robot":
        errors.append("根节点必须是 <robot>，实际是 <%s>" % root.tag)
    robot_name = root.get("name")
    if not robot_name:
        errors.append("<robot> 缺少 name 属性")

    links = root.findall("link")
    joints = root.findall("joint")
    link_names = [l.get("name") for l in links]
    joint_names = [j.get("name") for j in joints]

    # ---- 名字唯一性 ----
    seen = {}
    for n in link_names:
        if not n:
            errors.append("存在没有 name 的 <link>")
        elif n in seen:
            errors.append("link 重名: %s" % n)
        else:
            seen[n] = "link"
    for n in joint_names:
        if not n:
            errors.append("存在没有 name 的 <joint>")
        elif n in seen:
            errors.append("名字冲突/重名: %s（URDF 中 link 与 joint 共享命名空间）" % n)
        else:
            seen[n] = "joint"

    # ---- link 物理参数 ----
    for l in links:
        n = l.get("name")
        inertial = l.find("inertial")
        if inertial is None:
            warns.append("link %s 没有 <inertial>" % n)
            continue
        mass_el = inertial.find("mass")
        if mass_el is None or fnum(mass_el, "value") <= 0:
            errors.append("link %s 的 mass 缺失或 <= 0" % n)
        inr = inertial.find("inertia")
        if inr is None:
            errors.append("link %s 缺少 <inertia>" % n)
        else:
            ixx, ixy, ixz = fnum(inr, "ixx"), fnum(inr, "ixy"), fnum(inr, "ixz")
            iyy, iyz, izz = fnum(inr, "iyy"), fnum(inr, "iyz"), fnum(inr, "izz")
            d2 = ixx * iyy - ixy * ixy
            det = (ixx * (iyy * izz - iyz * iyz)
                   - ixy * (ixy * izz - iyz * ixz)
                   + ixz * (ixy * iyz - iyy * ixz))
            if not (ixx > 0 and iyy > 0 and izz > 0 and d2 > 0 and det > 0):
                errors.append("link %s 的惯量矩阵不是正定: ixx=%g iyy=%g izz=%g det=%g" % (n, ixx, iyy, izz, det))
        for geo in list(l.iter("mesh")):
            fn = geo.get("filename")
            if not fn:
                errors.append("link %s 有 <mesh> 但没有 filename" % n)
                continue
            if fn.startswith("package://") or fn.startswith("file://"):
                continue
            p = fn if os.path.isabs(fn) else os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(path)), fn))
            if not os.path.isfile(p):
                warns.append("link %s 的网格文件不存在: %s（RViz 里会显示不出来）" % (n, fn))

    # ---- 关节树 ----
    child_parent = {}
    parents, children = set(), set()
    for j in joints:
        n = j.get("name")
        t = j.get("type")
        if t not in ("revolute", "continuous", "prismatic", "fixed", "floating", "planar"):
            errors.append("joint %s 的 type 非法: %s" % (n, t))
        p = j.find("parent")
        c = j.find("child")
        if p is None or c is None:
            errors.append("joint %s 缺少 <parent> 或 <child>" % n)
            continue
        pn, cn = p.get("link"), c.get("link")
        if pn not in link_names:
            errors.append("joint %s 的 parent link 不存在: %s" % (n, pn))
        if cn not in link_names:
            errors.append("joint %s 的 child link 不存在: %s" % (n, cn))
        if pn == cn:
            errors.append("joint %s 的 parent 与 child 相同: %s" % (n, pn))
        if cn in child_parent:
            errors.append("link %s 有多个父关节" % cn)
        child_parent[cn] = pn
        parents.add(pn)
        children.add(cn)
        if t in ("revolute", "prismatic"):
            lim = j.find("limit")
            if lim is None:
                errors.append("joint %s (%s) 缺少 <limit>" % (n, t))
            else:
                lo, hi = fnum(lim, "lower"), fnum(lim, "upper")
                if lo >= hi:
                    errors.append("joint %s 的 limit lower >= upper" % n)
                if fnum(lim, "effort") <= 0:
                    errors.append("joint %s 的 effort <= 0" % n)
                if fnum(lim, "velocity") <= 0:
                    errors.append("joint %s 的 velocity <= 0" % n)
        if t != "fixed":
            ax = j.find("axis")
            if ax is None:
                warns.append("joint %s (%s) 没有 <axis>，默认 (1,0,0)" % (n, t))
            else:
                v = parse_vec(ax, "xyz")
                if v is None:
                    errors.append("joint %s 的 axis 缺少 xyz 属性" % n)
                elif math.sqrt(sum(x * x for x in v)) < 1e-9:
                    errors.append("joint %s 的 axis 是零向量" % n)

    roots = [n for n in link_names if n not in children]
    if len(roots) == 0:
        errors.append("找不到 root link（可能成环）")
    elif len(roots) > 1:
        errors.append("存在多个 root link: %s" % ", ".join(roots))

    # ---- 环检测 ----
    for start in link_names:
        cur, steps, visited = start, 0, set()
        while cur in child_parent:
            if cur in visited:
                errors.append("关节树成环，涉及 link: %s" % cur)
                break
            visited.add(cur)
            cur = child_parent[cur]
            steps += 1
            if steps > len(link_names) + 1:
                errors.append("关节树成环（步数超限）")
                break

    # ---- 悬空 link ----
    if len(roots) == 1:
        connected, frontier = set([roots[0]]), [roots[0]]
        while frontier:
            cur = frontier.pop()
            for cn, pn in child_parent.items():
                if pn == cur and cn not in connected:
                    connected.add(cn)
                    frontier.append(cn)
        for n in link_names:
            if n not in connected:
                errors.append("link %s 未连接到 root" % n)

    print("robot: %s" % robot_name)
    print("links: %d, joints: %d, root: %s" % (len(links), len(joints), roots[0] if len(roots) == 1 else "?"))
    for w in warns:
        print("[WARN ] %s" % w)
    for e in errors:
        print("[ERROR] %s" % e)
    if not errors and not warns:
        print("OK: 结构与物理参数检查通过")
    elif not errors:
        print("OK: 无错误（有 %d 条警告）" % len(warns))
    else:
        print("FAILED: %d 个错误, %d 个警告" % (len(errors), len(warns)))
    if errors:
        return 1
    if strict and warns:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
`

export function buildReadme(project, opts = {}) {
  const robotName = opts.robotName || project.robotName || 'robot'
  const linkCount = project.links.length
  const jointCount = project.joints.length
  const meshCount = project.links.filter((l) => l.mesh?.dataBase64).length
  return `# ${robotName} — URDF 导出包

由 **${APP_NAME} v${APP_VERSION}** 生成于 ${opts.timestamp || new Date().toISOString()}

## 包内容

\`\`\`
${robotName}_urdf.zip
├── robot.urdf          # 机器人描述（${linkCount} links / ${jointCount} joints）
├── meshes/             # ${meshCount} 个网格文件（STL/OBJ/DAE 原始文件，未改动）
├── params.json         # 参数原始记录（含原始单位、换算来源）
├── check_urdf.py       # 独立校验脚本（纯 Python 标准库）
└── README.md
\`\`\`

## 单位与约定

| 量 | 单位 | 说明 |
| --- | --- | --- |
| 长度 | m | 关节 origin、质心、轴向 |
| 质量 | kg | \`<mass value>\` |
| 角度 | rad | \`<origin rpy>\` 按 URDF 的固定轴 X-Y-Z（外旋） |
| 惯量 | kg·m² | 相对**质心**，\`<inertial><origin>\` 即质心 |

- 网格按原始 CAD 坐标导出；若零件网格是 **mm**，\`<mesh>\` 上带
  \`scale="0.001 0.001 0.001"\`（RViz / Isaac Sim / MuJoCo 均支持该属性）。
  也可以自行用 Blender/FreeCAD 或 \`trimesh\` 把网格烘焙成米制后去掉 scale。
- 若某些 link 的惯量来自「输出坐标系」，导出时已用**平行轴定理**换算到质心，
  换算前后数值见 \`params.json\` 的 \`inertiaFrame\` 字段。

## 如何在 ROS 2 里检查

\`\`\`bash
# 0) 无 ROS 环境也能跑：只做结构与物理量静态检查
python3 check_urdf.py robot.urdf

# 1) 有 ROS 2 时用官方工具（urdfdom）
sudo apt install liburdfdom-tools
check_urdf robot.urdf

# 2) 建一个最小功能包并可视化
mkdir -p ~/ros2_ws/src/${robotName}/urdf
cp -r robot.urdf meshes ~/ros2_ws/src/${robotName}/urdf/
cd ~/ros2_ws && colcon build --packages-select ${robotName}
source install/setup.bash
ros2 run robot_state_publisher robot_state_publisher \\
  --ros-args -p robot_description:="$(cat ~/ros2_ws/src/${robotName}/urdf/robot.urdf)"
rviz2   # Add -> RobotModel -> Description Topic: /robot_description
\`\`\`

> 在 RViz 里如果网格是白色/不显示：确认 \`meshes/\` 与 \`robot.urdf\` 的相对位置不变，
> 或在 \`<mesh filename>\` 里改成 \`package://\` 绝对路径。

## 在 MuJoCo 里加载

\`\`\`bash
python -c "import mujoco; m = mujoco.MjModel.from_xml_path('robot.urdf'); print(m.nbody, m.njnt)"
\`\`\`
MuJoCo 会读取 \`<mesh scale>\`；惯量按 \`<inertial>\` 使用。若提示 mesh 路径问题，
可在 URDF 同目录执行，或把 \`meshes/\` 一起放到工作目录。

## 在 Isaac Sim 里加载

\`File > Import\` 选择 \`robot.urdf\`（或 \`URDF Importer\` 扩展），
勾选 *Fix Base Link*（固定基座）后导入即可；网格相对路径会自动解析。
注意 Isaac 默认按米制解析，带 \`scale\` 的网格会被正确缩放。

## 参数复核建议

1. 打开 \`params.json\`，核对每个 link 的 \`mass\` / \`com\` / \`inertia\` 与 CAD 质量属性一致。
2. 用 \`check_urdf.py\` 确认惯量正定、limit 完整、无悬空 link。
3. 在 RViz 里拖动 \`joint_state_publisher_gui\` 检查关节轴向与限位是否符合预期。
4. 若整机惯量异常（数量级偏大 1e3~1e9 倍），通常是 g·mm² 未换算成 kg·m²。
`
}
