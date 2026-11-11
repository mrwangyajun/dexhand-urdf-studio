import React, { useRef, useState } from 'react'
import { fmtBytes } from '../core/units.js'
import { Badge, Empty } from './ui.jsx'

export default function PartsPanel({
  project,
  selection,
  onSelect,
  onUploadFiles,
  onOpenMassImport,
  onRemoveLink,
  onCreateLink
}) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)

  const pick = () => inputRef.current?.click()

  const handleFiles = (files) => {
    const list = Array.from(files || []).filter(Boolean)
    if (list.length) onUploadFiles(list)
  }

  return (
    <div className="panel-part">
      <div className="panel-head">
        <h3>
          零件库 <span className="count">{project.links.length}</span>
        </h3>
        <div className="panel-head-actions">
          <button className="mini" onClick={onCreateLink} title="先建空零件，稍后补网格">
            空零件
          </button>
          <button className="mini primary" onClick={pick}>
            上传网格
          </button>
        </div>
      </div>

      <div
        className={`dropzone ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={pick}
      >
        <div className="dz-title">拖入 STL / OBJ / DAE</div>
        <div className="dz-sub">每个文件 = 一个 link（SolidWorks 里已建好坐标系的零件）</div>
        <div className="dz-hint">STL 通常按 mm 导出，默认按 mm→m 换算，可在右侧改</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".stl,.obj,.dae"
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="panel-scroll">
        {!project.links.length ? (
          <Empty>
            还没有零件。
            <br />
            上传网格或点「载入示例」快速体验。
          </Empty>
        ) : (
          <ul className="part-list">
            {project.links.map((l) => {
              const active = selection?.type === 'link' && selection.id === l.id
              return (
                <li
                  key={l.id}
                  className={`part-item ${active ? 'active' : ''}`}
                  onClick={() => onSelect({ type: 'link', id: l.id })}
                >
                  <span className="swatch" style={{ background: l.color }} />
                  <div className="part-main">
                    <div className="part-name" title={l.name}>
                      {l.name}
                      {project.rootId === l.id ? <Badge tone="blue">root</Badge> : null}
                    </div>
                    <div className="part-sub">
                      {l.mesh ? (
                        <>
                          {l.mesh.fileName} · {fmtBytes(l.mesh.size)} · 单位 {l.mesh.unitScale}
                        </>
                      ) : (
                        <span className="text-warn">无网格</span>
                      )}
                    </div>
                    <div className="part-badges">
                      {l.placeholder ? <Badge tone="warn">占位值</Badge> : null}
                      {!l.massSource ? <Badge tone="gray">未识别质量属性</Badge> : <Badge tone="ok">已识别</Badge>}
                    </div>
                  </div>
                  <div className="part-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title="导入质量属性" onClick={() => onOpenMassImport(l.id)}>
                      ⚖
                    </button>
                    <button className="icon-btn danger" title="删除零件" onClick={() => onRemoveLink(l.id)}>
                      ✕
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
