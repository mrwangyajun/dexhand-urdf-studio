/**
 * 生成示例数据包：
 *  - public/samples/meshes/*.stl   简化几何体，单位 mm（模拟 SolidWorks 导出的 STL）
 *  - public/samples/finger_hand.project.json  工程文件（SI 参数）
 *  - samples/massprops/*.txt|csv   模拟 SolidWorks 质量属性导出（g / mm）
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

// ---------- 几何 ----------
function boxTriangles(min, max) {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const P = (x, y, z) => [x, y, z]
  const a = P(x0, y0, z0), b = P(x1, y0, z0), c = P(x1, y1, z0), d = P(x0, y1, z0)
  const e = P(x0, y0, z1), f = P(x1, y0, z1), g = P(x1, y1, z1), h = P(x0, y1, z1)
  const quads = [
    [a, d, c, b],
    [e, f, g, h],
    [a, b, f, e],
    [d, h, g, c],
    [a, e, h, d],
    [b, c, g, f]
  ]
  const tris = []
  for (const q of quads) {
    tris.push([q[0], q[1], q[2]])
    tris.push([q[0], q[2], q[3]])
  }
  return tris
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
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

// ---------- 参数 ----------
const DENSITY = 1200 // kg/m^3，近似 PLA/工程塑料

function boxProps(name, min, max) {
  const sx = max[0] - min[0]
  const sy = max[1] - min[1]
  const sz = max[2] - min[2]
  const volume = sx * sy * sz
  const mass = volume * DENSITY
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

// ---------- 写 mesh（mm） ----------
const meshFiles = {}
for (const p of parts) {
  const tris = boxTriangles(
    p.min.map((v) => v * 1000),
    p.max.map((v) => v * 1000)
  )
  const fn = `${p.name}.stl`
  const bytes = writeStlBinary(path.join(PUB, 'meshes', fn), tris, `sample ${p.name} (unit: mm)`)
  meshFiles[p.name] = { fileName: fn, bytes }
}

// ---------- 写工程文件 ----------
const byName = Object.fromEntries(parts.map((p) => [p.name, p]))
const linkDefs = [
  { name: 'palm', part: byName.palm, color: '#7f90a6' },
  { name: 'f1_proximal', part: byName.f1_proximal, color: '#5f8fc4' },
  { name: 'f1_middle', part: byName.f1_middle, color: '#5fae90' },
  { name: 'f1_distal', part: byName.f1_distal, color: '#d8b878' }
]

const links = linkDefs.map((d, i) => ({
  id: `link_${d.name}`,
  name: d.name,
  mesh: { fileName: meshFiles[d.name].fileName, unitScale: 'mm', format: 'stl', size: meshFiles[d.name].bytes },
  mass: +d.part.mass.toFixed(9),
  com: { x: +d.part.com.x.toFixed(9), y: +d.part.com.y.toFixed(9), z: +d.part.com.z.toFixed(9) },
  inertia: Object.fromEntries(Object.entries(d.part.inertia).map(([k, v]) => [k, +v.toFixed(14)])),
  inertiaFrame: 'com',
  color: d.color,
  placeholder: false,
  massSource: {
    fileName: `${d.name}.txt`,
    rawUnits: { mass: 'g', length: 'mm', inertia: 'g*mm^2' },
    note: '示例数据：由 gen-samples.mjs 按密度 1200 kg/m³ 生成，与 samples/massprops/*.txt 数值一致',
    parsedAt: '2026-11-11T00:00:00.000Z'
  }
}))

const joints = [
  {
    id: 'joint_f1_abd',
    name: 'f1_joint_abd',
    type: 'revolute',
    parentId: 'link_palm',
    childId: 'link_f1_proximal',
    origin: { xyz: { x: 0.07, y: 0.02, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
    axis: { x: 0, y: 0, z: 1 },
    limit: { lower: -0.35, upper: 0.35, effort: 2, velocity: 2 }
  },
  {
    id: 'joint_f1_mcp',
    name: 'f1_joint_mcp',
    type: 'revolute',
    parentId: 'link_f1_proximal',
    childId: 'link_f1_middle',
    origin: { xyz: { x: 0.03, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
    axis: { x: 0, y: 1, z: 0 },
    limit: { lower: -1.4, upper: 0.05, effort: 1.5, velocity: 3 }
  },
  {
    id: 'joint_f1_dip',
    name: 'f1_joint_dip',
    type: 'revolute',
    parentId: 'link_f1_middle',
    childId: 'link_f1_distal',
    origin: { xyz: { x: 0.026, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } },
    axis: { x: 0, y: 1, z: 0 },
    limit: { lower: -1.5, upper: 0.05, effort: 1, velocity: 3 }
  }
]

const project = {
  version: 1,
  robotName: 'dex_hand_demo',
  createdAt: '2026-11-11T00:00:00.000Z',
  updatedAt: '2026-11-11T00:00:00.000Z',
  rootId: 'link_palm',
  meshBaseDir: 'meshes/',
  links,
  joints
}
fs.writeFileSync(path.join(PUB, 'finger_hand.project.json'), JSON.stringify(project, null, 2) + '\n')

// ---------- 写 SolidWorks 风格质量属性文本（g / mm） ----------
function swReport(p, opts = {}) {
  const grams = p.mass * 1000
  const comMM = { x: p.com.x * 1000, y: p.com.y * 1000, z: p.com.z * 1000 }
  const I = (v) => (v * 1000 * 1000 * 1000).toFixed(2) // kg*m^2 -> g*mm^2
  const volumeMM3 = p.volume * 1e9
  return `Mass properties of ${p.name}
Configuration: Default
Coordinate system: -- default --
Density = ${(DENSITY * 1e-6).toFixed(6)} grams/mm^3

Mass = ${grams.toFixed(4)} grams
Volume = ${volumeMM3.toFixed(2)} cubic millimeters
Surface area = ${(2 * (p.size.sx * p.size.sy + p.size.sy * p.size.sz + p.size.sx * p.size.sz) * 1e6).toFixed(2)} square millimeters
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
	Ixx = ${I(p.inertia.ixx + p.mass * ((p.com.y * 1000) ** 2 + (p.com.z * 1000) ** 2) * 1e-9)}
	Ixy = ${I(p.inertia.ixy - p.mass * p.com.x * p.com.y)}
	Ixz = ${I(p.inertia.ixz - p.mass * p.com.x * p.com.z)}
	Iyy = ${I(p.inertia.iyy + p.mass * ((p.com.x * 1000) ** 2 + (p.com.z * 1000) ** 2) * 1e-9)}
	Iyz = ${I(p.inertia.iyz - p.mass * p.com.y * p.com.z)}
	Izz = ${I(p.inertia.izz + p.mass * ((p.com.x * 1000) ** 2 + (p.com.y * 1000) ** 2) * 1e-9)}
`
}

for (const p of parts) {
  fs.writeFileSync(path.join(MP, `${p.name}.txt`), swReport(p))
  fs.writeFileSync(path.join(PUB, 'massprops', `${p.name}.txt`), swReport(p))
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

// ---------- 参数表模板（Excel 友好的 SI 表） ----------
const num = (v) => {
  const n = Number(v) || 0
  return n === 0 ? '0' : n.toFixed(14).replace(/0+$/, '').replace(/\.$/, '')
}
const tplDir = path.join(ROOT, 'samples', 'templates')
fs.mkdirSync(tplDir, { recursive: true })
const tpl = [
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
].join('\n')
fs.writeFileSync(path.join(tplDir, 'link_params.csv'), tpl + '\n')

fs.mkdirSync(path.join(ROOT, 'tools'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'tools', 'check_urdf.py'), CHECK_URDF_PY)

console.log('示例数据已生成:')
console.log(' - public/samples/meshes/', Object.keys(meshFiles).join(', '))
console.log(' - public/samples/finger_hand.project.json')
console.log(' - samples/massprops/*.txt|csv')
console.log(' - tools/check_urdf.py')
console.log(' - samples/templates/link_params.csv')
