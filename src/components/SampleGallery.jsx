import React, { useEffect, useState } from 'react'
import { Modal } from './ui.jsx'

/**
 * 示例库：读取 public/samples/index.json（由 scripts/gen-samples.mjs 生成），
 * 卡片展示拓扑缩略图、连杆/关节数与参数来源。
 */

/** 手型缩略图：用示意线框表达三种拓扑，比图标更直观 */
function HandGlyph({ kind }) {
  const joint = (x, y, c) => <circle cx={x} cy={y} r="2.6" fill={c} stroke="none" />
  const seg = (x1, y1, x2, y2, c, w = 5.5) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={w} strokeLinecap="round" />
  )
  const palm = (d) => <path d={d} fill="#5d6672" opacity="0.9" />

  if (kind === 'barrett') {
    return (
      <svg viewBox="0 0 104 76" aria-hidden="true">
        {palm('M12 20h28a6 6 0 0 1 6 6v24a6 6 0 0 1-6 6H12a4 4 0 0 1-4-4V24a4 4 0 0 1 4-4z')}
        {seg(46, 28, 62, 28, '#5b8fc9')}
        {seg(62, 28, 78, 25, '#5b8fc9')}
        {joint(46, 28, '#8fc0f0')}
        {joint(62, 28, '#8fc0f0')}
        {seg(46, 48, 62, 48, '#4fae92')}
        {seg(62, 48, 78, 51, '#4fae92')}
        {joint(46, 48, '#7fd4ba')}
        {joint(62, 48, '#7fd4ba')}
        {seg(10, 34, 2, 50, '#c39a57')}
        {seg(2, 50, 15, 61, '#c39a57')}
        {joint(10, 34, '#e0bc83')}
        {joint(2, 50, '#e0bc83')}
      </svg>
    )
  }

  if (kind === 'three-finger') {
    return (
      <svg viewBox="0 0 104 76" aria-hidden="true">
        {palm('M12 22h18a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H12a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4z')}
        {[
          [24, '#4d8fd0'],
          [39, '#3fae8c'],
          [54, '#c99a52']
        ].map(([y, c]) => (
          <g key={y}>
            {seg(35, y, 53, y, c)}
            {seg(53, y, 67, y - 2, c)}
            {seg(67, y - 2, 80, y - 4, c)}
            {joint(35, y, c)}
            {joint(53, y, c)}
            {joint(67, y - 2, c)}
          </g>
        ))}
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 104 76" aria-hidden="true">
      {palm('M12 22h22a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5H12a4 4 0 0 1-4-4V26a4 4 0 0 1 4-4z')}
      {seg(39, 38, 56, 38, '#5f8fc4')}
      {seg(56, 38, 71, 34, '#5fae90')}
      {seg(71, 34, 85, 31, '#c9a061')}
      {joint(39, 38, '#8fc0f0')}
      {joint(56, 38, '#8fd8bd')}
      {joint(71, 34, '#e0bc83')}
    </svg>
  )
}

const fmtMass = (v) => (v >= 1 ? `${v.toFixed(2)} kg` : `${Math.round(v * 1000)} g`)

export default function SampleGallery({ onClose, onPick, busyFile }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    const base = `${import.meta.env.BASE_URL}samples/`
    fetch(`${base}index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((j) => alive && setItems(j.samples || []))
      .catch((e) => alive && setErr(e.message))
    return () => {
      alive = false
    }
  }, [])

  return (
    <Modal
      title="示例库"
      subtitle="三套可直接拼装、校验、导出的工程，都带网格与完整质量属性"
      width={780}
      onClose={onClose}
      footer={
        <>
          <span className="modal-hint">
            载入后可立即改参数、拖关节、导出 URDF；导出包内 <code>tools/check_urdf.py</code> 可自检
          </span>
          <div className="spacer" />
          <button onClick={onClose}>关闭</button>
        </>
      }
    >
      <div className="gallery-list">
        {err ? (
          <div className="gallery-empty">
            读不到 <code>samples/index.json</code>（{err}）。
            <br />
            先运行 <code>npm run samples</code> 重新生成示例数据。
          </div>
        ) : !items ? (
          <div className="gallery-empty">正在读取示例…</div>
        ) : (
          items.map((s) => (
            <button
              key={s.file}
              className="sample-card"
              data-file={s.file}
              disabled={!!busyFile}
              onClick={() => onPick(s.file)}
            >
              <span className="sc-glyph">
                <HandGlyph kind={s.glyph} />
              </span>
              <span className="sc-body">
                <span className="sc-head">
                  <b>{s.name}</b>
                  <span className="sc-sub">{s.subtitle}</span>
                </span>
                <span className="sc-desc">{s.desc}</span>
                <span className="sc-meta">
                  {s.tags.map((t) => (
                    <span className="sc-tag" key={t}>
                      {t}
                    </span>
                  ))}
                  <span className="sc-src">来源：{s.source}</span>
                </span>
              </span>
              <span className="sc-stats">
                <span>
                  <b>{s.links}</b> links
                </span>
                <span>
                  <b>{s.joints}</b> joints
                </span>
                <span>
                  <b>{fmtMass(s.mass)}</b> 总质量
                </span>
                <span className="sc-go">{busyFile === s.file ? '载入中…' : '载入 →'}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}
