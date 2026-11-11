/**
 * 关节树拓扑工具（不依赖 three.js，可在 Node 里单测）
 */

export function jointIndex(project) {
  const byChild = new Map()
  const byParent = new Map()
  for (const j of project.joints) {
    if (j.childId) {
      if (!byChild.has(j.childId)) byChild.set(j.childId, [])
      byChild.get(j.childId).push(j)
    }
    if (j.parentId) {
      if (!byParent.has(j.parentId)) byParent.set(j.parentId, [])
      byParent.get(j.parentId).push(j)
    }
  }
  return { byChild, byParent }
}

/** 找出「没有父关节」的 link（候选 root） */
export function findRootCandidates(project) {
  const { byChild } = jointIndex(project)
  return project.links.filter((l) => !byChild.has(l.id))
}

export function resolveRootId(project) {
  const linkIds = new Set(project.links.map((l) => l.id))
  if (project.rootId && linkIds.has(project.rootId)) return project.rootId
  const cands = findRootCandidates(project)
  return cands.length ? cands[0].id : null
}

/**
 * 从 root 开始遍历，返回每个 link 在树中的位置
 * @returns {{nodes:Array<{linkId:string, jointId:string|null, parentLinkId:string|null, depth:number}>,
 *            reachable:Set<string>, unreachable:string[], cycles:string[]}}
 */
export function traceTree(project) {
  const { byChild, byParent } = jointIndex(project)
  const rootId = resolveRootId(project)
  const nodes = []
  const reachable = new Set()
  const cycles = []

  if (!rootId) return { nodes, reachable, unreachable: project.links.map((l) => l.id), cycles }

  const queue = [{ linkId: rootId, jointId: null, parentLinkId: null, depth: 0 }]
  const seenPath = new Set()
  while (queue.length) {
    const cur = queue.shift()
    if (seenPatchGuard(seenPath, cur)) {
      cycles.push(cur.linkId)
      continue
    }
    reachable.add(cur.linkId)
    nodes.push(cur)
    const children = byParent.get(cur.linkId) || []
    for (const j of children) {
      if (reachable.has(j.childId) || j.childId === cur.linkId) {
        cycles.push(j.childId)
        continue
      }
      queue.push({ linkId: j.childId, jointId: j.id, parentLinkId: cur.linkId, depth: cur.depth + 1 })
    }
  }

  const unreachable = project.links.filter((l) => !reachable.has(l.id)).map((l) => l.id)
  // 额外做一次环路检测（针对不可达子图）
  const extraCycles = detectCycles(project)
  for (const c of extraCycles) if (!cycles.includes(c)) cycles.push(c)
  return { nodes, reachable, unreachable, cycles }
}

function seenPatchGuard(seen, node) {
  // 防御：同一 link 在 BFS 中重复入队
  if (seen.has(node.linkId)) return true
  seen.add(node.linkId)
  return false
}

/** 环检测：沿 parent 指针向上走 */
export function detectCycles(project) {
  const { byChild } = jointIndex(project)
  const cycleLinks = []
  for (const link of project.links) {
    const path = []
    let cur = link.id
    let guard = 0
    while (cur && guard++ < project.links.length + 2) {
      if (path.includes(cur)) {
        if (!cycleLinks.includes(cur)) cycleLinks.push(cur)
        break
      }
      path.push(cur)
      const pj = (byChild.get(cur) || [])[0]
      cur = pj ? pj.parentId : null
    }
  }
  return cycleLinks
}

/** 把 parentId 作为父、childId 作为子，会不会成环 */
export function wouldCreateCycle(joints, parentId, childId) {
  if (!parentId || !childId) return false
  if (parentId === childId) return true
  const parentOf = new Map()
  for (const j of joints) if (j.childId && !parentOf.has(j.childId)) parentOf.set(j.childId, j.parentId)
  let cur = parentId
  let guard = 0
  while (cur && guard++ < joints.length + 2) {
    if (cur === childId) return true
    cur = parentOf.get(cur)
  }
  return false
}

/** 某 link 的所有子孙 link id（含自身） */
export function collectSubtree(project, linkId) {
  const { byParent } = jointIndex(project)
  const out = new Set()
  const walk = (id) => {
    if (!id || out.has(id)) return
    out.add(id)
    for (const j of byParent.get(id) || []) walk(j.childId)
  }
  walk(linkId)
  return out
}

/** 排序后的关节链（root -> leaf），用于 URDF 输出顺序 */
export function orderedLinksAndJoints(project) {
  const { nodes } = traceTree(project)
  return nodes
}
