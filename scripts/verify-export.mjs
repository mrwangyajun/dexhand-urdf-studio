/**
 * 导出包实测：生成 zip -> 解压 -> 用 tools/check_urdf.py（纯 Python）校验
 * 用法： node scripts/verify-export.mjs
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

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/samples/finger_hand.project.json'), 'utf8'))
for (const l of raw.links) {
  const stl = fs.readFileSync(path.join(ROOT, 'public/samples/meshes', l.mesh.fileName))
  l.mesh.dataBase64 = stl.toString('base64')
  l.mesh.size = stl.byteLength
}
const project = normalizeProject(raw)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urdf-verify-'))
const { zip } = await buildExportZip(project, { robotName: 'dex_hand_demo' })
const buf = await zip.generateAsync({ type: 'nodebuffer' })
const loaded = await JSZip.loadAsync(buf)
for (const name of Object.keys(loaded.files)) {
  const f = loaded.files[name]
  if (f.dir) continue
  const target = path.join(dir, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, await f.async('nodebuffer'))
}

console.log(`导出包已解压到: ${dir}`)
console.log('文件列表:', Object.keys(loaded.files).filter((n) => !loaded.files[n].dir).join(', '))

const py = process.platform === 'win32' ? 'python' : 'python3'
const run = (urdf) =>
  spawnSync(py, [path.join(ROOT, 'tools', 'check_urdf.py'), urdf], { encoding: 'utf8' })

console.log('\n--- check_urdf.py（正常导出）---')
const okRun = run(path.join(dir, 'robot.urdf'))
console.log(okRun.stdout || okRun.stderr)
console.log('退出码:', okRun.status)

// 负例：删掉一个 limit，应当报错
const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urdf-broken-'))
fs.mkdirSync(path.join(brokenDir, 'meshes'), { recursive: true })
for (const name of Object.keys(loaded.files)) {
  const f = loaded.files[name]
  if (f.dir) continue
  fs.writeFileSync(path.join(brokenDir, name), await f.async('nodebuffer'))
}
const urdfPath = path.join(brokenDir, 'robot.urdf')
const brokenXml = fs
  .readFileSync(urdfPath, 'utf8')
  .replace(/<limit lower="-1.4" upper="0.05" effort="1.5" velocity="3"\/>/, '')
  .replace('<mass value="0.2754"/>', '<mass value="0"/>')
fs.writeFileSync(urdfPath, brokenXml)

console.log('\n--- check_urdf.py（故意破坏：删 limit + 质量置 0）---')
const badRun = run(urdfPath)
console.log(badRun.stdout || badRun.stderr)
console.log('退出码:', badRun.status)

const good = okRun.status === 0
const bad = badRun.status === 1
console.log(`\n===== ${good && bad ? 'PASS' : 'FAIL'}: 正常包通过=${good}, 坏包被拦截=${bad} =====`)
if (!good || !bad) process.exit(1)
