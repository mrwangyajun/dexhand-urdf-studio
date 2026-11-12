/**
 * 把示例库里的每个工程导出成 examples/*.zip（随仓库分发的成品包）
 * 用法： node scripts/make-examples.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExportZip } from '../src/core/exportZip.js'
import { normalizeProject } from '../src/core/project.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUB = path.join(ROOT, 'public', 'samples')

const index = JSON.parse(fs.readFileSync(path.join(PUB, 'index.json'), 'utf8'))
fs.mkdirSync(path.join(ROOT, 'examples'), { recursive: true })
for (const f of fs.readdirSync(path.join(ROOT, 'examples'))) {
  if (f.endsWith('.zip')) fs.unlinkSync(path.join(ROOT, 'examples', f))
}

for (const s of index.samples) {
  const raw = JSON.parse(fs.readFileSync(path.join(PUB, s.file), 'utf8'))
  for (const l of raw.links) {
    const stl = fs.readFileSync(path.join(PUB, 'meshes', l.mesh.fileName))
    l.mesh.dataBase64 = stl.toString('base64')
    l.mesh.size = stl.byteLength
  }
  const project = normalizeProject(raw)
  const { zip } = await buildExportZip(project, { robotName: project.robotName })
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  const name = `${project.robotName}_urdf.zip`
  fs.writeFileSync(path.join(ROOT, 'examples', name), buf)
  console.log(`examples/${name}  ${(buf.length / 1024).toFixed(0)} KB  (${s.links} links / ${s.joints} joints)`)
}
