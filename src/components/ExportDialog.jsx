import React, { useState } from 'react'
import { fmtBytes } from '../core/units.js'
import { meshByteSize } from '../core/project.js'
import { exportMeshName, uniqueNames } from '../core/urdf.js'
import { Badge, Modal, Toggle } from './ui.jsx'

export default function ExportDialog({ project, validation, urdfText, onClose, onExport, busy }) {
  const [includeCollision, setIncludeCollision] = useState(true)
  const [includeMaterials, setIncludeMaterials] = useState(true)
  const robotName = project.robotName || 'robot'
  const errors = validation.items.filter((i) => i.level === 'error')
  const warns = validation.items.filter((i) => i.level === 'warn')
  const linkNames = uniqueNames(project.links, 'link')
  const missingMesh = project.links.filter((l) => !l.mesh?.dataBase64)

  return (
    <Modal
      title="导出 URDF + meshes"
      subtitle="导出一个可直接放进 ROS 2 功能包的 zip：robot.urdf + meshes/ + README + 校验脚本"
      width={760}
      onClose={onClose}
      footer={
        <>
          <div className="modal-hint">
            {errors.length ? (
              <span className="text-err">存在 {errors.length} 个错误，必须先修复才能导出</span>
            ) : warns.length ? (
              <span className="text-warn">有 {warns.length} 条警告，可导出但请复核</span>
            ) : (
              <span className="text-ok">校验通过</span>
            )}
          </div>
          <div className="spacer" />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={!!errors.length || busy}
            onClick={() => onExport({ includeCollision, includeMaterials })}
          >
            {busy ? '打包中…' : `下载 ${robotName}_urdf.zip`}
          </button>
        </>
      }
    >
      {errors.length ? (
        <div className="export-block">
          <strong>导出被阻止：</strong>
          <ul>
            {errors.slice(0, 6).map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
            {errors.length > 6 ? <li>…还有 {errors.length - 6} 条，请看下方「校验」面板</li> : null}
          </ul>
        </div>
      ) : null}

      <div className="export-summary">
        <div>
          <span className="k">robot 名称</span>
          <span className="v mono">{robotName}</span>
        </div>
        <div>
          <span className="k">links / joints</span>
          <span className="v">
            {project.links.length} / {project.joints.length}
          </span>
        </div>
        <div>
          <span className="k">网格体积</span>
          <span className="v">{fmtBytes(meshByteSize(project))}</span>
        </div>
        <div>
          <span className="k">root</span>
          <span className="v">{project.links.find((l) => l.id === project.rootId)?.name || '—'}</span>
        </div>
      </div>

      <div className="export-cols">
        <div>
          <h4>选项</h4>
          <Toggle checked={includeCollision} onChange={setIncludeCollision} label="生成 <collision>（推荐）" />
          <Toggle checked={includeMaterials} onChange={setIncludeMaterials} label="写入 RViz 材质颜色" />
          <div className="muted small" style={{ marginTop: 8 }}>
            <code>&lt;mesh scale&gt;</code> 根据每个零件的单位设置自动写入。
          </div>
        </div>
        <div>
          <h4>zip 结构</h4>
          <pre className="tree-pre">{`${robotName}_urdf.zip
├── robot.urdf
├── meshes/
${project.links
  .map((l) => `│   └── ${l.mesh ? exportMeshName(l, linkNames.get(l.id)) : `(缺失) ${linkNames.get(l.id)}.stl`}`)
  .join('\n')}
├── params.json
├── check_urdf.py
└── README.md`}</pre>
        </div>
      </div>

      {missingMesh.length ? (
        <div className="export-warn">
          <Badge tone="warn">注意</Badge> {missingMesh.length} 个 link 没有网格：
          {missingMesh.map((l) => l.name).join('、')}。URDF 仍可加载，但 RViz 里这些零件不可见。
        </div>
      ) : null}

      <details className="export-preview">
        <summary>预览 URDF 文本（{urdfText.split('\n').length} 行）</summary>
        <pre className="code">{urdfText}</pre>
      </details>
    </Modal>
  )
}
