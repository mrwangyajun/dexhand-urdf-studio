import React, { useState } from 'react'
import { collectSubtree, wouldCreateCycle } from '../core/tree.js'
import { fmtShort, rad2deg, deg2rad } from '../core/units.js'
import { Badge, NumField, Row, Section, TextField, Vec3Field } from './ui.jsx'

const LENGTH_OPTS = [
  { key: 'mm', factor: 1e-3, label: 'mm' },
  { key: 'm', factor: 1, label: 'm' }
]

export default function JointPanel({ project, joint, onUpdate, onRemove, jointValues, setJointValue, onSelect }) {
  const [lengthUnit, setLengthUnit] = useState('mm')
  const [angleUnit, setAngleUnit] = useState('deg')
  const lu = LENGTH_OPTS.find((u) => u.key === lengthUnit) || LENGTH_OPTS[0]
  const aFactor = angleUnit === 'deg' ? Math.PI / 180 : 1
  const aLabel = angleUnit === 'deg' ? '°' : 'rad'

  const parent = project.links.find((l) => l.id === joint.parentId)
  const child = project.links.find((l) => l.id === joint.childId)
  const q = jointValues[joint.id] ?? 0
  const movable = joint.type !== 'fixed'

  const childSubtree = collectSubtree(project, joint.childId)
  const parentOptions = project.links.filter((l) => !childSubtree.has(l.id))
  const childOptions = project.links.filter((l) => l.id !== joint.parentId && !collectSubtree(project, l.id).has(joint.parentId))

  const setOrigin = (patch) => onUpdate({ origin: { ...joint.origin, ...patch } })
  const setXYZ = (v) =>
    setOrigin({ xyz: { x: v.x * lu.factor, y: v.y * lu.factor, z: v.z * lu.factor } })
  const setRPY = (v) => setOrigin({ rpy: { x: v.x * aFactor, y: v.y * aFactor, z: v.z * aFactor } })

  const changeParent = (id) => {
    if (wouldCreateCycle(project.joints, id, joint.childId)) return
    onUpdate({ parentId: id })
  }
  const changeChild = (id) => {
    if (wouldCreateCycle(project.joints, joint.parentId, id)) return
    onUpdate({ childId: id })
  }

  return (
    <div className="props">
      <div className="props-head">
        <div>
          <div className="props-kind">JOINT</div>
          <h3>{joint.name}</h3>
        </div>
        <div className="props-head-actions">
          <Badge tone={joint.type === 'fixed' ? 'gray' : 'blue'}>{joint.type}</Badge>
          <button className="mini danger" onClick={() => onRemove(joint.id)}>
            删除
          </button>
        </div>
      </div>

      <div className="props-scroll">
        <Section title="基本信息">
          <Row label="joint 名称">
            <TextField value={joint.name} onChange={(v) => onUpdate({ name: v })} />
          </Row>
          <Row label="类型 type">
            <select value={joint.type} onChange={(e) => onUpdate({ type: e.target.value })}>
              <option value="revolute">revolute（有限位转动）</option>
              <option value="continuous">continuous（无限位转动）</option>
              <option value="prismatic">prismatic（移动）</option>
              <option value="fixed">fixed（固定连接）</option>
            </select>
          </Row>
          <Row label="parent link">
            <select value={joint.parentId} onChange={(e) => changeParent(e.target.value)}>
              {parentOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="child link">
            <select value={joint.childId} onChange={(e) => changeChild(e.target.value)}>
              {childOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Row>
          <div className="muted small">
            {parent?.name || '?'} → {child?.name || '?'}（改 parent/child 会阻止成环）
          </div>
        </Section>

        <Section
          title="关节原点 origin"
          right={
            <button
              className="mini"
              onClick={() => setOrigin({ xyz: { x: 0, y: 0, z: 0 }, rpy: { x: 0, y: 0, z: 0 } })}
              title="让 child 的坐标系与 parent 的关节坐标系完全重合"
            >
              重合到父级
            </button>
          }
        >
          <div className="unit-bar slim">
            <label>
              长度
              <select value={lengthUnit} onChange={(e) => setLengthUnit(e.target.value)}>
                {LENGTH_OPTS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              角度
              <select value={angleUnit} onChange={(e) => setAngleUnit(e.target.value)}>
                <option value="deg">deg</option>
                <option value="rad">rad</option>
              </select>
            </label>
          </div>
          <Row label="平移 xyz">
            <Vec3Field
              value={{
                x: (joint.origin?.xyz?.x || 0) / lu.factor,
                y: (joint.origin?.xyz?.y || 0) / lu.factor,
                z: (joint.origin?.xyz?.z || 0) / lu.factor
              }}
              onChange={setXYZ}
              unit={lu.label}
            />
          </Row>
          <Row label="旋转 rpy">
            <Vec3Field
              value={{
                x: (joint.origin?.rpy?.x || 0) / aFactor,
                y: (joint.origin?.rpy?.y || 0) / aFactor,
                z: (joint.origin?.rpy?.z || 0) / aFactor
              }}
              onChange={setRPY}
              unit={aLabel}
            />
          </Row>
          <div className="muted small">
            URDF 里 rpy 是固定轴 X-Y-Z（外旋）。当前保存为 {fmtShort(joint.origin?.rpy?.x || 0)} /{' '}
            {fmtShort(joint.origin?.rpy?.y || 0)} / {fmtShort(joint.origin?.rpy?.z || 0)} rad。
          </div>
        </Section>

        <Section
          title="转轴 axis"
          right={movable ? null : <Badge tone="gray">fixed 忽略</Badge>}
        >
          <Row label="轴向量" hint="在 child 坐标系下表示，URDF 会自动归一化">
            <Vec3Field value={joint.axis} onChange={(v) => onUpdate({ axis: v })} disabled={!movable} />
          </Row>
          <div className="btn-row">
            {[
              ['X', { x: 1, y: 0, z: 0 }],
              ['Y', { x: 0, y: 1, z: 0 }],
              ['Z', { x: 0, y: 0, z: 1 }],
              ['-X', { x: -1, y: 0, z: 0 }],
              ['-Y', { x: 0, y: -1, z: 0 }],
              ['-Z', { x: 0, y: 0, z: -1 }]
            ].map(([label, v]) => (
              <button key={label} className="mini" disabled={!movable} onClick={() => onUpdate({ axis: v })}>
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="限位 limit">
          {joint.type === 'fixed' ? (
            <div className="muted small">fixed 关节不需要 limit / axis</div>
          ) : (
            <>
              <Row label="lower" hint="rad 或 m，输出始终为 SI">
                <NumField
                  value={joint.type === 'prismatic' ? joint.limit.lower / lu.factor : joint.limit.lower / aFactor}
                  onChange={(v) =>
                    onUpdate({
                      limit: { ...joint.limit, lower: joint.type === 'prismatic' ? v * lu.factor : v * aFactor }
                    })
                  }
                  unit={joint.type === 'prismatic' ? lu.label : aLabel}
                  step="any"
                  disabled={joint.type === 'continuous'}
                />
              </Row>
              <Row label="upper">
                <NumField
                  value={joint.type === 'prismatic' ? joint.limit.upper / lu.factor : joint.limit.upper / aFactor}
                  onChange={(v) =>
                    onUpdate({
                      limit: { ...joint.limit, upper: joint.type === 'prismatic' ? v * lu.factor : v * aFactor }
                    })
                  }
                  unit={joint.type === 'prismatic' ? lu.label : aLabel}
                  step="any"
                  disabled={joint.type === 'continuous'}
                />
              </Row>
              <Row label="effort" hint="最大力矩 N·m 或最大推力 N，必须 > 0">
                <NumField
                  value={joint.limit.effort}
                  onChange={(v) => onUpdate({ limit: { ...joint.limit, effort: v } })}
                  unit="N·m / N"
                  step="any"
                />
              </Row>
              <Row label="velocity" hint="最大速度 rad/s 或 m/s，必须 > 0">
                <NumField
                  value={joint.limit.velocity}
                  onChange={(v) => onUpdate({ limit: { ...joint.limit, velocity: v } })}
                  unit="rad/s"
                  step="any"
                />
              </Row>
              {joint.type === 'continuous' ? (
                <div className="muted small">continuous 只输出 effort / velocity，不输出 lower/upper。</div>
              ) : null}
            </>
          )}
        </Section>

        {movable ? (
          <Section title="关节拖动预览">
            <div className="slider-row">
              <input
                type="range"
                min={joint.type === 'continuous' ? -Math.PI : Math.min(joint.limit.lower, joint.limit.upper)}
                max={joint.type === 'continuous' ? Math.PI : Math.max(joint.limit.lower, joint.limit.upper)}
                step={(Math.max(joint.limit.upper - joint.limit.lower, 1e-3) / 200) || 0.001}
                value={q}
                onChange={(e) => setJointValue(joint.id, parseFloat(e.target.value))}
              />
              <NumField
                value={joint.type === 'prismatic' ? q / lu.factor : q / aFactor}
                onChange={(v) => setJointValue(joint.id, joint.type === 'prismatic' ? v * lu.factor : v * aFactor)}
                unit={joint.type === 'prismatic' ? lu.label : aLabel}
                step="any"
              />
              <button className="mini" onClick={() => setJointValue(joint.id, 0)}>
                归零
              </button>
            </div>
            <div className="muted small">
              仅用于姿态预览，不写入 URDF（URDF 描述的是零位几何）。
            </div>
          </Section>
        ) : null}

        <div className="btn-row">
          {parent ? (
            <button className="mini" onClick={() => onSelect?.({ type: 'link', id: parent.id })}>
              选中 parent: {parent.name}
            </button>
          ) : null}
          {child ? (
            <button className="mini" onClick={() => onSelect?.({ type: 'link', id: child.id })}>
              选中 child: {child.name}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
