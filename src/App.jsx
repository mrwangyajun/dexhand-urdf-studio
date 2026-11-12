import React, { useEffect, useMemo, useRef, useState } from 'react'
import Viewport from './components/Viewport.jsx'
import PartsPanel from './components/PartsPanel.jsx'
import TreePanel from './components/TreePanel.jsx'
import LinkPanel from './components/LinkPanel.jsx'
import JointPanel from './components/JointPanel.jsx'
import JointDialog from './components/JointDialog.jsx'
import MassImportDialog from './components/MassImportDialog.jsx'
import ExportDialog from './components/ExportDialog.jsx'
import SampleGallery from './components/SampleGallery.jsx'
import Drawer from './components/Drawer.jsx'
import { Badge, NumField, Toggle, useToast } from './components/ui.jsx'
import {
  arrayBufferToBase64,
  createLink,
  createJoint,
  downloadText,
  emptyProject,
  meshByteSize,
  nextLinkName,
  normalizeProject
} from './core/project.js'
import { buildUrdf } from './core/urdf.js'
import { validateProject } from './core/validate.js'
import { traceTree } from './core/tree.js'
import { downloadExportZip } from './core/exportZip.js'
import { fmtBytes } from './core/units.js'

const STORAGE_KEY = 'dexhand-urdf-studio/project/v1'

function baseName(fn) {
  return String(fn || 'part')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
}

