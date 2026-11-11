/**
 * URDF 生成（SI 单位，米/千克/弧度）
 */
import { fmt } from './units.js'
import { inertiaToCom } from './inertia.js'
import { resolveRootId, traceTree } from './tree.js'

export const APP_NAME = 'DexHand URDF Studio'
export const APP_VERSION = '0.1.0'

export function sanitizeName(name, fallback = 'unnamed') {
  let s = String(name || '').trim().replace(/[\s\-./]+/g, '_')
  s = s.replace(/[^A-Za-z0-9_]/g, '')
  if (!s) s = fallback
  if (!/^[A-Za-z_]/.test(s)) s = `l_${s}`
  return s
}

/** 生成不重名的名字表 */
export function uniqueNames(items, fallbackPrefix) {
  const used = new Set()
  const map = new Map()
  let i = 1
  for (const it of items) {
    let base = sanitizeName(it.name, `${fallbackPrefix}${i}`)
    let name = base
    let k = 2
    while (used.has(name)) name = `${base}_${k++}`
    used.add(name)
    map.set(it.id, name)
    i++
  }
  return map
}

const vec = (v) => `${fmt(v?.x ?? 0)} ${fmt(v?.y ?? 0)} ${fmt(v?.z ?? 0)}`

function meshExt(link) {
  const fn = link?.mesh?.fileName || ''
  const m = fn.match(/\.([a-zA-Z0-9]+)$/)
  return m ? `.${m[1].toLowerCase()}` : '.stl'
}

function scaleOf(link) {
  const s = link?.mesh?.unitScale || 'm'
  if (s === 'mm') return 0.001
  if (s === 'cm') return 0.01
  if (s === 'in') return 0.0254
  return 1
}

