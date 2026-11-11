import React, { useMemo, useRef, useState } from 'react'
import { parseMassProperties } from '../core/parser.js'
import { fileToText, isPdf } from '../core/fileText.js'
import { Badge, Empty, Modal } from './ui.jsx'
import { fmtShort } from '../core/units.js'

let itemSeq = 0

function autoMatchLink(fileName, links) {
  const base = String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
  const norm = (s) => String(s).toLowerCase().replace(/[\s_-]/g, '')
  const hit = links.find((l) => norm(l.name) === norm(base))
  if (hit) return hit.id
  const hit2 = links.find((l) => norm(base).includes(norm(l.name)) || norm(l.name).includes(norm(base)))
  return hit2 ? hit2.id : ''
}

export default function MassImportDialog({ project, defaultLinkId, onClose, onApply }) {
  const [items, setItems] = useState([])
  const [expanded, setExpanded] = useState({})
  const fileRef = useRef(null)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const addItem = (item) => {
    const id = `mi_${++itemSeq}`
    setItems((prev) => {
      const targetId =
        item.targetId ?? (autoMatchLink(item.fileName, project.links) || (prev.length === 0 ? defaultLinkId || '' : ''))
      return [...prev, { ...item, id, targetId }]
    })
  }

  const addText = (text, fileName, linkId) => {
    addItem({ fileName, text, parsed: parseMassProperties(text), targetId: linkId })
  }

  const handleFiles = async (files) => {
    for (const f of Array.from(files || [])) {
      if (isPdf(f)) {
        addItem({ fileName: f.name, text: '', parsed: null, pdf: true, targetId: defaultLinkId || '' })
        continue
      }
      const text = await fileToText(f)
      addText(text, f.name)
    }
  }

  const updateItem = (id, patch) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const applicable = items.filter((it) => it.targetId && it.parsed && !it.applied)

  const applyAll = () => {
    for (const it of applicable) {
      onApply(it.targetId, it.parsed, { fileName: it.fileName, rawText: it.text })
    }
    onClose()
  }

  const readClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      setPasteText(t)
      setPasteMode(true)
    } catch {
      alert('浏览器不允许读取剪贴板，请手动 Ctrl+V 粘贴到文本框')
      setPasteMode(true)
    }
  }

  const loadSample = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/massprops/palm.txt`)
      const t = await res.text()
      setPasteText(t)
      setPasteMode(true)
    } catch {
      setPasteText('Mass properties of palm\nMass = 275.4000 grams\nCenter of mass: ( millimeters )\n\tX = 25.00\n\tY = 0.00\n\tZ = 0.00\nMoments of inertia: ( grams * square millimeters )\nTaken at the center of mass.\n\tLxx = 186468.75\tLxy = 0.00\tLzx = 0.00\n\tLyy = 206550.00\tLyz = 0.00\n\tLzz = 351708.75\n')
    }
  }

  return (
    <Modal
      title="识别质量属性"
      subtitle="支持 SolidWorks 质量属性导出的 TXT / CSV，以及从「质量属性」窗口或 PDF 里复制的纯文本。识别结果自动换算为 kg / m / kg·m²，可直接应用后再改。"
      width={880}
      onClose={onClose}
      footer={
        <>
          <div className="modal-hint muted">
            共 {items.length} 项，可应用 {applicable.length} 项
          </div>
          <div className="spacer" />
          <button onClick={onClose}>取消</button>
          <button className="primary" disabled={!applicable.length} onClick={applyAll}>
            应用全部（{applicable.length}）
          </button>
        </>
      }
    >
      <div className="mi-toolbar">
        <button className="mini primary" onClick={() => fileRef.current?.click()}>
          选择文件（可多选）
        </button>
        <button className="mini" onClick={() => setPasteMode((v) => !v)}>
          粘贴文本
        </button>
        <button className="mini" onClick={readClipboard}>
          读取剪贴板
        </button>
        <button className="mini" onClick={loadSample} title="填入示例的 SolidWorks 输出文本">
          插入示例
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".txt,.csv,.pdf,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <div
        className={`mi-drop ${dragOver ? 'over' : ''}`}
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
        onClick={() => fileRef.current?.click()}
      >
        把 .txt / .csv 文件拖到这里（可多选，一次绑定多个零件）
      </div>

      {pasteMode ? (
        <div className="mi-paste">
          <textarea
            rows={7}
            placeholder={'把 SolidWorks「质量属性」窗口的内容整段粘贴进来…\n也可以直接拖一个 .txt / .csv 到页面上'}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="btn-row">
            <button
              className="mini primary"
              disabled={!pasteText.trim()}
              onClick={() => {
                addText(pasteText, '粘贴文本', defaultLinkId)
                setPasteText('')
                setPasteMode(false)
              }}
            >
              解析这段文本
            </button>
            <span className="muted small">解析失败不会丢原文，可继续手填缺项</span>
          </div>
        </div>
      ) : null}

      <div className="mi-list">
        {!items.length ? (
          <Empty>
            还没有导入内容。
            <br />
            选择文件，或点「粘贴文本」把 SolidWorks 质量属性窗口里的文本粘进来。
          </Empty>
        ) : null}

        {items.map((it) => {
          const p = it.parsed
          const ok = p?.ok
          const isOpen = !!expanded[it.id]
          return (
            <div className={`mi-item ${ok ? 'ok' : 'warn'}`} key={it.id}>
              <div className="mi-head">
                <span className="mi-file mono" title={it.fileName}>
                  {it.pdf ? '📄' : '📝'} {it.fileName}
                </span>
                {it.pdf ? (
                  <Badge tone="warn">PDF 需复制文本</Badge>
                ) : ok ? (
                  <Badge tone="ok">识别成功</Badge>
                ) : p ? (
                  <Badge tone="warn">缺 {p.missing.length} 项</Badge>
                ) : (
                  <Badge tone="err">未识别</Badge>
                )}
                <div className="spacer" />
                <label className="mi-bind">
                  绑定到 link
                  <select value={it.targetId} onChange={(e) => updateItem(it.id, { targetId: e.target.value })}>
                    <option value="">— 未选择 —</option>
                    {project.links.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="mini primary"
                  disabled={!it.targetId || !p || it.applied}
                  onClick={() => {
                    onApply(it.targetId, p, { fileName: it.fileName, rawText: it.text })
                    updateItem(it.id, { applied: true })
                  }}
                >
                  {it.applied ? '已应用' : '应用'}
                </button>
                <button className="mini" onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}>
                  移除
                </button>
              </div>

              {it.pdf ? (
                <div className="mi-body">
                  浏览器内不解析 PDF 文件本身：请在 PDF 阅读器里全选复制文本，再用「粘贴文本」。
                </div>
              ) : p ? (
                <div className="mi-body">
                  <div className="mi-grid">
                    <div>
                      <span className="k">质量</span>
                      <span className="v">{p.mass != null ? `${fmtShort(p.mass, 8)} kg` : <em className="text-err">未识别</em>}</span>
                      <span className="raw">{p.meta.massRaw}</span>
                    </div>
                    <div>
                      <span className="k">质心</span>
                      <span className="v">
                        {p.com ? `(${fmtShort(p.com.x, 6)}, ${fmtShort(p.com.y, 6)}, ${fmtShort(p.com.z, 6)}) m` : <em className="text-err">未识别</em>}
                      </span>
                      <span className="raw">{p.meta.comRaw}</span>
                    </div>
                    <div>
                      <span className="k">惯量</span>
                      <span className="v">
                        {p.inertia
                          ? `Ixx ${fmtShort(p.inertia.ixx, 4)} · Iyy ${fmtShort(p.inertia.iyy, 4)} · Izz ${fmtShort(p.inertia.izz, 4)}`
                          : <em className="text-err">未识别</em>}
                      </span>
                      <span className="raw">
                        {p.meta.inertiaUnit ? `${p.meta.inertiaUnit.raw} → kg·m²` : ''}
                        {p.inertiaFrame === 'output' ? ' · 相对输出坐标系' : p.inertia ? ' · 相对质心' : ''}
                      </span>
                    </div>
                  </div>
                  {p.meta.coordSystem ? <div className="mi-note">坐标系假设：{p.meta.coordSystem}</div> : null}
                  {p.notes.map((n, i) => (
                    <div className="mi-note" key={i}>
                      ℹ {n}
                    </div>
                  ))}
                  {p.warnings.map((n, i) => (
                    <div className="mi-note warn" key={i}>
                      ⚠ {n}
                    </div>
                  ))}
                  {!ok ? (
                    <div className="mi-missing">
                      缺项：{p.missing.map((k) => ({ mass: '质量', com: '质心', inertia: '惯量' }[k] || k)).join('、')}
                      <button className="mini" onClick={() => it.targetId && onApply(it.targetId, p, { fileName: it.fileName, rawText: it.text, partial: true })}>
                        先应用已识别的字段，其余手填
                      </button>
                    </div>
                  ) : null}
                  <button className="linklike" onClick={() => setExpanded((s) => ({ ...s, [it.id]: !isOpen }))}>
                    {isOpen ? '收起原文' : '查看原文'}
                  </button>
                  {isOpen ? <pre className="mi-raw">{it.text || '（空）'}</pre> : null}
                </div>
              ) : (
                <div className="mi-body text-err">未能识别，请检查文本或直接手填</div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
