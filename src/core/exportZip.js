/**
 * 导出 zip：robot.urdf + meshes/ + params.json + check_urdf.py + README.md
 */
import JSZip from 'jszip'
import { buildUrdf, buildParamsJson, exportMeshName, sanitizeName, uniqueNames } from './urdf.js'
import { buildReadme, CHECK_URDF_PY } from './artifacts.js'

export function exportBaseName(project, opts = {}) {
  return sanitizeName(opts.robotName || project.robotName || 'robot', 'robot')
}

export async function buildExportZip(project, options = {}) {
  const robotName = exportBaseName(project, options)
  const timestamp = new Date().toISOString()
  const xml = buildUrdf(project, { ...options, robotName, timestamp })
  const zip = new JSZip()
  zip.file('robot.urdf', xml)

  const folder = zip.folder('meshes')
  const names = uniqueNames(project.links, 'link')
  const missing = []
  for (const l of project.links) {
    if (l.mesh?.dataBase64) {
      folder.file(exportMeshName(l, names.get(l.id)), l.mesh.dataBase64, { base64: true })
    } else {
      missing.push(l.name)
    }
  }

  zip.file('params.json', JSON.stringify(buildParamsJson(project, { robotName, timestamp }), null, 2))
  zip.file('check_urdf.py', CHECK_URDF_PY)
  zip.file('README.md', buildReadme(project, { robotName, timestamp }))
  return { zip, xml, robotName, missing, fileCount: 5 + project.links.length }
}

export async function downloadExportZip(project, options = {}) {
  const { zip, robotName } = await buildExportZip(project, options)
  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${robotName}_urdf.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return `${robotName}_urdf.zip`
}
