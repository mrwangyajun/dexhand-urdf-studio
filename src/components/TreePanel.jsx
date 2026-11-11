import React, { useMemo } from 'react'
import { traceTree } from '../core/tree.js'
import { Badge, Empty } from './ui.jsx'

const TYPE_LABEL = {
  revolute: '转动',
  continuous: '连续',
  prismatic: '移动',
  fixed: '固定'
}

export default function TreePanel({ project, selection, onSelect, onAddJoint, onSetRoot }) {
  const { nodes, unreachable } = useMemo(() => traceTree(project), [project.links, project.joints, project.rootId])
  const linkById = useMemo(() => new Map(project.links.map((l) => [l.id, l])), [project.links])
  const jointById = useMemo(() => new Map(project.joints.map((j) => [j.id, j])), [project.joints])

  return (
    <div className="panel-tree">
      <div className="panel-head">
        <h3>
          装配树 <span className="count">{project.joints.length} 关节</span>
        </h3>
        <div className="panel-head-actions">
          <button className="mini primary" onClick={onAddJoint} disabled={project.links.length < 2}>
            + 建关节
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        {!project.links.length ? (
          <Empty>先有零件，再拼装</Empty>
        ) : (
          <>
            <div className="tree">
              {nodes.map((n) => {
                const link = linkById.get(n.linkId)
                const joint = n.jointId ? jointById.get(n.jointId) : null
                if (!link) return null
                const isSel = selection?.type === 'link' && selection.id === link.id
                const isJointSel = selection?.type === 'joint' && selection.id === n.jointId
                return (
                  <div
                    key={n.linkId}
                    className={`tree-row ${isSel ? 'active' : ''}`}
                    style={{ paddingLeft: 8 + n.depth * 14 }}
                    onClick={() => onSelect({ type: 'link', id: link.id })}
                  >
                    {joint ? (
                      <button
                        className={`tree-joint ${isJointSel ? 'active' : ''}`}
                        title={`${joint.name} (${joint.type})`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect({ type: 'joint', id: joint.id })
                        }}
                      >
                        <span className="tj-name">{joint.name}</span>
                        <span className={`tj-type t-${joint.type}`}>{TYPE_LABEL[joint.type] || joint.type}</span>
                      </button>
                    ) : (
                      <span className="tree-root-badge">root</span>
                    )}
                    <span className="tree-link" title={link.name}>
                      {link.name}
                    </span>
                    {!link.mesh ? <Badge tone="warn">无网格</Badge> : null}
                  </div>
                )
              })}
            </div>

            {unreachable.length ? (
              <div className="tree-detached">
                <div className="tree-detached-head">未连接/成环的零件（{unreachable.length}）</div>
                {unreachable.map((id) => {
                  const l = linkById.get(id)
                  if (!l) return null
                  return (
                    <div
                      key={id}
                      className={`tree-row ${selection?.id === id ? 'active' : ''}`}
                      onClick={() => onSelect({ type: 'link', id })}
                    >
                      <Badge tone="err">悬空</Badge>
                      <span className="tree-link">{l.name}</span>
                    </div>
                  )
                })}
              </div>
            ) : null}

            <div className="root-picker">
              <label>基座 (root) </label>
              <select value={project.rootId || ''} onChange={(e) => onSetRoot(e.target.value)}>
                {project.links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
