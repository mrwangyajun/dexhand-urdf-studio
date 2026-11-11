import React, { useEffect, useRef, useState } from 'react'
import { fmtShort } from '../core/units.js'

/** 数值输入：内部保留输入草稿，失焦后回到规范化显示 */
export function NumField({ value, onChange, step = 'any', unit, disabled, placeholder, title }) {
  const [draft, setDraft] = useState(null)
  const shown = draft !== null ? draft : fmtShort(value ?? 0, 8)
  return (
    <span className={`numfield ${disabled ? 'is-disabled' : ''}`} title={title}>
      <input
        type="number"
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value)
          const n = parseFloat(e.target.value)
          if (Number.isFinite(n)) onChange(n)
          else if (e.target.value === '' || e.target.value === '-') onChange(0)
        }}
        onBlur={() => setDraft(null)}
      />
      {unit ? <em>{unit}</em> : null}
    </span>
  )
}

export function TextField({ value, onChange, placeholder, disabled, mono }) {
  return (
    <input
      className={mono ? 'mono' : ''}
      type="text"
      disabled={disabled}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function Vec3Field({ value, onChange, unit, step = 'any', labels = ['X', 'Y', 'Z'], disabled }) {
  const v = value || { x: 0, y: 0, z: 0 }
  const set = (k, n) => onChange({ ...v, [k]: n })
  return (
    <div className="vec3">
      {['x', 'y', 'z'].map((k, i) => (
        <label key={k} className="vec3-cell">
          <span className="vec3-label">{labels[i]}</span>
          <NumField value={v[k]} onChange={(n) => set(k, n)} step={step} disabled={disabled} />
        </label>
      ))}
      {unit ? <span className="vec3-unit">{unit}</span> : null}
    </div>
  )
}

export function Section({ title, children, right, defaultOpen = true, dense }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`section ${open ? 'open' : ''} ${dense ? 'dense' : ''}`}>
      <header onClick={() => setOpen((o) => !o)}>
        <span className="chev">{open ? '▾' : '▸'}</span>
        <h4>{title}</h4>
        <div className="section-right" onClick={(e) => e.stopPropagation()}>
          {right}
        </div>
      </header>
      {open ? <div className="section-body">{children}</div> : null}
    </section>
  )
}

export function Row({ label, children, hint, wide }) {
  return (
    <div className={`row ${wide ? 'wide' : ''}`}>
      <label className="row-label">
        {label}
        {hint ? <span className="hint" title={hint}>?</span> : null}
      </label>
      <div className="row-input">{children}</div>
    </div>
  )
}

export function Modal({ title, children, onClose, width = 720, footer, subtitle }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={{ width }}>
        <header>
          <div>
            <h3>{title}</h3>
            {subtitle ? <p className="modal-sub">{subtitle}</p> : null}
          </div>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  )
}

export function Badge({ tone = 'gray', children, title }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

export function Toggle({ checked, onChange, label, title }) {
  return (
    <label className="toggle" title={title}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function useToast() {
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const show = (text, tone = 'info') => {
    setMsg({ text, tone })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 4200)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  const node = msg ? <div className={`toast toast-${msg.tone}`}>{msg.text}</div> : null
  return [node, show]
}
