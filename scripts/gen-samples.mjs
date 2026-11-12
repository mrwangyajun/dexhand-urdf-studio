/**
 * 生成示例数据包（三个示例）：
 *   1. finger_hand  手掌 + 1 指 3 关节          —— 入门最小链路
 *   2. three_finger 三指 9 关节（对称布局）      —— 简化几何，质量属性由网格体积积分得出
 *   3. barrett_bh8  Barrett Hand BH8-280        —— 运动学 / 质量 / 惯量取自
 *      JHU LCSR barrett_model（models/hand.urdf.xacro，源自 Barrett 官方 SolidWorks 模型），
 *      网格为等比简化几何（原网格无许可证，不随仓库分发）
 *
 * 产物：
 *   public/samples/meshes/*.stl            简化几何体，单位 mm（模拟 SolidWorks 导出的 STL）
 *   public/samples/*.project.json          工程文件（SI 参数）
 *   public/samples/index.json              示例库索引（页面「示例库」用）
 *   samples/massprops/*.txt|csv            模拟 SolidWorks 质量属性导出（g / mm）
 * 用法： npm run samples
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHECK_URDF_PY } from '../src/core/artifacts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUB = path.join(ROOT, 'public', 'samples')
const MP = path.join(ROOT, 'samples', 'massprops')

fs.mkdirSync(path.join(PUB, 'meshes'), { recursive: true })
fs.mkdirSync(path.join(PUB, 'massprops'), { recursive: true })
fs.mkdirSync(MP, { recursive: true })

// ============================================================
// 几何工具
// ============================================================
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

function signedVolume(tris) {
  let v = 0
  for (const [a, b, c] of tris) {
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return v
}

/** 统一朝向：体积为负则翻转全部三角形 */
function fixWinding(tris) {
  return signedVolume(tris) < 0 ? tris.map(([a, b, c]) => [a, c, b]) : tris
}

function boxTriangles(min, max) {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const P = (x, y, z) => [x, y, z]
  const a = P(x0, y0, z0), b = P(x1, y0, z0), c = P(x1, y1, z0), d = P(x0, y1, z0)
  const e = P(x0, y0, z1), f = P(x1, y0, z1), g = P(x1, y1, z1), h = P(x0, y1, z1)
  const quads = [[a, d, c, b], [e, f, g, h], [a, b, f, e], [d, h, g, c], [a, e, h, d], [b, c, g, f]]
  const tris = []
  for (const q of quads) { tris.push([q[0], q[1], q[2]]); tris.push([q[0], q[2], q[3]]) }
  return fixWinding(tris)
}

/**
 * 八棱柱：沿 axis 拉伸，四条长棱倒角；可带端部收缩（taper），
 * 用来做机加工质感的连杆，比纯方块耐看。
 * taper: [起点缩放, 终点缩放]
 */
function prism({ min, max, axis = 'z', chamfer = 0.22, taper = [1, 1] }) {
  const idx = { x: 0, y: 1, z: 2 }
  const ai = idx[axis]
  const [ui, vi] = [0, 1, 2].filter((i) => i !== ai)
  const cu = (min[ui] + max[ui]) / 2
  const cv = (min[vi] + max[vi]) / 2
  const hu = (max[ui] - min[ui]) / 2
  const hv = (max[vi] - min[vi]) / 2
  const lo = min[ai]
  const hi = max[ai]

  const ring = (scale, at) => {
    const u = hu * scale
    const v = hv * scale
    const c = Math.min(u, v) * chamfer
    const flat = [
      [u - c, v], [u, v - c], [u, -v + c], [u - c, -v],
      [-u + c, -v], [-u, -v + c], [-u, v - c], [-u + c, v]
    ]
    return flat.map(([du, dv]) => {
      const p = [0, 0, 0]
      p[ui] = cu + du
      p[vi] = cv + dv
      p[ai] = at
      return p
    })
  }

  const A = ring(taper[0], lo)
  const B = ring(taper[1], hi)
  const tris = []
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8
    tris.push([A[i], A[j], B[j]])
    tris.push([A[i], B[j], B[i]])
  }
  for (let k = 1; k < 7; k++) {
    tris.push([A[0], A[k + 1], A[k]])
    tris.push([B[0], B[k], B[k + 1]])
  }
  return fixWinding(tris)
}

/** 圆柱（沿 axis），用于关节轴套之类的圆角细节 */
function cylinder({ center, radius, length, axis = 'z', segments = 20 }) {
  const idx = { x: 0, y: 1, z: 2 }
  const ai = idx[axis]
  const [ui, vi] = [0, 1, 2].filter((i) => i !== ai)
  const ringAt = (at) => {
    const pts = []
    for (let i = 0; i < segments; i++) {
      const t = (i / segments) * Math.PI * 2
      const p = [0, 0, 0]
      p[ui] = center[ui] + Math.cos(t) * radius
      p[vi] = center[vi] + Math.sin(t) * radius
      p[ai] = at
      pts.push(p)
    }
    return pts
  }
  const A = ringAt(center[ai] - length / 2)
  const B = ringAt(center[ai] + length / 2)
  const tris = []
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    tris.push([A[i], A[j], B[j]])
    tris.push([A[i], B[j], B[i]])
  }
  for (let k = 1; k < segments - 1; k++) {
    tris.push([A[0], A[k + 1], A[k]])
    tris.push([B[0], B[k], B[k + 1]])
  }
  return fixWinding(tris)
}