export default function App() {
  const [project, setProject] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const p = JSON.parse(raw)
        const norm = normalizeProject(p)
        if (norm.links.length) return norm
      }
    } catch {
      /* 忽略：本地缓存损坏 */
    }
    return emptyProject()
  })
  const [selection, setSelection] = useState(null)
  const [jointValues, setJointValues] = useState({})
  const [options, setOptions] = useState({ showAxes: true, showCom: true, showJointAxes: true })
  const [dialog, setDialog] = useState(null) // 'joint' | 'mass' | 'export'
  const [massTarget, setMassTarget] = useState(null)
  const [drawerTab, setDrawerTab] = useState('check')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [fitSignal, setFitSignal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [gallery, setGallery] = useState(false)
  const [viewPreset, setViewPreset] = useState({ id: 'iso', n: 0 })
  const [sampleBusy, setSampleBusy] = useState('')
  const [toastNode, toast] = useToast()
  const fileRef = useRef(null)

  const validation = useMemo(() => validateProject(project), [project])
  const urdfText = useMemo(
    () => buildUrdf(project, { includeCollision: true, includeMaterials: true }),
    [project]
  )
  const tree = useMemo(() => traceTree(project), [project.links, project.joints, project.rootId])

  // ---------- 自动保存 ----------
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const heavy = meshByteSize(project) > 3.5e6
        const payload = heavy
          ? {
              ...project,
              meshStripped: true,
              links: project.links.map((l) => ({ ...l, mesh: l.mesh ? { ...l.mesh, dataBase64: '' } : null }))
            }
          : project
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      } catch {
        /* 容量不足时静默失败，用户仍可用「保存工程」落盘 */
      }
    }, 700)
    return () => clearTimeout(t)
  }, [project])

  // ---------- 基础操作 ----------
  const patchProject = (patch) =>
    setProject((p) => ({ ...p, ...patch, updatedAt: new Date().toISOString() }))

  const updateLink = (id, patch) =>
    setProject((p) => ({
      ...p,
      updatedAt: new Date().toISOString(),
      links: p.links.map((l) => (l.id === id ? { ...l, ...patch } : l))
    }))

  const updateJoint = (id, patch) =>
    setProject((p) => ({
      ...p,
      updatedAt: new Date().toISOString(),
      joints: p.joints.map((j) => (j.id === id ? { ...j, ...patch } : j))
    }))

  const removeLink = (id) => {
    const link = project.links.find((l) => l.id === id)
    const childJoints = project.joints.filter((j) => j.childId === id)
    if (!window.confirm(`删除零件「${link?.name}」？相关 ${childJoints.length} 个关节也会删除。`)) return
    setProject((p) => {
      const links = p.links.filter((l) => l.id !== id)
      const joints = p.joints.filter((j) => j.parentId !== id && j.childId !== id)
      const rootId = p.rootId === id ? links[0]?.id || null : p.rootId
      return { ...p, links, joints, rootId, updatedAt: new Date().toISOString() }
    })
    setSelection(null)
  }

  const removeJoint = (id) => {
    const j = project.joints.find((x) => x.id === id)
    if (!window.confirm(`删除关节「${j?.name}」？child 会变成悬空零件。`)) return
    setProject((p) => ({ ...p, joints: p.joints.filter((x) => x.id !== id), updatedAt: new Date().toISOString() }))
    setSelection(null)
  }

  const addJoint = (joint) => {
    setProject((p) => ({ ...p, joints: [...p.joints, joint], updatedAt: new Date().toISOString() }))
    setDialog(null)
    setSelection({ type: 'joint', id: joint.id })
    toast(`已创建关节 ${joint.name}`)
  }

  const setRoot = (id) => {
    patchProject({ rootId: id })
    toast('已切换 root link，注意检查是否会拆成多棵树')
  }

  const createEmptyLink = () => {
    const link = createLink({ name: nextLinkName(project) })
    setProject((p) => ({ ...p, links: [...p.links, link], rootId: p.rootId || link.id }))
    setSelection({ type: 'link', id: link.id })
  }

  // ---------- 网格上传 ----------
  const addLinksFromFiles = async (files) => {
    const created = []
    const used = new Set(project.links.map((l) => l.name))
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      if (!['stl', 'obj', 'dae'].includes(ext)) {
        toast(`跳过不支持的文件：${f.name}（只支持 STL/OBJ/DAE）`, 'err')
        continue
      }
      const buf = await f.arrayBuffer()
      let name = baseName(f.name)
      let i = 2
      while (used.has(name)) name = `${baseName(f.name)}_${i++}`
      used.add(name)
      created.push(
        createLink({
          name,
          mesh: {
            fileName: f.name,
            dataBase64: arrayBufferToBase64(buf),
            size: buf.byteLength,
            unitScale: 'mm',
            format: ext
          }
        })
      )
    }
    if (!created.length) return
    setProject((p) => ({
      ...p,
      links: [...p.links, ...created],
      rootId: p.rootId || created[0].id,
      updatedAt: new Date().toISOString()
    }))
    setSelection({ type: 'link', id: created[0].id })
    setFitSignal((n) => n + 1)
    toast(`已导入 ${created.length} 个零件，默认按 mm→m 换算，可在右侧修改`)
  }

  const replaceMesh = async (linkId, file) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (!['stl', 'obj', 'dae'].includes(ext)) {
      toast('只支持 STL/OBJ/DAE', 'err')
      return
    }
    const buf = await file.arrayBuffer()
    updateLink(linkId, {
      mesh: {
        fileName: file.name,
        dataBase64: arrayBufferToBase64(buf),
        size: buf.byteLength,
        unitScale: project.links.find((l) => l.id === linkId)?.mesh?.unitScale || 'mm',
        format: ext
      }
    })
    toast('网格已更新')
  }

  // ---------- 质量属性 ----------
  const applyMass = (linkId, parsed, { fileName, rawText } = {}) => {
    setProject((p) => ({
      ...p,
      updatedAt: new Date().toISOString(),
      links: p.links.map((l) => {
        if (l.id !== linkId) return l
        const notes = []
        if (parsed.meta?.massUnit?.assumed) notes.push('质量单位未识别，按 g 处理')
        if (parsed.meta?.lengthUnit?.assumed) notes.push('长度单位未识别，按 mm 处理')
        if (parsed.inertiaFrame === 'output') notes.push('惯量取自输出坐标系，导出时换算到质心')
        for (const w of parsed.warnings || []) notes.push(w)
        return {
          ...l,
          ...(parsed.mass != null ? { mass: parsed.mass } : {}),
          ...(parsed.com ? { com: parsed.com } : {}),
          ...(parsed.inertia ? { inertia: parsed.inertia } : {}),
          inertiaFrame: parsed.inertiaFrame || l.inertiaFrame,
          placeholder: false,
          massSource: {
            fileName: fileName || '粘贴文本',
            rawUnits: {
              mass: parsed.meta?.massUnit?.raw || '',
              length: parsed.meta?.lengthUnit?.raw || '',
              inertia: parsed.meta?.inertiaUnit?.raw || ''
            },
            coordSystem: parsed.meta?.coordSystem || '',
            note: notes.join('；'),
            parsedAt: new Date().toISOString(),
            rawText: (rawText || '').slice(0, 20000)
          }
        }
      })
    }))
  }

  // ---------- 工程文件 ----------
  const saveProject = () => {
    const data = JSON.stringify({ ...project, savedAt: new Date().toISOString() }, null, 2)
    downloadText(`${project.robotName || 'robot'}.dexhand.json`, data, 'application/json')
    toast('工程已保存为 JSON（含内嵌网格）')
  }

  const openProject = async (file) => {
    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      const p = normalizeProject(raw)
      setProject(p)
      setSelection(p.links[0] ? { type: 'link', id: p.links[0].id } : null)
      setJointValues({})
      setFitSignal((n) => n + 1)
      const stripped = p.links.some((l) => l.mesh && !l.mesh.dataBase64)
      toast(
        stripped
          ? '工程已打开，但部分网格未内嵌，请重新上传对应零件'
          : `工程已打开：${p.links.length} 个零件 / ${p.joints.length} 个关节`,
        stripped ? 'warn' : 'info'
      )
    } catch (e) {
      toast(`打开失败：${e.message}`, 'err')
    }
  }

  /** 载入示例工程：读 project.json，再把同名 meshes 打进内存 */
  const loadSample = async (file = 'finger_hand.project.json') => {
    setSampleBusy(file)
    try {
      const base = `${import.meta.env.BASE_URL}samples/`
      const res = await fetch(`${base}${file}`)
      if (!res.ok) throw new Error('找不到示例工程，请先运行 npm run samples')
      const json = await res.json()
      const dir = json.meshBaseDir || 'meshes/'
      const cache = new Map()
      for (const l of json.links) {
        if (!l.mesh?.fileName || l.mesh.dataBase64) continue
        if (!cache.has(l.mesh.fileName)) {
          const r = await fetch(`${base}${dir}${l.mesh.fileName}`)
          cache.set(l.mesh.fileName, r.ok ? await r.arrayBuffer() : null)
        }
        const buf = cache.get(l.mesh.fileName)
        if (!buf) continue
        l.mesh.dataBase64 = arrayBufferToBase64(buf)
        l.mesh.size = buf.byteLength
        l.mesh.format = 'stl'
      }
      const p = normalizeProject(json)
      if (!p.links.length) throw new Error('示例里没有零件')
      setProject(p)
      setJointValues({})
      setSelection({ type: 'link', id: p.rootId || p.links[0]?.id })
      setFitSignal((n) => n + 1)
      setGallery(false)
      toast(`已载入示例：${p.robotName}（${p.links.length} links / ${p.joints.length} joints）`)
    } catch (e) {
      toast(`示例载入失败：${e.message}`, 'err')
    } finally {
      setSampleBusy('')
    }
  }

  const newProject = () => {
    if (project.links.length && !window.confirm('新建会清空当前工程（未保存的内容会丢失），继续？')) return
    const p = emptyProject('dex_hand')
    setProject(p)
    setSelection(null)
    setJointValues({})
    toast('已新建空工程')
  }

  // ---------- 导出 ----------
  const doExport = async (opts) => {
    setBusy(true)
    try {
      const fn = await downloadExportZip(project, { ...opts, robotName: project.robotName })
      setDialog(null)
      toast(`已导出 ${fn}`)
    } catch (e) {
      toast(`导出失败：${e.message}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  // Ctrl+S 保存工程
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveProject()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const selectedLink = selection?.type === 'link' ? project.links.find((l) => l.id === selection.id) : null
  const selectedJoint = selection?.type === 'joint' ? project.joints.find((j) => j.id === selection.id) : null
  const movableJoints = project.joints.filter((j) => j.type !== 'fixed')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          <span>
            灵巧手 <b>URDF Studio</b>
          </span>
          <span className="ver">v0.1</span>
        </div>

        <label className="robot-name">
          robot
          <input
            value={project.robotName}
            spellCheck={false}
            onChange={(e) => patchProject({ robotName: e.target.value })}
          />
        </label>

        <div className="spacer" />

        <div className="tb-group">
          <button onClick={newProject}>新建</button>
          <button onClick={() => setGallery(true)} title="三指灵巧手 / Barrett Hand / 单指示例">
            载入示例
          </button>
          <button onClick={() => fileRef.current?.click()}>打开工程</button>
          <button onClick={saveProject}>保存工程</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) openProject(f)
            e.target.value = ''
          }}
        />

        <div className="vsep" />

        <button
          className={`status-pill ${
            !project.links.length ? 'idle' : validation.canExport ? (validation.warnCount ? 'warn' : 'ok') : 'err'
          }`}
          onClick={() => {
            setDrawerTab('check')
            setDrawerOpen(true)
          }}
          title="查看校验详情"
        >
          {!project.links.length
            ? '空工程'
            : validation.canExport
              ? validation.warnCount
                ? `${validation.warnCount} 警告`
                : '校验通过'
              : `${validation.errorCount} 错误`}
        </button>

        <button className="primary" onClick={() => setDialog('export')}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 2v7m0 0L5.2 6.2M8 9l2.8-2.8M3 11.5v1.2c0 .7.6 1.3 1.3 1.3h7.4c.7 0 1.3-.6 1.3-1.3v-1.2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          导出 URDF
        </button>
      </header>

      <main className="main">
        <aside className="col-left">
          <PartsPanel
            project={project}
            selection={selection}
            onSelect={setSelection}
            onUploadFiles={addLinksFromFiles}
            onOpenMassImport={(linkId) => {
              setMassTarget(linkId)
              setDialog('mass')
            }}
            onRemoveLink={removeLink}
            onCreateLink={createEmptyLink}
          />
          <TreePanel
            project={project}
            selection={selection}
            onSelect={setSelection}
            onAddJoint={() => setDialog('joint')}
            onSetRoot={setRoot}
          />
        </aside>

        <section className="col-center">
          <div className="view-toolbar">
            <Toggle checked={options.showAxes} onChange={(v) => setOptions((o) => ({ ...o, showAxes: v }))} label="link 坐标轴" />
            <Toggle checked={options.showCom} onChange={(v) => setOptions((o) => ({ ...o, showCom: v }))} label="质心" />
            <Toggle
              checked={options.showJointAxes}
              onChange={(v) => setOptions((o) => ({ ...o, showJointAxes: v }))}
              label="关节轴"
            />
            <div className="spacer" />
            <div className="view-presets" role="group" aria-label="视角预设">
              {[
                ['iso', '等轴'],
                ['front', '前视'],
                ['top', '俯视'],
                ['side', '侧视']
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={viewPreset.id === id ? 'on' : ''}
                  onClick={() => setViewPreset({ id, n: (viewPreset.n || 0) + 1 })}
                  title={`切换到${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="muted small">
              {project.links.length} links / {project.joints.length} joints
              {tree.unreachable.length ? <span className="text-err"> · {tree.unreachable.length} 悬空</span> : null}
            </span>
          </div>

          <Viewport
            project={project}
            selection={selection}
            onSelect={setSelection}
            jointValues={jointValues}
            options={options}
            fitSignal={fitSignal}
            viewPreset={viewPreset}
            onOpenSamples={() => setGallery(true)}
          />

          {movableJoints.length ? (
            <div className={`jointbar ${movableJoints.length > 6 ? 'compact' : ''}`}>
              {movableJoints.map((j) => {
                const q = jointValues[j.id] ?? 0
                const isPrismatic = j.type === 'prismatic'
                const lo = j.type === 'continuous' ? -Math.PI : j.limit?.lower ?? -1.57
                const hi = j.type === 'continuous' ? Math.PI : j.limit?.upper ?? 1.57
                return (
                  <div className="jb-item" key={j.id}>
                    <button className="jb-name" onClick={() => setSelection({ type: 'joint', id: j.id })} title={j.name}>
                      {j.name}
                    </button>
                    <input
                      type="range"
                      min={Math.min(lo, hi)}
                      max={Math.max(lo, hi)}
                      step={(Math.max(Math.abs(hi - lo), 1e-3) / 200) || 0.001}
                      value={q}
                      onChange={(e) => setJointValues((s) => ({ ...s, [j.id]: parseFloat(e.target.value) }))}
                    />
                    <NumField
                      value={isPrismatic ? q * 1000 : (q * 180) / Math.PI}
                      onChange={(v) => setJointValues((s) => ({ ...s, [j.id]: isPrismatic ? v / 1000 : (v * Math.PI) / 180 }))}
                      unit={isPrismatic ? 'mm' : '°'}
                    />
                  </div>
                )
              })}
              <button className="mini" onClick={() => setJointValues({})}>
                全部归零
              </button>
            </div>
          ) : null}

          <Drawer
            tab={drawerTab}
            onTab={(t) => {
              setDrawerTab(t)
              setDrawerOpen(true)
            }}
            urdfText={urdfText}
            validation={validation}
            onSelect={setSelection}
            open={drawerOpen}
            onToggle={() => setDrawerOpen((o) => !o)}
            robotName={project.robotName}
          />
        </section>

        <aside className="col-right">
          {selectedLink ? (
            <LinkPanel
              key={selectedLink.id}
              project={project}
              link={selectedLink}
              onUpdate={(patch) => updateLink(selectedLink.id, patch)}
              onRemove={removeLink}
              onOpenMassImport={(linkId) => {
                setMassTarget(linkId)
                setDialog('mass')
              }}
              onReplaceMesh={replaceMesh}
              onSetRoot={setRoot}
              onSelect={setSelection}
            />
          ) : selectedJoint ? (
            <JointPanel
              key={selectedJoint.id}
              project={project}
              joint={selectedJoint}
              onUpdate={(patch) => updateJoint(selectedJoint.id, patch)}
              onRemove={removeJoint}
              jointValues={jointValues}
              setJointValue={(id, v) => setJointValues((s) => ({ ...s, [id]: v }))}
              onSelect={setSelection}
            />
          ) : (
            <div className="props-empty">
              <div className="pe-icon">◈</div>
              <h3>未选中对象</h3>
              <p>在左侧点一个零件或关节，这里会显示它的参数。</p>
              <ul className="pe-tips">
                <li>零件：网格、质量、质心、惯量</li>
                <li>关节：类型、origin、axis、limit</li>
              </ul>
              {project.links.length ? (
                <button className="mini" onClick={() => setSelection({ type: 'link', id: project.links[0].id })}>
                  选中第一个零件
                </button>
              ) : (
                <button className="mini primary" onClick={() => setGallery(true)}>
                  打开示例库
                </button>
              )}
            </div>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <span>单位 m · kg · rad · kg·m²</span>
        <span className="vsep-dot" />
        <span>{project.links.length} links</span>
        <span className="vsep-dot" />
        <span>{project.joints.length} joints</span>
        <span className="vsep-dot" />
        <span>网格 {fmtBytes(meshByteSize(project))}</span>
        <div className="spacer" />
        {validation.errorCount ? (
          <Badge tone="err">{validation.errorCount} 个错误需修复</Badge>
        ) : validation.warnCount ? (
          <Badge tone="warn">{validation.warnCount} 个警告</Badge>
        ) : (
          <Badge tone="ok">可以导出</Badge>
        )}
      </footer>

      {dialog === 'joint' ? (
        <JointDialog
          project={project}
          defaultParentId={selectedLink?.id}
          onClose={() => setDialog(null)}
          onCreate={addJoint}
        />
      ) : null}

      {dialog === 'mass' ? (
        <MassImportDialog
          project={project}
          defaultLinkId={massTarget}
          onClose={() => {
            setDialog(null)
            if (massTarget) {
              setSelection({ type: 'link', id: massTarget })
            }
          }}
          onApply={applyMass}
        />
      ) : null}

      {dialog === 'export' ? (
        <ExportDialog
          project={project}
          validation={validation}
          urdfText={urdfText}
          onClose={() => setDialog(null)}
          onExport={doExport}
          busy={busy}
        />
      ) : null}

      {gallery ? <SampleGallery onClose={() => setGallery(false)} onPick={loadSample} busyFile={sampleBusy} /> : null}

      {toastNode}
    </div>
  )
}
