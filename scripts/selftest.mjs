/**
 * 无浏览器自测：parser / inertia / urdf / validate / zip
 * 运行： node scripts/selftest.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

import { parseMassProperties } from '../src/core/parser.js'
import { buildUrdf, uniqueNames } from '../src/core/urdf.js'
import { validateProject } from '../src/core/validate.js'
import { normalizeProject } from '../src/core/project.js'
import { inertiaToCom } from '../src/core/inertia.js'
import { buildExportZip } from '../src/core/exportZip.js'
import { wouldCreateCycle, traceTree } from '../src/core/tree.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function near(a, b, tol = 1e-9) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8')
}

/** 极简 XML 良构检查 */
function assertWellFormed(xml) {
  const src = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const re = /<(\/?)([A-Za-z_][\w.:-]*)([^<>]*?)(\/?)>/g
  const stack = []
  let m
  let last = 0
  while ((m = re.exec(src)) !== null) {
    const between = src.slice(last, m.index)
    if (between.trim()) throw new Error(`标签之间有裸文本: "${between.trim().slice(0, 40)}"`)
    last = re.lastIndex
    const [, close, name, attrs, self] = m
    if (attrs.includes('<') || attrs.includes('>')) throw new Error(`属性非法: ${name}`)
    if (close) {
      const top = stack.pop()
      if (top !== name) throw new Error(`标签不匹配: </${name}> vs <${top}>`)
    } else if (!self) {
      stack.push(name)
    }
  }
  if (src.slice(last).trim()) throw new Error('结尾有裸文本')
  if (stack.length) throw new Error(`标签未闭合: ${stack.join(',')}`)
}

function attrsOf(xml, tag, nameAttr) {
  const out = []
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'g')
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

