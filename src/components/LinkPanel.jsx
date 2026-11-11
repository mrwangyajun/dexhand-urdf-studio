import React, { useRef, useState } from 'react'
import { INERTIA_PRESETS, fmtBytes, fmtShort } from '../core/units.js'
import { inertiaToCom } from '../core/inertia.js'
import { Badge, NumField, Row, Section, TextField, Vec3Field } from './ui.jsx'

const MASS_OPTS = [
  { key: 'kg', factor: 1, label: 'kg' },
  { key: 'g', factor: 1e-3, label: 'g' }
]
const LENGTH_OPTS = [
  { key: 'm', factor: 1, label: 'm' },
  { key: 'mm', factor: 1e-3, label: 'mm' }
]

export default function LinkPanel({ project, link, onUpdate, onRemove, onOpenMassImport, onReplaceMesh, onSetRoot, onSelect }) {
  const [massUnit, setMassUnit] = useState('kg')
  const [lengthUnit, setLengthUnit] = useState('m')
  const [inertiaUnit, setInertiaUnit] = useState('kgm2')
  const fileRef = useRef(null)
  const [showRaw, setShowRaw] = useState(false)

  const mu = MASS_OPTS.find((u) => u.key === massUnit) || MASS_OPTS[0]
  const lu = LENGTH_OPTS.find((u) => u.key === lengthUnit) || LENGTH_OPTS[0]
  const iu = INERTIA_PRESETS.find((u) => u.key === inertiaUnit) || INERTIA_PRESETS[0]

  const toIU = (si) => (Number(si) || 0) / iu.factor
  const fromIU = (v) => (Number(v) || 0) * iu.factor
  const setInertia = (k, v) => onUpdate({ inertia: { ...link.inertia, [k]: fromIU(v) } })

  const parentJoint = project.joints.find((j) => j.childId === link.id)
  const atCom = inertiaToCom(link.inertia, link.inertiaFrame, link.mass, link.com)
  const isRoot = project.rootId === link.id

  return (
    <div className="props">
      <div className="props-head">
        <div>
          <div className="props-kind">LINK</div>
          <h3>{link.name}</h3>
        </div>
        <div className="props-head-actions">
          {!isRoot ? (
            <button className="mini" onClick={() => onSetRoot(link.id)} title="设为基座 root link">
              设为 root
            </button>
          ) : (
            <Badge tone="blue">ROOT</Badge>
          )}
          <button className="mini danger" onClick={() => onRemove(link.id)}>
            删除
          </button>
        </div>
      </div>

      <div className="props-scroll">
        <Section title="基本信息">
          <Row label="link 名称">
            <TextField value={link.name} onChange={(v) => onUpdate({ name: v })} />
          </Row>
          <Row label="颜色">
            <div className="color-row">
              <input
                type="color"
                value={link.color || '#8ea2b8'}
                onChange={(e) => onUpdate({ color: e.target.value })}
              />
              <span className="mono muted">{link.color}</span>
            </div>
          </Row>
          <Row label="父关节">
            {parentJoint ? (
              <button className="linklike" onClick={() => onSelect?.({ type: 'joint', id: parentJoint.id })}>
                {parentJoint.name}
              </button>
            ) : (
              <span className="muted">无（root link）</span>
            )}
          </Row>
        </Section>

        <Section title="网格 (mesh)">
          {link.mesh ? (
            <>
              <Row label="文件">
                <div className="mesh-file">
                  <span className="mono ellipsis" title={link.mesh.fileName}>
                    {link.mesh.fileName}
                  </span>
                  <span className="muted">{fmtBytes(link.mesh.size)}</span>
                </div>
              </Row>
              <Row label="单位换算" hint="CAD 导出的 STL 常为 mm。导出 URDF 时写入 <mesh scale>，不改动原始文件">
                <select value={link.mesh.unitScale} onChange={(e) => onUpdate({ mesh: { ...link.mesh, unitScale: e.target.value } })}>
                  <option value="mm">mm → m（×0.001，SolidWorks 默认）</option>
                  <option value="m">m（已是米制）</option>
                  <option value="cm">cm → m（×0.01）</option>
                  <option value="in">in → m（×0.0254）</option>
                </select>
              </Row>
              <div className="btn-row">
                <button className="mini" onClick={() => fileRef.current?.click()}>
                  更换网格
                </button>
                <button className="mini" onClick={() => onUpdate({ mesh: null })}>
                  移除
                </button>
              </div>
            </>
          ) : (
            <div className="btn-row">
              <button className="mini primary" onClick={() => fileRef.current?.click()}>
                选择网格文件
              </button>
              <span className="muted">无网格时仍可导出，但 RViz 里看不到几何</span>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".stl,.obj,.dae"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onReplaceMesh(link.id, f)
              e.target.value = ''
            }}
          />
        </Section>

        <Section
          title="质量属性"
          right={link.placeholder ? <Badge tone="warn">占位值</Badge> : null}
        >
          {link.massSource ? (
            <div className="source-card">
              <div className="source-line">
                <span className="k">来源</span>
                <span className="v mono">{link.massSource.fileName || '粘贴文本'}</span>
              </div>
              <div className="source-line">
                <span className="k">原始单位</span>
                <span className="v">
                  {[
                    link.massSource.rawUnits?.mass ? `质量 ${link.massSource.rawUnits.mass}` : null,
                    link.massSource.rawUnits?.length ? `长度 ${link.massSource.rawUnits.length}` : null,
                    link.massSource.rawUnits?.inertia ? `惯量 ${link.massSource.rawUnits.inertia}` : null
                  ]
                    .filter(Boolean)
                    .join(' / ') || '—'}
                </span>
              </div>
              {link.massSource.coordSystem ? (
                <div className="source-line">
                  <span className="k">坐标系假设</span>
                  <span className="v">{link.massSource.coordSystem}</span>
                </div>
              ) : null}
              {link.massSource.note ? (
                <div className="source-note">⚠ {link.massSource.note}</div>
              ) : null}
              <div className="btn-row">
                <button className="mini" onClick={() => onOpenMassImport(link.id)}>
                  重新识别
                </button>
                {link.massSource.rawText ? (
                  <button className="mini" onClick={() => setShowRaw((s) => !s)}>
                    {showRaw ? '收起原文' : '查看原文'}
                  </button>
                ) : null}
                <button className="mini" onClick={() => onUpdate({ massSource: null })}>
                  清除来源
                </button>
              </div>
              {showRaw && link.massSource.rawText ? (
                <pre className="raw-text">{link.massSource.rawText}</pre>
              ) : null}
            </div>
          ) : (
            <div className="empty-inline">
              尚未导入质量属性。可从 SolidWorks「质量属性」(TXT/CSV/复制文本) 导入，或直接手填。
              <div className="btn-row">
                <button className="mini primary" onClick={() => onOpenMassImport(link.id)}>
                  导入质量属性
                </button>
              </div>
            </div>
          )}

          <div className="unit-bar">
            <label>
              质量单位
              <select value={massUnit} onChange={(e) => setMassUnit(e.target.value)}>
                {MASS_OPTS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              长度单位
              <select value={lengthUnit} onChange={(e) => setLengthUnit(e.target.value)}>
                {LENGTH_OPTS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              惯量单位
              <select value={inertiaUnit} onChange={(e) => setInertiaUnit(e.target.value)}>
                {INERTIA_PRESETS.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Row label="质量 mass" hint="URDF <mass value>，单位 kg">
            <NumField
              value={(Number(link.mass) || 0) / mu.factor}
              onChange={(v) => onUpdate({ mass: v * mu.factor, placeholder: false })}
              unit={mu.label}
              step="any"
            />
          </Row>
          <Row label="质心 CoM" hint="相对 link 坐标系原点，URDF <inertial><origin xyz>">
            <Vec3Field
              value={{
                x: (link.com?.x || 0) / lu.factor,
                y: (link.com?.y || 0) / lu.factor,
                z: (link.com?.z || 0) / lu.factor
              }}
              onChange={(v) =>
                onUpdate({ com: { x: v.x * lu.factor, y: v.y * lu.factor, z: v.z * lu.factor } })
              }
              unit={lu.label}
            />
          </Row>

          <div className="subblock">
            <div className="subblock-head">
              <span>惯量张量</span>
              <div className="frame-toggle">
                <button
                  className={link.inertiaFrame !== 'output' ? 'on' : ''}
                  onClick={() => onUpdate({ inertiaFrame: 'com' })}
                  title="惯量相对质心（URDF 原生形式）"
                >
                  质心系
                </button>
                <button
                  className={link.inertiaFrame === 'output' ? 'on' : ''}
                  onClick={() => onUpdate({ inertiaFrame: 'output' })}
                  title="惯量相对输出坐标系（link 原点），导出时自动用平行轴定理换算"
                >
                  输出坐标系
                </button>
              </div>
            </div>
            <div className="inertia-grid">
              {[
                ['ixx', 'Ixx'],
                ['ixy', 'Ixy'],
                ['ixz', 'Ixz'],
                ['iyy', 'Iyy'],
                ['iyz', 'Iyz'],
                ['izz', 'Izz']
              ].map(([k, label]) => (
                <label key={k} className="inertia-cell">
                  <span>{label}</span>
                  <NumField value={toIU(link.inertia?.[k])} onChange={(v) => setInertia(k, v)} step="any" />
                </label>
              ))}
            </div>
            <div className="subblock-foot">
              单位 {iu.label}
              {link.inertiaFrame === 'output' ? (
                <span className="frame-note">
                  导出换算到质心：Ixx={fmtShort(atCom.ixx)} Iyy={fmtShort(atCom.iyy)} Izz={fmtShort(atCom.izz)}{' '}
                  kg·m²
                </span>
              ) : null}
            </div>
          </div>

          <div className="btn-row">
            <button
              className="mini"
              onClick={() =>
                onUpdate({
                  mass: link.mass || 0.05,
                  com: link.com,
                  inertia: {
                    ixx: (link.mass || 0.05) * 3.3e-5,
                    ixy: 0,
                    ixz: 0,
                    iyy: (link.mass || 0.05) * 4.2e-5,
                    iyz: 0,
                    izz: (link.mass || 0.05) * 4.2e-5
                  },
                  placeholder: true
                })
              }
              title="按 50g 量级给出占位惯量，导出时会带警告，请务必替换为 CAD 值"
            >
              用占位值填充
            </button>
            {link.placeholder ? (
              <button className="mini" onClick={() => onUpdate({ placeholder: false })}>
                标记为真实值
              </button>
            ) : null}
          </div>
        </Section>

        <Section title="备注" defaultOpen={false}>
          <textarea
            className="note-area"
            rows={3}
            placeholder="例如：指节 1，铝合金 6061，来自 v3 版 STEP"
            value={link.note || ''}
            onChange={(e) => onUpdate({ note: e.target.value })}
          />
        </Section>
      </div>
    </div>
  )
}
