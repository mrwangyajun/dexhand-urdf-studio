/**
 * 校验：阻止导出（error）或提示（warn / info）
 */
import { isPositiveDefinite, triangleInequalityOk, inertiaToCom } from './inertia.js'
import { sanitizeName } from './urdf.js'
import { detectCycles, findRootCandidates, jointIndex, resolveRootId } from './tree.js'

const LEVEL_ORDER = { error: 0, warn: 1, info: 2 }

function item(level, code, message, target = {}) {
  return { level, code, message, ...target }
}

/** 数值是否为空/零 */
const isZero = (v) => !Number.isFinite(Number(v)) || Math.abs(Number(v)) < 1e-12

export function validateProject(project) {
  const items = []
  const links = project.links || []
  const joints = project.joints || []

  if (!links.length) {
    items.push(item('error', 'no-links', '工程中还没有零件（link），请先导入网格'))
  }

  // ---- root ----
  const rootCands = findRootCandidates(project)
  const rootId = resolveRootId(project)
  if (links.length && !rootCands.length) {
    items.push(item('error', 'no-root', '找不到 root link（所有零件都有父关节，可能成环）'))
  } else if (rootCands.length > 1) {
    items.push(
      item(
        'error',
        'multi-root',
        `存在 ${rootCands.length} 个无父关节的 link（${rootCands.map((l) => l.name).join(', ')}），URDF 只允许一个 root。请把它们挂到树上`,
        { linkId: rootCands[1].id }
      )
    )
  }

  // ---- 环 / 多父 ----
  const cycles = detectCycles(project)
  if (cycles.length) {
    const names = cycles.map((id) => links.find((l) => l.id === id)?.name || id)
    items.push(item('error', 'cycle', `关节树成环：${names.join(' -> ')}`, { linkId: cycles[0] }))
  }
  const { byChild } = jointIndex(project)
  for (const [childId, js] of byChild.entries()) {
    if (js.length > 1) {
      const l = links.find((x) => x.id === childId)
      items.push(item('error', 'multi-parent', `link「${l?.name}」有 ${js.length} 个父关节，一个 link 只能有一个父关节`, { linkId: childId }))
    }
  }

  // ---- 名字 ----
  const linkNames = new Map()
  for (const l of links) {
    const key = String(l.name || '').trim().toLowerCase()
    if (!key) {
      items.push(item('error', 'empty-name', '存在空名字的 link', { linkId: l.id }))
      continue
    }
    if (linkNames.has(key)) {
      items.push(item('error', 'dup-link-name', `link 重名：「${l.name}」`, { linkId: l.id }))
    } else linkNames.set(key, l.id)
    if (sanitizeName(l.name) !== l.name) {
      items.push(item('warn', 'unsafe-link-name', `link 名「${l.name}」含空格或特殊字符，导出时会写成「${sanitizeName(l.name)}」`, { linkId: l.id }))
    }
  }
  const jointNames = new Map()
  for (const j of joints) {
    const key = String(j.name || '').trim().toLowerCase()
    if (!key) {
      items.push(item('error', 'empty-name', '存在空名字的 joint', { jointId: j.id }))
      continue
    }
    if (jointNames.has(key)) {
      items.push(item('error', 'dup-joint-name', `joint 重名：「${j.name}」`, { jointId: j.id }))
    } else jointNames.set(key, j.id)
    if (linkNames.has(key)) {
      items.push(item('error', 'name-collision', `joint 名与 link 名冲突：「${j.name}」（URDF 中两者共享命名空间）`, { jointId: j.id }))
    }
    if (sanitizeName(j.name) !== j.name) {
      items.push(item('warn', 'unsafe-joint-name', `joint 名「${j.name}」含空格或特殊字符，导出时会写成「${sanitizeName(j.name)}」`, { jointId: j.id }))
    }
  }

  // ---- 悬空 link ----
  const reachable = new Set()
  if (rootId) {
    const walk = (id) => {
      if (!id || reachable.has(id)) return
      reachable.add(id)
      for (const j of joints) if (j.parentId === id) walk(j.childId)
    }
    walk(rootId)
    for (const l of links) {
      if (!reachable.has(l.id)) {
        items.push(item('error', 'floating-link', `link「${l.name}」没有连到 root（悬空），不会被加载`, { linkId: l.id }))
      }
    }
  }

  // ---- 每个 link 的物理参数 ----
  for (const l of links) {
    const mass = Number(l.mass)
    if (l.placeholder) {
      items.push(item('warn', 'placeholder', `link「${l.name}」的质量/惯量是占位值（未从 CAD 取得），导出前请替换`, { linkId: l.id }))
    }
    if (!Number.isFinite(mass) || mass <= 0) {
      items.push(item('error', 'mass-missing', `link「${l.name}」缺少质量（或 ≤ 0）`, { linkId: l.id }))
    } else {
      if (mass > 200) items.push(item('warn', 'mass-suspect', `link「${l.name}」质量 ${mass} kg 偏大，单位是否填错（g→kg）？`, { linkId: l.id }))
      if (mass < 1e-4) items.push(item('warn', 'mass-suspect', `link「${l.name}」质量 ${mass} kg 偏小，单位是否填错？`, { linkId: l.id }))
    }

    const comMag = Math.hypot(Number(l.com?.x) || 0, Number(l.com?.y) || 0, Number(l.com?.z) || 0)
    if (comMag > 1.5) {
      items.push(item('warn', 'com-suspect', `link「${l.name}」质心距原点 ${comMag.toFixed(3)} m 偏大，单位是否 mm 未换算？`, { linkId: l.id }))
    }

    const inr = l.inertia || {}
    const allZero = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'].every((k) => isZero(inr[k]))
    if (allZero) {
      items.push(item('error', 'inertia-missing', `link「${l.name}」惯量全为 0`, { linkId: l.id }))
    } else {
      const atCom = inertiaToCom(inr, l.inertiaFrame, mass, l.com)
      if (!isPositiveDefinite(atCom)) {
        items.push(item('error', 'inertia-invalid', `link「${l.name}」惯量矩阵不是正定（对角需 > 0 且满足行列式条件）`, { linkId: l.id }))
      } else {
        if (!triangleInequalityOk(atCom)) {
          items.push(item('warn', 'inertia-triangle', `link「${l.name}」惯量不满足三角不等式，可能单位或参考系填错`, { linkId: l.id }))
        }
        const maxDiag = Math.max(atCom.ixx, atCom.iyy, atCom.izz)
        if (maxDiag > 20) {
          items.push(item('warn', 'inertia-suspect', `link「${l.name}」惯量最大对角 ${maxDiag.toPrecision(3)} kg·m² 偏大，是否 g·mm² 未换算？`, { linkId: l.id }))
        }
      }
    }

    if (!l.mesh?.dataBase64) {
      items.push(item('warn', 'mesh-missing', `link「${l.name}」没有网格，导出的 URDF 只有惯量没有可视几何`, { linkId: l.id }))
    }
    if ((l.mesh?.unitScale || 'm') === 'mm') {
      items.push(item('info', 'mesh-scale-mm', `link「${l.name}」网格按 mm→m 缩放导出（scale="0.001 0.001 0.001"）`, { linkId: l.id }))
    }
  }

  // ---- 每个 joint ----
  for (const j of joints) {
    const parent = links.find((l) => l.id === j.parentId)
    const child = links.find((l) => l.id === j.childId)
    if (!parent || !child) {
      items.push(item('error', 'joint-endpoint', `joint「${j.name}」的 parent/child 缺失`, { jointId: j.id }))
      continue
    }
    if (j.parentId === j.childId) {
      items.push(item('error', 'joint-self', `joint「${j.name}」的 parent 与 child 相同`, { jointId: j.id }))
    }
    const type = j.type || 'fixed'
    if (!['revolute', 'prismatic', 'continuous', 'fixed'].includes(type)) {
      items.push(item('error', 'joint-type', `joint「${j.name}」类型「${type}」不受支持`, { jointId: j.id }))
    }
    const axisZero = isZero(j.axis?.x) && isZero(j.axis?.y) && isZero(j.axis?.z)
    if (type !== 'fixed' && axisZero) {
      items.push(item('error', 'axis-missing', `joint「${j.name}」(${type}) 没有有效的 axis`, { jointId: j.id }))
    }
    if (type === 'fixed' && !axisZero) {
      items.push(item('info', 'axis-ignored', `joint「${j.name}」是 fixed，axis 会被忽略`, { jointId: j.id }))
    }
    if (type === 'revolute' || type === 'prismatic') {
      const lo = Number(j.limit?.lower)
      const hi = Number(j.limit?.upper)
      const eff = Number(j.limit?.effort)
      const vel = Number(j.limit?.velocity)
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        items.push(item('error', 'limit-missing', `joint「${j.name}」缺少 limit（lower/upper）`, { jointId: j.id }))
      } else if (lo >= hi) {
        items.push(item('error', 'limit-order', `joint「${j.name}」limit lower(${lo}) 必须小于 upper(${hi})`, { jointId: j.id }))
      }
      if (!Number.isFinite(eff) || eff <= 0) {
        items.push(item('error', 'effort-missing', `joint「${j.name}」缺少 effort（> 0）`, { jointId: j.id }))
      }
      if (!Number.isFinite(vel) || vel <= 0) {
        items.push(item('error', 'velocity-missing', `joint「${j.name}」缺少 velocity（> 0）`, { jointId: j.id }))
      }
      if (type === 'prismatic' && Math.max(Math.abs(lo), Math.abs(hi)) > 2) {
        items.push(item('warn', 'prismatic-range', `joint「${j.name}」prismatic 行程 ${lo}..${hi} m 偏大，单位是否 mm？`, { jointId: j.id }))
      }
    }
    if (type === 'continuous') {
      const eff = Number(j.limit?.effort)
      const vel = Number(j.limit?.velocity)
      if (!Number.isFinite(eff) || eff <= 0) {
        items.push(item('error', 'effort-missing', `joint「${j.name}」continuous 也需要 effort（> 0）`, { jointId: j.id }))
      }
      if (!Number.isFinite(vel) || vel <= 0) {
        items.push(item('error', 'velocity-missing', `joint「${j.name}」continuous 也需要 velocity（> 0）`, { jointId: j.id }))
      }
    }
  }

  items.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  const errorCount = items.filter((i) => i.level === 'error').length
  const warnCount = items.filter((i) => i.level === 'warn').length
  return { items, errorCount, warnCount, canExport: errorCount === 0, rootId }
}