function colorOf(link) {
  const c = link?.color || '#8ea2b8'
  const m = c.match(/^#?([0-9a-f]{6})$/i)
  if (!m) return { r: 0.56, g: 0.64, b: 0.72 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/** 导出的 mesh 文件名：用 link 名 + 原扩展名，保证唯一且可追溯 */
export function exportMeshName(link, linkName) {
  return `${linkName}${meshExt(link)}`
}

function indent(s, n = 2) {
  const pad = ' '.repeat(n)
  return s
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

/**
 * 生成 URDF 文本
 * @param {object} project
 * @param {object} options { includeCollision, includeMaterials, meshDir, timestamp }
 */
export function buildUrdf(project, options = {}) {
  const opts = {
    includeCollision: true,
    includeMaterials: true,
    meshDir: 'meshes',
    timestamp: new Date().toISOString(),
    ...options
  }
  const linkNameById = uniqueNames(project.links, 'link')
  const jointNameById = uniqueNames(project.joints, 'joint')
  const robotName = sanitizeName(opts.robotName || project.robotName || 'robot', 'robot')
  const linkById = new Map(project.links.map((l) => [l.id, l]))
  const { nodes } = traceTree(project)
  const rootId = resolveRootId(project)

  // 输出顺序：树序（root 先），再接不可达 link
  const orderedLinkIds = nodes.map((n) => n.linkId)
  for (const l of project.links) if (!orderedLinkIds.includes(l.id)) orderedLinkIds.push(l.id)
  const orderedJointIds = nodes.filter((n) => n.jointId).map((n) => n.jointId)
  for (const j of project.joints) if (!orderedJointIds.includes(j.id)) orderedJointIds.push(j.id)

  const lines = []
  lines.push('<?xml version="1.0"?>')
  lines.push(`<!-- ${APP_NAME} v${APP_VERSION} | generated ${opts.timestamp} -->`)
  lines.push(`<!-- 单位: 长度 m, 质量 kg, 角度 rad, 惯量 kg*m^2 (相对质心) -->`)
  lines.push(`<robot name="${robotName}">`)

  for (const linkId of orderedLinkIds) {
    const link = linkById.get(linkId)
    if (!link) continue
    const name = linkNameById.get(link.id)
    const body = []
    const mass = Number(link.mass) || 0
    const inertia = inertiaToCom(link.inertia, link.inertiaFrame, mass, link.com)
    body.push('<inertial>')
    body.push(`  <origin xyz="${vec(link.com)}" rpy="0 0 0"/>`)
    body.push(`  <mass value="${fmt(mass)}"/>`)
    body.push(
      `  <inertia ixx="${fmt(inertia?.ixx)}" ixy="${fmt(inertia?.ixy)}" ixz="${fmt(inertia?.ixz)}" ` +
        `iyy="${fmt(inertia?.iyy)}" iyz="${fmt(inertia?.iyz)}" izz="${fmt(inertia?.izz)}"/>`
    )
    body.push('</inertial>')

    if (link.mesh?.dataBase64 || link.mesh?.fileName) {
      const scale = scaleOf(link)
      const scaleAttr = scale !== 1 ? ` scale="${fmt(scale)} ${fmt(scale)} ${fmt(scale)}"` : ''
      const geom = [
        '<geometry>',
        `  <mesh filename="${opts.meshDir}/${exportMeshName(link, name)}"${scaleAttr}/>`,
        '</geometry>'
      ].join('\n')
      const materialBlock = opts.includeMaterials
        ? (() => {
            const c = colorOf(link)
            return `<material name="mat_${name}">\n  <color rgba="${fmt(c.r, 4)} ${fmt(c.g, 4)} ${fmt(c.b, 4)} 1"/>\n</material>`
          })()
        : null
      body.push(['<visual>', '  <origin xyz="0 0 0" rpy="0 0 0"/>', indent(geom, 2), materialBlock ? indent(materialBlock, 2) : null, '</visual>']
        .filter(Boolean)
        .join('\n'))
      if (opts.includeCollision) {
        body.push(['<collision>', '  <origin xyz="0 0 0" rpy="0 0 0"/>', indent(geom, 2), '</collision>'].join('\n'))
      }
    }
    lines.push(indent(`<link name="${name}">\n${indent(body.join('\n'), 2)}\n</link>`, 2))

    if (link.id === rootId) lines.push(`  <!-- root link: ${name} -->`)
  }

  for (const jointId of orderedJointIds) {
    const j = project.joints.find((x) => x.id === jointId)
    if (!j) continue
    const p = linkById.get(j.parentId)
    const c = linkById.get(j.childId)
    if (!p || !c) continue
    const jn = jointNameById.get(j.id)
    const type = j.type || 'fixed'
    const body = []
    body.push(`<parent link="${linkNameById.get(p.id)}"/>`)
    body.push(`<child link="${linkNameById.get(c.id)}"/>`)
    body.push(`<origin xyz="${vec(j.origin?.xyz)}" rpy="${vec(j.origin?.rpy)}"/>`)
    if (type !== 'fixed') {
      body.push(`<axis xyz="${vec(j.axis)}"/>`)
    }
    if (type === 'revolute' || type === 'prismatic') {
      body.push(
        `<limit lower="${fmt(j.limit?.lower)}" upper="${fmt(j.limit?.upper)}" ` +
          `effort="${fmt(j.limit?.effort)}" velocity="${fmt(j.limit?.velocity)}"/>`
      )
    } else if (type === 'continuous') {
      body.push(`<limit effort="${fmt(j.limit?.effort)}" velocity="${fmt(j.limit?.velocity)}"/>`)
    }
    lines.push(indent(`<joint name="${jn}" type="${type}">\n${indent(body.join('\n'), 2)}\n</joint>`, 2))
  }

  lines.push('</robot>')
  return lines.join('\n') + '\n'
}

/** 导出用的参数表（可追溯：原始单位、换算、来源） */
export function buildParamsJson(project, options = {}) {
  const linkNameById = uniqueNames(project.links, 'link')
  const jointNameById = uniqueNames(project.joints, 'joint')
  const rootId = resolveRootId(project)
  return {
    schema: 'dexhand-urdf-studio/params@1',
    generatedBy: `${APP_NAME} v${APP_VERSION}`,
    generatedAt: options.timestamp || new Date().toISOString(),
    robotName: sanitizeName(options.robotName || project.robotName || 'robot', 'robot'),
    rootLink: linkNameById.get(rootId) || null,
    units: { length: 'm', mass: 'kg', angle: 'rad', inertia: 'kg*m^2' },
    links: project.links.map((l) => ({
      name: linkNameById.get(l.id),
      mesh: l.mesh?.fileName ? `${options.meshDir || 'meshes'}/${exportMeshName(l, linkNameById.get(l.id))}` : null,
      meshUnitScale: l.mesh?.unitScale || 'm',
      mass: Number(l.mass) || 0,
      com: { x: Number(l.com?.x) || 0, y: Number(l.com?.y) || 0, z: Number(l.com?.z) || 0 },
      inertiaFrame: l.inertiaFrame || 'com',
      inertia: {
        ixx: Number(l.inertia?.ixx) || 0,
        ixy: Number(l.inertia?.ixy) || 0,
        ixz: Number(l.inertia?.ixz) || 0,
        iyy: Number(l.inertia?.iyy) || 0,
        iyz: Number(l.inertia?.iyz) || 0,
        izz: Number(l.inertia?.izz) || 0
      },
      placeholder: !!l.placeholder,
      source: l.massSource
        ? {
            file: l.massSource.fileName || '',
            rawUnits: l.massSource.rawUnits || {},
            note: l.massSource.note || '',
            parsedAt: l.massSource.parsedAt || ''
          }
        : null
    })),
    joints: project.joints.map((j) => ({
      name: jointNameById.get(j.id),
      type: j.type,
      parent: linkNameById.get(j.parentId) || null,
      child: linkNameById.get(j.childId) || null,
      origin: {
        xyz: { x: +j.origin?.xyz?.x || 0, y: +j.origin?.xyz?.y || 0, z: +j.origin?.xyz?.z || 0 },
        rpy: { x: +j.origin?.rpy?.x || 0, y: +j.origin?.rpy?.y || 0, z: +j.origin?.rpy?.z || 0 }
      },
      axis: { x: +j.axis?.x || 0, y: +j.axis?.y || 0, z: +j.axis?.z || 0 },
      limit: {
        lower: +j.limit?.lower || 0,
        upper: +j.limit?.upper || 0,
        effort: +j.limit?.effort || 0,
        velocity: +j.limit?.velocity || 0
      }
    }))
  }
}