/**
 * 绕 Z 轴旋转三角形（角度制）。
 * 用于把原 URDF 里 <visual><origin rpy> 的补偿旋转「烘」进网格——
 * 本工具的导出不带 per-link visual offset，几何必须在 link 坐标系里直接正确。
 */
function rotateZTris(tris, deg) {
  const a = (deg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return tris.map((t) =>
    t.map(([x, y, z]) => [x * c - y * s, x * s + y * c, z])
  )
}

function merge(...groups) {
  return groups.flat()
}

function writeStlBinary(file, triangles, header = 'DexHand URDF Studio sample') {
  const buf = Buffer.alloc(84 + triangles.length * 50)
  buf.write(header.slice(0, 79), 0, 'ascii')
  buf.writeUInt32LE(triangles.length, 80)
  let off = 84
  for (const t of triangles) {
    const n = norm(cross(sub(t[1], t[0]), sub(t[2], t[0])))
    const vals = [n[0], n[1], n[2], ...t[0], ...t[1], ...t[2]]
    for (let i = 0; i < 12; i++) { buf.writeFloatLE(vals[i], off); off += 4 }
    buf.writeUInt16LE(0, off)
    off += 2
  }
  fs.writeFileSync(file, buf)
  return buf.length
}

/**
 * 闭合网格的质量属性（均匀密度）。
 * 用有符号四面体积分：∫x_i x_j dV = V/20 (Σp_i p_j + (Σp_i)(Σp_j))，
 * 再平移到质心，得到 URDF 需要的相对质心惯量。
 */
function meshProps(tris, density) {
  let V = 0
  let mx = 0, my = 0, mz = 0
  let Sxx = 0, Syy = 0, Szz = 0, Sxy = 0, Sxz = 0, Syz = 0
  for (const [a, b, c] of tris) {
    const v = (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    if (v === 0) continue
    V += v
    const sx = a[0] + b[0] + c[0]
    const sy = a[1] + b[1] + c[1]
    const sz = a[2] + b[2] + c[2]
    mx += (v * sx) / 4
    my += (v * sy) / 4
    mz += (v * sz) / 4
    Sxx += (v / 20) * (a[0] * a[0] + b[0] * b[0] + c[0] * c[0] + sx * sx)
    Syy += (v / 20) * (a[1] * a[1] + b[1] * b[1] + c[1] * c[1] + sy * sy)
    Szz += (v / 20) * (a[2] * a[2] + b[2] * b[2] + c[2] * c[2] + sz * sz)
    Sxy += (v / 20) * (a[0] * a[1] + b[0] * b[1] + c[0] * c[1] + sx * sy)
    Sxz += (v / 20) * (a[0] * a[2] + b[0] * b[2] + c[0] * c[2] + sx * sz)
    Syz += (v / 20) * (a[1] * a[2] + b[1] * b[2] + c[1] * c[2] + sy * sz)
  }
  const m = density * V
  const com = { x: mx / V, y: my / V, z: mz / V }
  const Ixx = density * (Syy + Szz) - m * (com.y ** 2 + com.z ** 2)
  const Iyy = density * (Sxx + Szz) - m * (com.x ** 2 + com.z ** 2)
  const Izz = density * (Sxx + Syy) - m * (com.x ** 2 + com.y ** 2)
  const Ixy = -density * Sxy + m * com.x * com.y
  const Ixz = -density * Sxz + m * com.x * com.z
  const Iyz = -density * Syz + m * com.y * com.z
  return { volume: V, mass: m, com, inertia: { ixx: Ixx, ixy: Ixy, ixz: Ixz, iyy: Iyy, iyz: Iyz, izz: Izz } }
}

// ============================================================
// 通用：写网格、写工程
// ============================================================
const meshFiles = {}
const meshPropsByName = {}

/** @param {string} name @param {number[][][]} trisMm 顶点单位为毫米 */
function emitMesh(name, trisMm, density = 1150) {
  const fn = `${name}.stl`
  const bytes = writeStlBinary(path.join(PUB, 'meshes', fn), trisMm, `sample ${name} (unit: mm)`)
  meshFiles[name] = { fileName: fn, bytes }
  // 质量属性按米制积分
  const trisM = trisMm.map((t) => t.map((p) => [p[0] / 1000, p[1] / 1000, p[2] / 1000]))
  meshPropsByName[name] = meshProps(trisM, density)
  return meshFiles[name]
}

const r9 = (v) => +Number(v).toFixed(9)
const r14 = (v) => +Number(v).toFixed(14)

function makeLink(name, meshName, props, color, massSource, extra = {}) {
  const mesh = meshFiles[meshName]
  return {
    id: `link_${name}`,
    name,
    mesh: { fileName: mesh.fileName, unitScale: 'mm', format: 'stl', size: mesh.bytes },
    mass: r9(props.mass),
    com: { x: r9(props.com.x), y: r9(props.com.y), z: r9(props.com.z) },
    inertia: {
      ixx: r14(props.inertia.ixx),
      ixy: r14(props.inertia.ixy),
      ixz: r14(props.inertia.ixz),
      iyy: r14(props.inertia.iyy),
      iyz: r14(props.inertia.iyz),
      izz: r14(props.inertia.izz)
    },
    inertiaFrame: 'com',
    color,
    placeholder: false,
    massSource: massSource || null,
    ...extra
  }
}

function makeJoint(name, type, parent, child, { xyz = [0, 0, 0], rpy = [0, 0, 0], axis = [0, 0, 1], limit } = {}) {
  return {
    // id 去掉名字里重复的 joint_ 前缀：f1_joint_abd -> joint_f1_abd
    id: `joint_${name.replace(/^joint_/, '')}`,
    name,
    type,
    parentId: `link_${parent}`,
    childId: `link_${child}`,
    origin: {
      xyz: { x: r9(xyz[0]), y: r9(xyz[1]), z: r9(xyz[2]) },
      rpy: { x: r14(rpy[0]), y: r14(rpy[1]), z: r14(rpy[2]) }
    },
    axis: { x: r9(axis[0]), y: r9(axis[1]), z: r9(axis[2]) },
    limit: {
      lower: r9(limit?.lower ?? 0),
      upper: r9(limit?.upper ?? 0),
      effort: limit?.effort ?? 5,
      velocity: limit?.velocity ?? 5
    }
  }
}

function writeProject(fileName, { robotName, rootId, links, joints, note }) {
  const project = {
    version: 1,
    robotName,
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
    rootId: `link_${rootId}`,
    meshBaseDir: 'meshes/',
    ...(note ? { note } : {}),
    links,
    joints
  }
  fs.writeFileSync(path.join(PUB, fileName), JSON.stringify(project, null, 2) + '\n')
  return project
}

// ============================================================
// 示例 1：手掌 + 1 指 3 关节
// ============================================================
const DENSITY_PLA = 1200

function boxProps(name, min, max, density = DENSITY_PLA) {
  const sx = max[0] - min[0]
  const sy = max[1] - min[1]
  const sz = max[2] - min[2]
  const volume = sx * sy * sz
  const mass = volume * density
  const com = { x: (min[0] + max[0]) / 2, y: (min[1] + max[1]) / 2, z: (min[2] + max[2]) / 2 }
  const inertia = {
    ixx: (mass / 12) * (sy * sy + sz * sz),
    ixy: 0,
    ixz: 0,
    iyy: (mass / 12) * (sx * sx + sz * sz),
    iyz: 0,
    izz: (mass / 12) * (sx * sx + sy * sy)
  }
  return { name, min, max, size: { sx, sy, sz }, volume, mass, com, inertia }
}

const parts = [
  boxProps('palm', [-0.020, -0.0425, -0.015], [0.070, 0.0425, 0.015]),
  boxProps('f1_proximal', [0, -0.009, -0.009], [0.030, 0.009, 0.009]),
  boxProps('f1_middle', [0, -0.008, -0.008], [0.026, 0.008, 0.008]),
  boxProps('f1_distal', [0, -0.0075, -0.0075], [0.022, 0.0075, 0.0075])
]

for (const p of parts) {
  emitMesh(
    p.name,
    boxTriangles(p.min.map((v) => v * 1000), p.max.map((v) => v * 1000)),
    DENSITY_PLA
  )
}

const byName = Object.fromEntries(parts.map((p) => [p.name, p]))
const linkDefs = [
  { name: 'palm', part: byName.palm, color: '#7f90a6' },
  { name: 'f1_proximal', part: byName.f1_proximal, color: '#5f8fc4' },
  { name: 'f1_middle', part: byName.f1_middle, color: '#5fae90' },
  { name: 'f1_distal', part: byName.f1_distal, color: '#c9a061' }
]

const fingerHandLinks = linkDefs.map((d) =>
  makeLink(d.name, d.name, d.part, d.color, {
    fileName: `${d.name}.txt`,
    rawUnits: { mass: 'g', length: 'mm', inertia: 'g*mm^2' },
    note: '示例数据：由 gen-samples.mjs 按密度 1200 kg/m³ 生成，与 samples/massprops/*.txt 数值一致',
    parsedAt: '2026-11-11T00:00:00.000Z'
  })
)

const fingerHandJoints = [
  makeJoint('f1_joint_abd', 'revolute', 'palm', 'f1_proximal', {
    xyz: [0.07, 0.02, 0], axis: [0, 0, 1], limit: { lower: -0.35, upper: 0.35, effort: 2, velocity: 2 }
  }),
  makeJoint('f1_joint_mcp', 'revolute', 'f1_proximal', 'f1_middle', {
    xyz: [0.03, 0, 0], axis: [0, 1, 0], limit: { lower: -1.4, upper: 0.05, effort: 1.5, velocity: 3 }
  }),
  makeJoint('f1_joint_dip', 'revolute', 'f1_middle', 'f1_distal', {
    xyz: [0.026, 0, 0], axis: [0, 1, 0], limit: { lower: -1.5, upper: 0.05, effort: 1, velocity: 3 }
  })
]

const fingerHand = writeProject('finger_hand.project.json', {
  robotName: 'dex_hand_demo',
  rootId: 'palm',
  links: fingerHandLinks,
  joints: fingerHandJoints
})

// ============================================================
// 示例 2：三指灵巧手（对称 3 指 × 3 关节）
// 几何为简化件，质量 / 质心 / 惯量由网格体积积分得出（密度 1150 kg/m³，工程塑料）
// ============================================================
const TF_DENSITY = 1150

// 手掌：x 向后为负（腕部），指根在 x=+62mm；背面加一块腕部安装座
emitMesh(
  'tf_palm',
  merge(
    prism({ min: [-18, -46, -16], max: [62, 46, 16], axis: 'z', chamfer: 0.18 }),
    prism({ min: [-30, -24, -12], max: [-14, 24, 12], axis: 'x', chamfer: 0.34 })
  ),
  TF_DENSITY
)

// 近节 / 中节 / 远节：沿 +x 的八棱柱，末端略收缩，根部留出关节鼓
emitMesh(
  'tf_prox',
  merge(
    prism({ min: [1.5, -11, -9], max: [43, 11, 9], axis: 'x', chamfer: 0.42, taper: [1, 0.88] }),
    cylinder({ center: [0, 0, 0], radius: 11.6, length: 17, axis: 'y', segments: 20 })
  ),
  TF_DENSITY
)

emitMesh(
  'tf_mid',
  merge(
    prism({ min: [1.5, -9.5, -8], max: [35, 9.5, 8], axis: 'x', chamfer: 0.4, taper: [1, 0.86] }),
    cylinder({ center: [0, 0, 0], radius: 10.2, length: 15, axis: 'y', segments: 20 })
  ),
  TF_DENSITY
)

emitMesh(
  'tf_dist',
  merge(
    prism({ min: [1.5, -8, -7], max: [30, 8, 7], axis: 'x', chamfer: 0.4, taper: [1, 0.6] }),
    cylinder({ center: [0, 0, 0], radius: 8.6, length: 13, axis: 'y', segments: 20 })
  ),
  TF_DENSITY
)

const tfPallet = { palm: '#6f7b8a', f1: '#4d8fd0', f2: '#3fae8c', f3: '#c99a52' }
const tfMassSource = (meshName) => ({
  fileName: `${meshName}.txt`,
  rawUnits: { mass: 'g', length: 'mm', inertia: 'g*mm^2' },
  note: '示例数据：由简化网格 + 密度 1150 kg/m³ 积分得出，可用 samples/massprops/*.txt 走一遍识别流程',
  parsedAt: '2026-11-11T00:00:00.000Z'
})

const tfLinks = [
  makeLink('tf_palm', 'tf_palm', meshPropsByName.tf_palm, tfPallet.palm, tfMassSource('tf_palm'))
]
const tfJoints = []

const TF_FINGERS = [
  { key: 'f1', y: -0.036, color: tfPallet.f1 },
  { key: 'f2', y: 0.0, color: tfPallet.f2 },
  { key: 'f3', y: 0.036, color: tfPallet.f3 }
]

for (const f of TF_FINGERS) {
  tfLinks.push(
    makeLink(`tf_${f.key}_prox`, 'tf_prox', meshPropsByName.tf_prox, f.color, tfMassSource('tf_prox')),
    makeLink(`tf_${f.key}_mid`, 'tf_mid', meshPropsByName.tf_mid, f.color, tfMassSource('tf_mid')),
    makeLink(`tf_${f.key}_dist`, 'tf_dist', meshPropsByName.tf_dist, f.color, tfMassSource('tf_dist'))
  )
  tfJoints.push(
    makeJoint(`tf_${f.key}_abd_joint`, 'revolute', 'tf_palm', `tf_${f.key}_prox`, {
      xyz: [0.062, f.y, 0], axis: [0, 0, 1], limit: { lower: -0.28, upper: 0.28, effort: 3, velocity: 3 }
    }),
    makeJoint(`tf_${f.key}_mcp_joint`, 'revolute', `tf_${f.key}_prox`, `tf_${f.key}_mid`, {
      xyz: [0.046, 0, 0], axis: [0, 1, 0], limit: { lower: -0.05, upper: 1.75, effort: 2.5, velocity: 4 }
    }),
    makeJoint(`tf_${f.key}_pip_joint`, 'revolute', `tf_${f.key}_mid`, `tf_${f.key}_dist`, {
      xyz: [0.038, 0, 0], axis: [0, 1, 0], limit: { lower: -0.05, upper: 1.6, effort: 2, velocity: 4 }
    })
  )
}

const threeFinger = writeProject('three_finger.project.json', {
  robotName: 'three_finger_hand',
  rootId: 'tf_palm',
  links: tfLinks,
  joints: tfJoints,
  note: '三指对称布局，每指 3 关节（外展 / 近端 / 远端），几何为简化件'
})

// ============================================================
// 示例 3：Barrett Hand BH8-280
// 参数来源：jhu-lcsr/barrett_model models/hand.urdf.xacro
//   palm 0.50573kg / prox 0.14109 / med 0.062139 / dist 0.041377
//   关节限位 0..180°(prox) 0..140°(med) 0..48°(dist)，effort 5 N·m，velocity 5 rad/s
// ============================================================
const BAR = {
  palm: {
    mass: 0.50573,
    com: { x: -5.1098e-5, y: 0.0050433, z: 0.036671 },
    inertia: { ixx: 3.8374e-5, ixy: -5.604e-8, ixz: -4.2034e-5, iyy: 2.2405e-4, iyz: 1.3283e-7, izz: 2.0045e-4 }
  },
  prox: {
    mass: 0.14109,
    com: { x: 0.023133, y: 0.00078642, z: 0.00052792 },
    inertia: { ixx: 4.872e-6, ixy: 1.7103e-6, ixz: 3.4041e-8, iyy: 7.6588e-5, iyz: 2.3133e-8, izz: 7.7733e-5 }
  },
  med: {
    mass: 0.062139,
    com: { x: 0.023133, y: 0.00078642, z: 0.00052792 },
    inertia: { ixx: 4.872e-6, ixy: 1.7103e-6, ixz: 3.4041e-8, iyy: 7.6588e-5, iyz: 2.3133e-8, izz: 7.7733e-5 }
  },
  dist: {
    mass: 0.041377,
    com: { x: 0.022825, y: 0.0010491, z: 0.0004203 },
    inertia: { ixx: 3.1582e-6, ixy: 1.4308e-6, ixz: 1.0106e-7, iyy: 3.8376e-5, iyz: 0, izz: 3.7275e-5 }
  }
}

// 简化网格（mm）：外形按原模型各连杆包围盒等比缩放
//  palm 89 x 110 x 90 | prox 65 长、z 抬升到 49 | med 78 长 | dist 46 长
// 手掌：正面收窄，避免把指根整段埋进实体；背面留腕部法兰
emitMesh(
  'bhand_palm',
  merge(
    // 机身：沿 y 的圆柱（Barrett 的圆桶状手掌）
    cylinder({ center: [0, 18, 42], radius: 40, length: 74, axis: 'y', segments: 40 }),
    // 顶部驱动舱
    prism({ min: [-26, 2, 76], max: [26, 46, 90], axis: 'z', chamfer: 0.34 }),
    // 腕部法兰
    prism({ min: [-28, 54, 16], max: [28, 66, 68], axis: 'x', chamfer: 0.36 }),
    // 指根安装面：让三根手指有明确的落座
    prism({ min: [-39, -22, 34], max: [39, -14, 50], axis: 'x', chamfer: 0.26 })
  ),
  1600
)

// 近节：平行四边形连杆的底座 + 抬升臂（中节关节在 x=50, z=33.9）
emitMesh(
  'bhand_finger_prox',
  merge(
    prism({ min: [1, -10.5, -4], max: [62, 10.5, 10], axis: 'x', chamfer: 0.32 }),
    prism({ min: [44, -11, 0], max: [60, 11, 34], axis: 'z', chamfer: 0.28 }),
    cylinder({ center: [0, 0, 3], radius: 11.2, length: 23, axis: 'y', segments: 20 })
  ),
  1600
)

emitMesh(
  'bhand_finger_med',
  merge(
    prism({ min: [1.5, -9.5, -7], max: [75, 9.5, 7], axis: 'x', chamfer: 0.38, taper: [1, 0.9] }),
    cylinder({ center: [0, 0, 0], radius: 9.8, length: 20, axis: 'y', segments: 20 })
  ),
  1600
)

// 远节：原模型 dist 关节 rpy=(0,0,45°)，网格用 -45° 的 visual origin 补回来；
// 这里把 -45° 直接烘进网格，导出后外观与原模型一致（q=0 时与中节共线）
emitMesh(
  'bhand_finger_dist',
  rotateZTris(
    merge(
      prism({ min: [1.5, -8, -6.5], max: [44, 8, 6.5], axis: 'x', chamfer: 0.38, taper: [1, 0.58] }),
      cylinder({ center: [0, 0, 0], radius: 8.4, length: 17, axis: 'y', segments: 20 })
    ),
    -45
  ),
  1600
)

const barColor = { palm: '#6d7681', f1: '#5b8fc9', f2: '#4fae92', f3: '#c39a57' }
const barMassSource = (file) => ({
  fileName: file,
  rawUnits: { mass: 'g', length: 'mm', inertia: 'g*mm^2' },
  note: '来源：jhu-lcsr/barrett_model（Barrett 官方 SolidWorks 模型的质量属性），已换算为 SI',
  parsedAt: '2026-11-11T00:00:00.000Z'
})

const barLinks = [
  makeLink('bhand_palm', 'bhand_palm', BAR.palm, barColor.palm, barMassSource('bhand_palm.txt'))
]
for (const k of ['f1', 'f2']) {
  barLinks.push(
    makeLink(`${k}_prox_link`, 'bhand_finger_prox', BAR.prox, barColor[k], barMassSource('f1_prox_link.txt')),
    makeLink(`${k}_med_link`, 'bhand_finger_med', BAR.med, barColor[k], barMassSource('f1_med_link.txt')),
    makeLink(`${k}_dist_link`, 'bhand_finger_dist', BAR.dist, barColor[k], barMassSource('f1_dist_link.txt'))
  )
}
barLinks.push(
  makeLink('f3_med_link', 'bhand_finger_med', BAR.med, barColor.f3, barMassSource('f1_med_link.txt')),
  makeLink('f3_dist_link', 'bhand_finger_dist', BAR.dist, barColor.f3, barMassSource('f1_dist_link.txt'))
)

const D140 = (140 / 180) * Math.PI
const D48 = (48 / 180) * Math.PI
const barLimit = { lower: 0, upper: Math.PI, effort: 5, velocity: 5 }

const barJoints = []
for (const k of ['f1', 'f2']) {
  const axisZ = k === 'f1' ? -1 : 1
  barJoints.push(
    makeJoint(`${k}_prox_joint`, 'revolute', 'bhand_palm', `${k}_prox_link`, {
      xyz: [k === 'f1' ? -0.025 : 0.025, 0, 0.0415],
      rpy: [0, 0, -Math.PI / 2],
      axis: [0, 0, axisZ],
      limit: barLimit
    }),
    makeJoint(`${k}_med_joint`, 'revolute', `${k}_prox_link`, `${k}_med_link`, {
      xyz: [0.05, 0, 0.0339], rpy: [Math.PI / 2, 0, 0], axis: [0, 0, 1],
      limit: { lower: 0, upper: D140, effort: 5, velocity: 5 }
    }),
    makeJoint(`${k}_dist_joint`, 'revolute', `${k}_med_link`, `${k}_dist_link`, {
      xyz: [0.06994, 0.003, 0], rpy: [0, 0, Math.PI / 4], axis: [0, 0, 1],
      limit: { lower: 0, upper: D48, effort: 5, velocity: 5 }
    })
  )
}
barJoints.push(
  makeJoint('f3_med_joint', 'revolute', 'bhand_palm', 'f3_med_link', {
    xyz: [0, 0.05, 0.0754], rpy: [Math.PI / 2, 0, Math.PI / 2], axis: [0, 0, 1],
    limit: { lower: 0, upper: D140, effort: 5, velocity: 5 }
  }),
  makeJoint('f3_dist_joint', 'revolute', 'f3_med_link', 'f3_dist_link', {
    xyz: [0.06994, 0.003, 0], rpy: [0, 0, Math.PI / 4], axis: [0, 0, 1],
    limit: { lower: 0, upper: D48, effort: 5, velocity: 5 }
  })
)

const barrett = writeProject('barrett_bh8.project.json', {
  robotName: 'barrett_bh8_280',
  rootId: 'bhand_palm',
  links: barLinks,
  joints: barJoints,
  note: 'Barrett Hand BH8-280：运动学与惯性参数取自 jhu-lcsr/barrett_model 的 hand.urdf.xacro（源自官方 SolidWorks 模型），网格为简化几何'
})

// ============================================================
// 示例库索引
// ============================================================
const totalMass = (p) => +p.links.reduce((s, l) => s + l.mass, 0).toFixed(4)

const index = {
  version: 1,
  samples: [
    {
      file: 'three_finger.project.json',
      name: '三指灵巧手',
      subtitle: '3 指 × 3 关节 · 10 连杆',
      desc: '对称三指布局，每指外展 + 近端 + 远端 3 个关节。几何为简化件，质量属性由网格体积积分得到，可直接导出仿真用 URDF。',
      glyph: 'three-finger',
      robotName: threeFinger.robotName,
      links: threeFinger.links.length,
      joints: threeFinger.joints.length,
      mass: totalMass(threeFinger),
      tags: ['对称布局', '10 连杆 / 9 关节'],
      source: '内置生成几何（密度 1150 kg/m³）'
    },
    {
      file: 'barrett_bh8.project.json',
      name: 'Barrett Hand BH8-280',
      subtitle: '三指 4 自由度 · 9 连杆真实参数',
      desc: '工业三指灵巧手。关节类型、origin、轴、限位、质量、质心、惯量全部取自 JHU LCSR 公开的 barrett_model，可直接与 ROS 中的原模型对照。',
      glyph: 'barrett',
      robotName: barrett.robotName,
      links: barrett.links.length,
      joints: barrett.joints.length,
      mass: totalMass(barrett),
      tags: ['真实参数', '9 连杆 / 8 关节'],
      source: 'jhu-lcsr/barrett_model（BH8-280）'
    },
    {
      file: 'finger_hand.project.json',
      name: '单指示例',
      subtitle: '手掌 + 1 指 3 关节 · 4 连杆',
      desc: '最小可跑通链路：上传 → 赋参 → 拼装 → 校验 → 导出。适合第一次上手时对照验收。',
      glyph: 'one-finger',
      robotName: fingerHand.robotName,
      links: fingerHand.links.length,
      joints: fingerHand.joints.length,
      mass: totalMass(fingerHand),
      tags: ['入门', '4 连杆 / 3 关节'],
      source: '内置生成几何（密度 1200 kg/m³）'
    }
  ]
}
fs.writeFileSync(path.join(PUB, 'index.json'), JSON.stringify(index, null, 2) + '\n')

// ============================================================
// SolidWorks 风格质量属性文本（g / mm / g·mm²）
// ============================================================
function swReport(p, opts = {}) {
  const name = opts.name || p.name
  const grams = p.mass * 1000
  const comMM = { x: p.com.x * 1000, y: p.com.y * 1000, z: p.com.z * 1000 }
  const I = (v) => (v * 1e9).toFixed(4) // kg*m^2 -> g*mm^2
  const volumeMM3 = p.volume * 1e9
  const density = p.mass / p.volume // kg/m^3
  return `Mass properties of ${name}
Configuration: Default
Coordinate system: -- default --
Density = ${(density * 1e-6).toFixed(6)} grams/mm^3

Mass = ${grams.toFixed(4)} grams
Volume = ${volumeMM3.toFixed(2)} cubic millimeters
Surface area = ${(opts.area ?? 0).toFixed(2)} square millimeters
Center of mass: ( millimeters )
	X = ${comMM.x.toFixed(2)}
	Y = ${comMM.y.toFixed(2)}
	Z = ${comMM.z.toFixed(2)}

Principal axes of inertia and principal moments of inertia: ( grams * square millimeters )
Taken at the center of mass.
	Ix = (1.00, 0.00, 0.00)	Px = ${I(p.inertia.ixx)}
	Iy = (0.00, 1.00, 0.00)	Py = ${I(p.inertia.iyy)}
	Iz = (0.00, 0.00, 1.00)	Pz = ${I(p.inertia.izz)}

Moments of inertia: ( grams * square millimeters )
Taken at the center of mass.
	Lxx = ${I(p.inertia.ixx)}	Lxy = ${I(p.inertia.ixy)}	Lzx = ${I(p.inertia.ixz)}
	Lyy = ${I(p.inertia.iyy)}	Lyz = ${I(p.inertia.iyz)}
	Lzz = ${I(p.inertia.izz)}

Moments of inertia: ( grams * square millimeters )
Taken at the output coordinate system.
	Ixx = ${I(p.inertia.ixx + p.mass * (comMM.y ** 2 + comMM.z ** 2) * 1e-6)}
	Ixy = ${I(p.inertia.ixy - p.mass * p.com.x * p.com.y)}
	Ixz = ${I(p.inertia.ixz - p.mass * p.com.x * p.com.z)}
	Iyy = ${I(p.inertia.iyy + p.mass * (comMM.x ** 2 + comMM.z ** 2) * 1e-6)}
	Iyz = ${I(p.inertia.iyz - p.mass * p.com.y * p.com.z)}
	Izz = ${I(p.inertia.izz + p.mass * (comMM.x ** 2 + comMM.y ** 2) * 1e-6)}
`
}

const areaOf = (p) =>
  p.size ? 2 * (p.size.sx * p.size.sy + p.size.sy * p.size.sz + p.size.sx * p.size.sz) * 1e6 : 0

// 示例 1 的四个零件（保持与旧版一致）
for (const p of parts) {
  const txt = swReport(p, { area: areaOf(p) })
  fs.writeFileSync(path.join(MP, `${p.name}.txt`), txt)
  fs.writeFileSync(path.join(PUB, 'massprops', `${p.name}.txt`), txt)
}

// 中文版（单零件，演示中文标签）
const zh = `“${byName.palm.name}”的质量属性
配置：默认
坐标系：-- 默认 --
密度 = 0.00120 克/立方毫米

质量 = ${(byName.palm.mass * 1000).toFixed(4)} 克
体积 = ${(byName.palm.volume * 1e9).toFixed(2)} 立方毫米
表面积 = 19590.00 平方毫米
重心: ( 毫米 )
	X = ${(byName.palm.com.x * 1000).toFixed(2)}
	Y = ${(byName.palm.com.y * 1000).toFixed(2)}
	Z = ${(byName.palm.com.z * 1000).toFixed(2)}

惯性主轴和惯性力矩: ( 克 * 平方毫米 )
	由重心决定。
	Ix = (1.00, 0.00, 0.00)	Px = ${(byName.palm.inertia.ixx * 1e9).toFixed(2)}
	Iy = (0.00, 1.00, 0.00)	Py = ${(byName.palm.inertia.iyy * 1e9).toFixed(2)}
	Iz = (0.00, 0.00, 1.00)	Pz = ${(byName.palm.inertia.izz * 1e9).toFixed(2)}

惯性力矩: ( 克 * 平方毫米 )
	由重心决定。
	Lxx = ${(byName.palm.inertia.ixx * 1e9).toFixed(2)}	Lxy = 0.00	Lzx = 0.00
	Lyy = ${(byName.palm.inertia.iyy * 1e9).toFixed(2)}	Lyz = 0.00
	Lzz = ${(byName.palm.inertia.izz * 1e9).toFixed(2)}
`
fs.writeFileSync(path.join(MP, 'palm_zh.txt'), zh)
fs.writeFileSync(path.join(PUB, 'massprops', 'palm_zh.txt'), zh)

// CSV 形式（模拟另存为 CSV）
const ph = byName.f1_proximal
const csv = [
  'Property,Value,Units',
  `Mass,${(ph.mass * 1000).toFixed(4)},grams`,
  `Volume,${(ph.volume * 1e9).toFixed(2)},cubic millimeters`,
  `Center of mass X,${(ph.com.x * 1000).toFixed(2)},millimeters`,
  `Center of mass Y,${(ph.com.y * 1000).toFixed(2)},millimeters`,
  `Center of mass Z,${(ph.com.z * 1000).toFixed(2)},millimeters`,
  `Lxx,${(ph.inertia.ixx * 1e9).toFixed(2)},grams * square millimeters`,
  `Lxy,0.00,grams * square millimeters`,
  `Lzx,0.00,grams * square millimeters`,
  `Lyy,${(ph.inertia.iyy * 1e9).toFixed(2)},grams * square millimeters`,
  `Lyz,0.00,grams * square millimeters`,
  `Lzz,${(ph.inertia.izz * 1e9).toFixed(2)},grams * square millimeters`
].join('\n') + '\n'
fs.writeFileSync(path.join(MP, 'f1_proximal.csv'), csv)
fs.writeFileSync(path.join(PUB, 'massprops', 'f1_proximal.csv'), csv)

// 被“改乱”的文本：质量/质心还在，惯量块被破坏 -> 部分识别，需手填
const broken = `Mass properties of palm
Configuration: Default
Mass = 275.4000 grams
Volume = 229500.00 cubic millimeters
Center of mass: ( millimeters )
	X = 25.00
	Y = 0.00
	Z = 0.00

Moments of inertia: ( grams * square millimeters )
Taken at the center of mass.
	Lxx = ???	Lxy = n/a	Lzx = n/a
	Lyy = ???	Lyz = n/a
	Lzz = ???
`
fs.writeFileSync(path.join(MP, 'palm_broken.txt'), broken)
fs.writeFileSync(path.join(PUB, 'massprops', 'palm_broken.txt'), broken)

// 三指手的四类零件
for (const [name, prop] of [
  ['tf_palm', meshPropsByName.tf_palm],
  ['tf_prox', meshPropsByName.tf_prox],
  ['tf_mid', meshPropsByName.tf_mid],
  ['tf_dist', meshPropsByName.tf_dist]
]) {
  const txt = swReport(prop, { name })
  fs.writeFileSync(path.join(MP, `${name}.txt`), txt)
  fs.writeFileSync(path.join(PUB, 'massprops', `${name}.txt`), txt)
}

// Barrett 的四个零件：数值来自官方 CAD，体积按质量/密度反算（仅为报告完整性）
const barDensity = 1550 // kg/m^3，接近铝 + 内部机构
for (const [name, prop] of [
  ['bhand_palm', BAR.palm],
  ['f1_prox_link', BAR.prox],
  ['f1_med_link', BAR.med],
  ['f1_dist_link', BAR.dist]
]) {
  const txt = swReport({ ...prop, volume: prop.mass / barDensity }, { name })
  fs.writeFileSync(path.join(MP, `${name}.txt`), txt)
  fs.writeFileSync(path.join(PUB, 'massprops', `${name}.txt`), txt)
}

// ---------- 参数表模板（Excel 友好的 SI 表） ----------
const num = (v) => {
  const n = Number(v) || 0
  return n === 0 ? '0' : n.toFixed(14).replace(/0+$/, '').replace(/\.$/, '')
}
const tplDir = path.join(ROOT, 'samples', 'templates')
fs.mkdirSync(tplDir, { recursive: true })
const tplFor = (project) =>
  [
    'link,mass_kg,com_x,com_y,com_z,ixx,ixy,ixz,iyy,iyz,izz,inertia_frame,mesh_file,mesh_unit',
    ...project.links.map((l) =>
      [
        l.name,
        num(l.mass),
        num(l.com.x),
        num(l.com.y),
        num(l.com.z),
        num(l.inertia.ixx),
        num(l.inertia.ixy),
        num(l.inertia.ixz),
        num(l.inertia.iyy),
        num(l.inertia.iyz),
        num(l.inertia.izz),
        l.inertiaFrame,
        l.mesh.fileName,
        l.mesh.unitScale
      ].join(',')
    )
  ].join('\n') + '\n'

fs.writeFileSync(path.join(tplDir, 'link_params.csv'), tplFor(fingerHand))
fs.writeFileSync(path.join(tplDir, 'link_params_barrett.csv'), tplFor(barrett))
fs.writeFileSync(path.join(tplDir, 'link_params_three_finger.csv'), tplFor(threeFinger))

fs.mkdirSync(path.join(ROOT, 'tools'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'tools', 'check_urdf.py'), CHECK_URDF_PY)

console.log('示例数据已生成:')
console.log(' - public/samples/meshes/', Object.keys(meshFiles).join(', '))
console.log(' - public/samples/index.json（示例库索引）')
for (const s of index.samples) {
  console.log(` - ${s.file.padEnd(28)} ${String(s.links).padStart(2)} links / ${s.joints} joints / ${s.mass} kg`)
}
console.log(' - samples/massprops/*.txt|csv')
console.log(' - tools/check_urdf.py')
console.log(' - samples/templates/link_params*.csv')