function getAttr(attrStr, key) {
  const m = attrStr.match(new RegExp(`${key}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

const rawProject = JSON.parse(read('public/samples/finger_hand.project.json'))

// ============ 1. 质量属性解析 ============
console.log('\n[1] SolidWorks 质量属性解析')
const palm = parseMassProperties(read('samples/massprops/palm.txt'))
ok('palm.txt 识别成功', palm.ok, `missing=${palm.missing}`)
ok('palm 质量 = 0.2754 kg', near(palm.mass, 0.2754, 1e-6), String(palm.mass))
ok('palm 质心 X = 0.025 m', near(palm.com?.x, 0.025, 1e-6), String(palm.com?.x))
ok('palm 质心 Y/Z = 0', near(palm.com?.y, 0, 1e-9) && near(palm.com?.z, 0, 1e-9))
ok('palm 惯量 Ixx = 1.8646875e-4', near(palm.inertia?.ixx, 1.8646875e-4, 1e-6), String(palm.inertia?.ixx))
ok('palm 惯量单位 g·mm² -> kg·m²', palm.meta.inertiaUnit?.factor === 1e-9)
ok('palm 参考系为质心', palm.inertiaFrame === 'com')
ok('palm 原始单位标注 g/mm', palm.meta.massUnit?.key === 'g' && palm.meta.lengthUnit?.key === 'mm')

const zh = parseMassProperties(read('samples/massprops/palm_zh.txt'))
ok('中文标签也能识别', zh.ok && near(zh.mass, 0.2754, 1e-6), `ok=${zh.ok} mass=${zh.mass}`)
ok('中文质心 = 0.025 m', near(zh.com?.x, 0.025, 1e-6), String(zh.com?.x))

const csv = parseMassProperties(read('samples/massprops/f1_proximal.csv'))
ok('CSV 识别成功', csv.ok, `missing=${csv.missing}`)
ok('CSV 质量 = 0.011664 kg', near(csv.mass, 0.011664, 1e-5), String(csv.mass))

const broken = parseMassProperties(read('samples/massprops/palm_broken.txt'))
ok('乱码文本仍保留可识别字段', !broken.ok && near(broken.mass, 0.2754, 1e-6) && !!broken.com)
ok('乱码文本标记惯量缺失', broken.missing.includes('inertia'), JSON.stringify(broken.missing))

const junk = parseMassProperties('hello world, 这不是质量属性')
ok('完全无关文本 -> ok=false', !junk.ok && junk.missing.length === 3)

const outputFrame = parseMassProperties(`Mass = 1.0000 kilograms
Center of mass: ( meters )
\tX = 0.10
\tY = 0.00
\tZ = 0.00
Moments of inertia: ( kilograms * square meters )
Taken at the center of mass.
\tLxx = 0.001	Lxy = 0.0	Lzx = 0.0
\tLyy = 0.002	Lyz = 0.0
\tLzz = 0.003
Moments of inertia: ( kilograms * square meters )
Taken at the output coordinate system.
\tIxx = 0.011	Ixy = 0.0	Ixz = 0.0
\tIyy = 0.012	Iyz = 0.0
\tIzz = 0.013
`)
ok('优先取「相对质心」的惯量', near(outputFrame.inertia?.ixx, 0.001, 1e-9) && outputFrame.inertiaFrame === 'com')

const onlyOutput = parseMassProperties(`Mass = 2.0000 kilograms
Center of mass: ( meters )
\tX = 0.10
\tY = 0.00
\tZ = 0.00
Moments of inertia: ( kilograms * square meters )
Taken at the output coordinate system.
\tIxx = 0.010	Ixy = 0.0	Ixz = 0.0
\tIyy = 0.010	Iyz = 0.0
\tIzz = 0.010
`)
ok('只有输出坐标系惯量时标注 output', onlyOutput.inertiaFrame === 'output' && onlyOutput.ok)

// 回归：零件名里带数字时，不能把标题行的数字当质量
const nameWithDigits = parseMassProperties('Mass properties of part_123\nConfiguration: Default\nMass = 27.5000 grams\nCenter of mass: ( millimeters )\n\tX = 1\n\tY = 2\n\tZ = 3\n')
ok('标题行含数字不误判质量', near(nameWithDigits.mass, 0.0275, 1e-9), String(nameWithDigits.mass))

// 四个示例文件解析值必须与工程 JSON 一致
const massFiles = ['palm', 'f1_proximal', 'f1_middle', 'f1_distal']
for (const name of massFiles) {
  const parsed = parseMassProperties(read(`samples/massprops/${name}.txt`))
  const link = rawProject?.links?.find((l) => l.name === name)
  ok(`samples/massprops/${name}.txt 与工程一致`, !!link && near(parsed.mass, link.mass, 1e-9), `${parsed.mass} vs ${link?.mass}`)
}

// ============ 2. 惯量换算 ============
console.log('\n[2] 惯量换算（平行轴）')
const m = 0.5
const com = { x: 0.1, y: 0.2, z: 0.05 }
const iCom = { ixx: 0.001, ixy: 0.0002, ixz: 0.0001, iyy: 0.002, iyz: 0.0003, izz: 0.0025 }
const iOut = {
  ixx: iCom.ixx + m * (com.y ** 2 + com.z ** 2),
  iyy: iCom.iyy + m * (com.x ** 2 + com.z ** 2),
  izz: iCom.izz + m * (com.x ** 2 + com.y ** 2),
  ixy: iCom.ixy - m * com.x * com.y,
  ixz: iCom.ixz - m * com.x * com.z,
  iyz: iCom.iyz - m * com.y * com.z
}
const back = inertiaToCom(iOut, 'output', m, com)
ok('output -> com 往返一致', near(back.ixx, iCom.ixx, 1e-9) && near(back.ixy, iCom.ixy, 1e-9) && near(back.izz, iCom.izz, 1e-9))

// ============ 3. 工程校验 + 树 ============
console.log('\n[3] 工程校验与关节树')

for (const l of rawProject.links) {
  const stl = fs.readFileSync(path.join(ROOT, 'public/samples/meshes', l.mesh.fileName))
  l.mesh.dataBase64 = stl.toString('base64')
  l.mesh.size = stl.byteLength
}
const project = normalizeProject(rawProject)
const tree = traceTree(project)
ok('树遍历出 4 个 link', tree.nodes.length === 4, String(tree.nodes.length))
ok('无悬空 link', tree.unreachable.length === 0)
ok('root 为 palm', project.links.find((l) => l.id === project.rootId)?.name === 'palm')

const v1 = validateProject(project)
ok('示例工程 0 error', v1.errorCount === 0, v1.items.filter((i) => i.level === 'error').map((i) => i.message).join(' | '))

const brokenProject = JSON.parse(JSON.stringify(project))
brokenProject.links[0].mass = 0
const v2 = validateProject(brokenProject)
ok('缺质量会被拦截', v2.errorCount > 0 && v2.items.some((i) => i.code === 'mass-missing'))

const cycleProject = JSON.parse(JSON.stringify(project))
ok('成环检测', wouldCreateCycle(cycleProject.joints, 'link_f1_distal', 'link_palm') === true)
ok('正常连接不成环', wouldCreateCycle(cycleProject.joints, 'link_f1_distal', 'link_new') === false)

// ============ 4. URDF 生成 ============
console.log('\n[4] URDF 生成')
const urdf = buildUrdf(project, { robotName: 'dex_hand_demo' })
assertWellFormed(urdf)
ok('XML 良构', true)
const linksXml = attrsOf(urdf, 'link')
const jointsXml = attrsOf(urdf, 'joint')
ok('4 个 link', linksXml.length === 4, String(linksXml.length))
ok('3 个 joint', jointsXml.length === 3, String(jointsXml.length))
ok('robot name 正确', urdf.includes('<robot name="dex_hand_demo">'))
ok('mm 网格写入 scale=0.001', urdf.includes('scale="0.001 0.001 0.001"'))
ok('mesh 路径为 meshes/palm.stl', urdf.includes('filename="meshes/palm.stl"'))
ok('revolute 带 limit', /<joint name="f1_joint_mcp" type="revolute">[\s\S]*?<limit lower="-1.4" upper="0.05" effort="1.5" velocity="3"\/>/.test(urdf))

function parseInertial(xml, linkName) {
  const block = xml.match(new RegExp(`<link name="${linkName}">([\\s\\S]*?)</link>`))
  if (!block) return null
  const origin = block[1].match(/<inertial>\s*<origin xyz="([^"]+)" rpy="[^"]+"\/>/)
  const mass = block[1].match(/<mass value="([^"]+)"\/>/)
  const inertia = block[1].match(/<inertia ([^/]+)\/>/)
  return {
    xyz: origin ? origin[1].split(' ').map(Number) : null,
    mass: mass ? Number(mass[1]) : null,
    inertia: inertia
      ? Object.fromEntries(
          ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'].map((k) => [k, Number(getAttr(inertia[1], k))])
        )
      : null
  }
}
const palmIn = parseInertial(urdf, 'palm')
ok('palm 质量与面板一致', near(palmIn.mass, project.links[0].mass, 1e-9), `${palmIn.mass} vs ${project.links[0].mass}`)
ok('palm 质心与面板一致', near(palmIn.xyz[0], project.links[0].com.x, 1e-9))
ok('palm 惯量与面板一致', near(palmIn.inertia.ixx, project.links[0].inertia.ixx, 1e-8), String(palmIn.inertia.ixx))

// 数值精度：微小惯量不能被截断成 0.0000006
ok('微小惯量保留有效位数', /ixx="0\.000000629856"/.test(urdf), urdf.match(/ixx="[^"]*"/)?.slice(0, 12).join(' '))

// 改参数 -> 输出同步
const modified = JSON.parse(JSON.stringify(project))
const jm = modified.joints.find((j) => j.name === 'f1_joint_mcp')
jm.origin.xyz = { x: 0.031, y: 0.002, z: 0.003 }
jm.axis = { x: 0, y: 0, z: 1 }
jm.limit = { lower: -0.5, upper: 0.5, effort: 2.2, velocity: 4.4 }
const urdf2 = buildUrdf(modified, { robotName: 'dex_hand_demo' })
ok('origin 改动写入 URDF', urdf2.includes('<origin xyz="0.031 0.002 0.003" rpy="0 0 0"/>'))
ok('axis 改动写入 URDF', /<joint name="f1_joint_mcp" type="revolute">[\s\S]*?<axis xyz="0 0 1"\/>/.test(urdf2))
ok('limit 改动写入 URDF', urdf2.includes('lower="-0.5" upper="0.5" effort="2.2" velocity="4.4"'))

// 惯量参考系换算
const outputFrameProject = JSON.parse(JSON.stringify(project))
outputFrameProject.links[0].inertiaFrame = 'output'
outputFrameProject.links[0].inertia = {
  ixx: 2.5e-4,
  ixy: 0,
  ixz: 0,
  iyy: 2.8e-4,
  iyz: 0,
  izz: 4.2e-4
}
const urdf3 = buildUrdf(outputFrameProject, {})
const palmOut = parseInertial(urdf3, 'palm')
ok(
  '输出坐标系惯量在导出时换算到质心（Iyy 减去 m·dx²）',
  near(palmOut.inertia.iyy, 2.8e-4 - 0.2754 * 0.025 ** 2, 1e-6),
  `${palmOut.inertia.iyy}`
)
ok('Ixx 不受 X 向偏移影响', near(palmOut.inertia.ixx, 2.5e-4, 1e-9))

// 工程文件往返：序列化 -> 反序列化后参数与 URDF 必须一致
const roundTrip = normalizeProject(JSON.parse(JSON.stringify(project)))
const urdfRT = buildUrdf(roundTrip, { robotName: 'dex_hand_demo' })
const stripComment = (x) => x.replace(/<!--[^>]*-->/g, '')
ok('工程 JSON 往返后 URDF 一致', stripComment(urdfRT) === stripComment(urdf))
ok('往返后属性不变', near(roundTrip.links[0].mass, project.links[0].mass, 1e-12) && roundTrip.joints.length === 3)

// 多个 root / 悬空 link
const multiRoot = JSON.parse(JSON.stringify(project))
multiRoot.links.push({
  id: 'link_extra',
  name: 'extra',
  mesh: null,
  mass: 0.01,
  com: { x: 0, y: 0, z: 0 },
  inertia: { ixx: 1e-7, ixy: 0, ixz: 0, iyy: 1e-7, iyz: 0, izz: 1e-7 },
  inertiaFrame: 'com'
})
const vMR = validateProject(normalizeProject(multiRoot))
ok('多个 root 被拦截', vMR.items.some((i) => i.code === 'multi-root'), vMR.items.map((i) => i.code).join(','))
ok('多 root 时不允许导出', vMR.canExport === false)

// 占位值只警告不阻断
const placeholderProject = JSON.parse(JSON.stringify(project))
placeholderProject.links[0].placeholder = true
const vPH = validateProject(placeholderProject)
ok('占位值给警告但可导出', vPH.canExport === true && vPH.items.some((i) => i.code === 'placeholder'))

// ============ 5. 打包 ============
console.log('\n[5] 导出 zip')
const { zip } = await buildExportZip(project, { robotName: 'dex_hand_demo' })
const buf = await zip.generateAsync({ type: 'nodebuffer' })
const back2 = await JSZip.loadAsync(buf)
const files = Object.keys(back2.files)
ok('包含 robot.urdf', files.includes('robot.urdf'))
ok('包含 4 个 mesh', files.filter((f) => f.startsWith('meshes/') && f.endsWith('.stl')).length === 4, files.join(','))
ok('包含 README.md', files.includes('README.md'))
ok('包含 check_urdf.py', files.includes('check_urdf.py'))
ok('包含 params.json', files.includes('params.json'))
const urdfInZip = await back2.file('robot.urdf').async('string')
const stripTs = (x) => x.replace(/<!--[^>]*-->/g, '')
ok('zip 内 URDF 与预览一致（忽略生成时间注释）', stripTs(urdfInZip) === stripTs(urdf))
const stlInZip = await back2.file('meshes/palm.stl').async('nodebuffer')
ok('mesh 字节与原始文件一致', stlInZip.equals(fs.readFileSync(path.join(ROOT, 'public/samples/meshes/palm.stl'))))
const readme = await back2.file('README.md').async('string')
ok('README 含 ROS2 检查步骤', readme.includes('check_urdf robot.urdf') && readme.includes('rviz2'))

// ============ 6. 名称清洗 ============
console.log('\n[6] 名称与边界')
const namesProject = JSON.parse(JSON.stringify(project))
namesProject.links[1].name = 'f1 proximal'
namesProject.links[2].name = 'f1_proximal'
const uniq = uniqueNames(namesProject.links, 'link')
const uniqVals = [...uniq.values()]
ok('非法字符被清洗', !uniqVals.some((n) => /\s/.test(n)), uniqVals.join(','))
ok('清洗后名字不重复', new Set(uniqVals).size === uniqVals.length, uniqVals.join(','))
ok('同名追加序号', uniqVals.filter((n) => n.startsWith('f1_proximal')).length === 2, uniqVals.join(','))
const urdf4 = buildUrdf(namesProject, {})
assertWellFormed(urdf4)
ok('清洗后 URDF 仍良构', true)
const v4 = validateProject(namesProject)
ok('重名会被校验发现', v4.items.some((i) => i.code === 'dup-link-name' || i.code === 'unsafe-link-name'))

// ============ 汇总 ============
console.log(`\n===== ${pass} passed, ${fail} failed =====`)
if (fail) {
  for (const f of failures) console.log(` - ${f}`)
  process.exit(1)
}
