/**
 * 导出包实测：对示例库里的每个工程生成 zip -> 解压 -> 用 tools/check_urdf.py（纯 Python）校验
 * 另含一个故意破坏的负例，确认校验器不是永远返回 0。
 * 用法： node scripts/verify-export.mjs            # 校验全部示例
 *        node scripts/verify-export.mjs barrett_bh8.project.json
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { buildExportZip } from '../src/core/exportZip.js'
import { normalizeProject } from '../src/core/project.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUB = path.join(ROOT, 'public', 'samples')
const py = process.platform === 'win32' ? 'python' : 'python3'
const run = (urdf) => spawnSync(py, [path.join(ROOT, 'tools', 'check_urdf.py'), urdf], { encoding: 'utf8' })

function load(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(PUB, file), 'utf8'))
  for (const l of raw.links) {
    const stl = fs.readFileSync(path.join(PUB, 'meshes', l.mesh.fileName))
    l.mesh.dataBase64 = stl.toString('base64')
    l.mesh.size = stl.byteLength
  }
  return normalizeProject(raw)
}

async function exportAndUnzip(project, robotName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urdf-verify-'))
  const { zip } = await buildExportZip(project, { robotName })
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const loaded = await JSZip.loadAsync(buf)
  for (const name of Object.keys(loaded.files)) {
    const f = loaded.files[name]
    if (f.dir) continue
    const target = path.join(dir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, await f.async('nodebuffer'))
  }
  return { dir, loaded, files: Object.keys(loaded.files).filter((n) => !loaded.files[n].dir) }
}

const index = JSON.parse(fs.readFileSync(path.join(PUB, 'index.json'), 'utf8'))
const only = process.argv[2]
const targets = only ? index.samples.filter((s) => s.file === only) : index.samples

let allGood = true
for (const s of targets) {
  const project = load(s.file)
  const { dir, files } = await exportAndUnzip(project, project.robotName)
  const urdf = path.join(dir, 'robot.urdf')
  const res = run(urdf)
  const good = res.status === 0
  allGood = allGood && good
  console.log(`\n=== ${s.name}  (${s.file}) ===`)
  console.log(`解压到: ${dir}`)
  console.log(`文件: ${files.join(', ')}`)
  console.log((res.stdout || res.stderr).trim())
  console.log(`退出码: ${res.status} ${good ? '✓' : '✗'}`)
}

// 负例：删掉一个 limit + 质量置 0，校验器必须报错
const broken = load('finger_hand.project.json')
const { dir: brokenDir, loaded } = await exportAndUnzip(broken, 'dex_hand_demo')
const urdfPath = path.join(brokenDir, 'robot.urdf')
const brokenXml = fs
  .readFileSync(urdfPath, 'utf8')
  .replace(/<limit lower="-1.4" upper="0.05" effort="1.5" velocity="3"\/>/, '')
  .replace('<mass value="0.2754"/>', '<mass value="0"/>')
fs.writeFileSync(urdfPath, brokenXml)
const badRun = run(urdfPath)
const bad = badRun.status === 1

console.log('\n--- check_urdf.py（故意破坏：删 limit + 质量置 0）---')
console.log((badRun.stdout || badRun.stderr).trim())
console.log('退出码:', badRun.status)

console.log(`\n===== ${allGood && bad ? 'PASS' : 'FAIL'}: ${targets.length} 个示例包通过=${allGood}, 坏包被拦截=${bad} =====`)
if (!allGood || !bad) process.exit(1)
