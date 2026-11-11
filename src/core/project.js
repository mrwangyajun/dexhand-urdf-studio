/**
 * 工程数据模型：默认值、序列化、本地存储
 * 所有物理量在内存里都是 SI
 */

export const PROJECT_VERSION = 1
export const STORAGE_KEY = 'dexhand-urdf-studio/project/v1'

export const LINK_COLORS = ['#7fa8d8', '#8fc7a8', '#d8b878', '#c78fa8', '#9c8fd8', '#d89a8f', '#8fc7cb', '#b5b5b5']

let seq = 0
export function uid(prefix = 'id') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const AXIS_PRESET = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 }
}

export function zeroVec() {
  return { x: 0, y: 0, z: 0 }
}

export function createLink(partial = {}) {
  return {
    id: uid('link'),
    name: partial.name || 'link_new',
    mesh: null, // {fileName, dataBase64, size, unitScale, format}
    mass: 0.02,
    com: { ...zeroVec() },
    inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
    inertiaFrame: 'com', // 'com' | 'output'
    color: LINK_COLORS[Math.floor(Math.random() * LINK_COLORS.length)],
    placeholder: false,
    massSource: null,
    note: '',
    ...partial,
    com: { ...zeroVec(), ...(partial.com || {}) },
    inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0, ...(partial.inertia || {}) }
  }
}

export function createJoint(partial = {}) {
  return {
    id: uid('joint'),
    name: partial.name || 'joint_new',
    type: 'revolute',
    parentId: null,
    childId: null,
    origin: {
      xyz: { ...zeroVec(), ...(partial.origin?.xyz || {}) },
      rpy: { ...zeroVec(), ...(partial.origin?.rpy || {}) }
    },
    axis: { ...AXIS_PRESET.z, ...(partial.axis || {}) },
    limit: { lower: -1.57, upper: 1.57, effort: 5, velocity: 3, ...(partial.limit || {}) },
    ...partial,
    origin: {
      xyz: { ...zeroVec(), ...(partial.origin?.xyz || {}) },
      rpy: { ...zeroVec(), ...(partial.origin?.rpy || {}) }
    },
    axis: { ...AXIS_PRESET.z, ...(partial.axis || {}) },
    limit: { lower: -1.57, upper: 1.57, effort: 5, velocity: 3, ...(partial.limit || {}) }
  }
}

export function emptyProject(robotName = 'dex_hand') {
  return {
    version: PROJECT_VERSION,
    robotName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rootId: null,
    links: [],
    joints: []
  }
}

export function nextLinkName(project) {
  let i = project.links.length + 1
  let name = `link_${i}`
  const names = new Set(project.links.map((l) => l.name))
  while (names.has(name)) name = `link_${++i}`
  return name
}

export function nextJointName(project) {
  let i = project.joints.length + 1
  let name = `joint_${i}`
  const names = new Set(project.joints.map((j) => j.name))
  while (names.has(name)) name = `joint_${++i}`
  return name
}

const numOr = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

function normalizeVec(v, d = 0) {
  return { x: numOr(v?.x, d), y: numOr(v?.y, d), z: numOr(v?.z, d) }
}

/** 读入工程时补齐字段，保证旧文件也能打开 */
export function normalizeProject(raw) {
  const base = emptyProject(raw?.robotName || 'dex_hand')
  const links = Array.isArray(raw?.links) ? raw.links : []
  const joints = Array.isArray(raw?.joints) ? raw.joints : []

  const normLinks = links.map((l, i) => {
    const mesh = l?.mesh && (l.mesh.dataBase64 || l.mesh.fileName)
      ? {
          fileName: l.mesh.fileName || `mesh_${i}.stl`,
          dataBase64: l.mesh.dataBase64 || '',
          size: numOr(l.mesh.size, 0),
          unitScale: ['m', 'mm', 'cm', 'in'].includes(l.mesh.unitScale) ? l.mesh.unitScale : 'm',
          format: l.mesh.format || 'stl'
        }
      : null
    return {
      id: l?.id || uid('link'),
      name: l?.name || `link_${i + 1}`,
      mesh,
      mass: numOr(l?.mass, 0),
      com: normalizeVec(l?.com),
      inertia: {
        ixx: numOr(l?.inertia?.ixx),
        ixy: numOr(l?.inertia?.ixy),
        ixz: numOr(l?.inertia?.ixz),
        iyy: numOr(l?.inertia?.iyy),
        iyz: numOr(l?.inertia?.iyz),
        izz: numOr(l?.inertia?.izz)
      },
      inertiaFrame: l?.inertiaFrame === 'output' ? 'output' : 'com',
      color: /^#[0-9a-f]{6}$/i.test(l?.color || '') ? l.color : LINK_COLORS[i % LINK_COLORS.length],
      placeholder: !!l?.placeholder,
      massSource: l?.massSource || null,
      note: l?.note || ''
    }
  })

  const linkIds = new Set(normLinks.map((l) => l.id))
  const normJoints = joints
    .filter((j) => linkIds.has(j?.parentId) && linkIds.has(j?.childId) && j?.parentId !== j?.childId)
    .map((j, i) => ({
      id: j.id || uid('joint'),
      name: j.name || `joint_${i + 1}`,
      type: ['revolute', 'prismatic', 'continuous', 'fixed'].includes(j.type) ? j.type : 'revolute',
      parentId: j.parentId,
      childId: j.childId,
      origin: { xyz: normalizeVec(j.origin?.xyz), rpy: normalizeVec(j.origin?.rpy) },
      axis: normalizeVec(j.axis),
      limit: {
        lower: numOr(j.limit?.lower, -1.57),
        upper: numOr(j.limit?.upper, 1.57),
        effort: numOr(j.limit?.effort, 5),
        velocity: numOr(j.limit?.velocity, 3)
      }
    }))

  const rootId = linkIds.has(raw?.rootId) ? raw.rootId : normLinks[0]?.id || null
  return {
    ...base,
    robotName: raw?.robotName || 'dex_hand',
    createdAt: raw?.createdAt || base.createdAt,
    updatedAt: raw?.updatedAt || base.updatedAt,
    rootId,
    links: normLinks,
    joints: normJoints
  }
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64 || '')
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function meshByteSize(project) {
  return project.links.reduce((s, l) => s + (l.mesh?.size || 0), 0)
}
