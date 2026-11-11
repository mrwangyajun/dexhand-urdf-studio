import React, { useMemo, useState } from 'react'
import { collectSubtree, wouldCreateCycle } from '../core/tree.js'
import { createJoint, nextJointName } from '../core/project.js'
import { Modal, NumField, Row, TextField, Vec3Field } from './ui.jsx'

export default function JointDialog({ project, defaultParentId, defaultChildId, onClose, onCreate }) {
  const links = project.links
  const [parentId, setParentId] = useState(defaultParentId || links[0]?.id || '')
  const [childId, setChildId] = useState(
    defaultChildId || links.find((l) => l.id !== (defaultParentId || links[0]?.id))?.id || ''
  )
  const [name, setName] = useState('')
  const [type, setType] = useState('revolute')
  const [xyz, setXYZ] = useState({ x: 0, y: 0, z: 0 })
  const [rpy, setRPY] = useState({ x: 0, y: 0, z: 0 })
  const [axis, setAxis] = useState({ x: 0, y: 0, z: 1 })
  const [limit, setLimit] = useState({ lower: -1.5708, upper: 1.5708, effort: 5, velocity: 3 })

  const parent = links.find((l) => l.id === parentId)
  const child = links.find((l) => l.id === childId)
  const autoName = parent && child ? `${parent.name}_${child.name}`.replace(/[^A-Za-z0-9_]/g, '_') : nextJointName(project)

  const parentOptions = useMemo(() => {
    const banned = collectSubtree(project, childId)
    return links.filter((l) => !banned.has(l.id))
  }, [project, childId])

  const childOptions = useMemo(() => {
    return links.filter((l) => l.id !== parentId)
  }, [links, parentId])

  const problem = useMemo(() => {
    if (!parentId || !childId) return '请选择 parent 与 child'
    if (parentId === childId) return 'parent 与 child 不能相同'
    if (wouldCreateCycle(project.joints, parentId, childId)) return '这样连接会成环，已阻止'
    if (project.joints.some((j) => j.childId === childId)) return `link「${child?.name}」已经有父关节了`
    return null
  }, [parentId, childId, project.joints, child])

  const submit = () => {
    if (problem) return
    const joint = createJoint({
      name: name.trim() || autoName,
      type,
      parentId,
      childId,
      origin: {
        xyz: { x: xyz.x * 0.001, y: xyz.y * 0.001, z: xyz.z * 0.001 },
        rpy: { x: (rpy.x * Math.PI) / 180, y: (rpy.y * Math.PI) / 180, z: (rpy.z * Math.PI) / 180 }
      },
      axis,
      limit
    })
    onCreate(joint)
  }

  return (
    <Modal
      title="新建关节"
      subtitle="把 child link 挂到 parent 上：origin 表示 child 坐标系在 parent 坐标系中的位姿（单位 mm / 度）"
      width={760}
      onClose={onClose}
      footer={
        <>
          <div className="modal-hint">
            {problem ? <span className="text-err">{problem}</span> : <span className="muted">将生成 joint「{name.trim() || autoName}」</span>}
          </div>
          <div className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!!problem} onClick={submit}>
            创建关节
          </button>
        </>
      }
    >
      <div className="grid2">
        <Row label="joint 名称">
          <TextField value={name} placeholder={autoName} onChange={setName} />
        </Row>
        <Row label="类型">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="revolute">revolute</option>
            <option value="continuous">continuous</option>
            <option value="prismatic">prismatic</option>
            <option value="fixed">fixed</option>
          </select>
        </Row>
        <Row label="parent link">
          <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            {parentOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="child link">
          <select value={childId} onChange={(e) => setChildId(e.target.value)}>
            {childOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Row>
      </div>

      <div className="grid2">
        <Row label="origin 平移 (mm)">
          <Vec3Field value={xyz} onChange={setXYZ} unit="mm" />
        </Row>
        <Row label="origin 旋转 (deg)">
          <Vec3Field value={rpy} onChange={setRPY} unit="°" />
        </Row>
      </div>

      <div className="tip-row">
        <button
          className="mini"
          onClick={() => {
            setXYZ({ x: 0, y: 0, z: 0 })
            setRPY({ x: 0, y: 0, z: 0 })
          }}
          title="子坐标系与父关节坐标系重合（origin 全 0）"
        >
          子坐标系与父关节坐标系重合
        </button>
        <span className="muted small">多数 CAD 导出的零件已在关节处建好坐标系，直接填 0 即可</span>
      </div>

      {type !== 'fixed' ? (
        <>
          <Row label="axis（child 坐标系）" wide>
            <Vec3Field value={axis} onChange={setAxis} />
            <div className="btn-row">
              {[
                ['X', { x: 1, y: 0, z: 0 }],
                ['Y', { x: 0, y: 1, z: 0 }],
                ['Z', { x: 0, y: 0, z: 1 }]
              ].map(([l, v]) => (
                <button key={l} className="mini" onClick={() => setAxis(v)}>
                  +{l}
                </button>
              ))}
              <span className="muted small">方向在 child 坐标系下表示，URDF 会自动归一化</span>
            </div>
          </Row>
          <div className="grid2">
            <Row label="limit lower">
              <NumField
                value={limit.lower}
                onChange={(v) => setLimit({ ...limit, lower: v })}
                unit={type === 'prismatic' ? 'm' : 'rad'}
              />
            </Row>
            <Row label="limit upper">
              <NumField
                value={limit.upper}
                onChange={(v) => setLimit({ ...limit, upper: v })}
                unit={type === 'prismatic' ? 'm' : 'rad'}
              />
            </Row>
            <Row label="effort">
              <NumField value={limit.effort} onChange={(v) => setLimit({ ...limit, effort: v })} unit="N·m" />
            </Row>
            <Row label="velocity">
              <NumField value={limit.velocity} onChange={(v) => setLimit({ ...limit, velocity: v })} unit="rad/s" />
            </Row>
          </div>
        </>
      ) : null}
    </Modal>
  )
}
