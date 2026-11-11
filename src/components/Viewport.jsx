import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { base64ToArrayBuffer } from '../core/project.js'
import { resolveRootId } from '../core/tree.js'

const UNIT_SCALE = { m: 1, mm: 0.001, cm: 0.01, in: 0.0254 }

function rpyEuler(rpy) {
  // URDF: R = Rz(yaw) * Ry(pitch) * Rx(roll)  <=>  内旋 ZYX
  return new THREE.Euler(rpy?.x || 0, rpy?.y || 0, rpy?.z || 0, 'ZYX')
}

function originMatrix(joint) {
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3(joint.origin?.xyz?.x || 0, joint.origin?.xyz?.y || 0, joint.origin?.xyz?.z || 0)
  const quat = new THREE.Quaternion().setFromEuler(rpyEuler(joint.origin?.rpy))
  m.compose(pos, quat, new THREE.Vector3(1, 1, 1))
  return m
}

function motionMatrix(joint, q) {
  const m = new THREE.Matrix4()
  if (!q) return m
  const axis = new THREE.Vector3(joint.axis?.x || 0, joint.axis?.y || 0, joint.axis?.z || 0)
  if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1)
  axis.normalize()
  if (joint.type === 'prismatic') return m.makeTranslation(axis.x * q, axis.y * q, axis.z * q)
  if (joint.type === 'revolute' || joint.type === 'continuous') return m.makeRotationAxis(axis, q)
  return m
}

async function loadMeshObject(link) {
  const ext = (link.mesh?.format || link.mesh?.fileName?.split('.').pop() || 'stl').toLowerCase()
  const buf = base64ToArrayBuffer(link.mesh.dataBase64)
  if (ext === 'stl') {
    const geo = new STLLoader().parse(buf)
    geo.computeVertexNormals()
    return new THREE.Mesh(geo)
  }
  if (ext === 'obj') {
    const text = new TextDecoder().decode(buf)
    return new OBJLoader().parse(text)
  }
  if (ext === 'dae') {
    const text = new TextDecoder().decode(buf)
    const res = new ColladaLoader().parse(text, '')
    return res.scene
  }
  throw new Error(`暂不支持 .${ext} 预览（支持 stl / obj / dae）`)
}

export default function Viewport({ project, selection, onSelect, jointValues, options, fitSignal }) {
  const hostRef = useRef(null)
  const S = useRef({})
  const projectRef = useRef(project)
  const jvRef = useRef(jointValues)
  const optRef = useRef(options)
  const selRef = useRef(selection)
  const onSelectRef = useRef(onSelect)

  projectRef.current = project
  jvRef.current = jointValues
  optRef.current = options
  selRef.current = selection
  onSelectRef.current = onSelect

  // ---------- 初始化 ----------
  useEffect(() => {
    const host = hostRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = false
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0e1217')
    scene.fog = new THREE.Fog('#0e1217', 1.6, 6)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.0005, 100)
    camera.up.set(0, 0, 1)
    camera.position.set(0.26, -0.3, 0.22)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0.05, 0, 0)
    controls.maxDistance = 8
    controls.minDistance = 0.01

    scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x1a2330, 1.35))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(0.6, -0.8, 1.2)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x8fb6ff, 0.55)
    fill.position.set(-0.9, 0.6, 0.4)
    scene.add(fill)
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.3)
    rim.position.set(0.2, 1.1, -0.6)
    scene.add(rim)

    const grid = new THREE.GridHelper(1.2, 60, 0x2f4356, 0x1c2733)
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.06
    scene.add(grid)

    const originAxes = new THREE.AxesHelper(0.05)
    originAxes.material.transparent = true
    originAxes.material.opacity = 0.7
    scene.add(originAxes)

    const raycaster = new THREE.Raycaster()
    const linkObjs = new Map()
    const jointArrows = new Map()

    // 只读调试钩子：给自动化测试读取当前世界变换（不参与任何业务逻辑）
    window.__dexhandViewport = {
      worldMatrix(linkId) {
        const rec = linkObjs.get(linkId)
        return rec ? Array.from(rec.group.matrix.elements) : null
      },
      linkIds() {
        return [...linkObjs.keys()]
      }
    }

    S.current = {
      renderer, scene, camera, controls, raycaster, linkObjs, jointArrows,
      needsSync: true, needsHighlight: true, selBox: null, host, disposed: false
    }

    const resize = () => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    resize()

    // ---------- 拾取 ----------
    let down = null
    const onDown = (e) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onUp = (e) => {
      if (!down) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
      down = null
      if (moved > 4) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      const targets = []
      for (const rec of linkObjs.values()) if (rec.meshWrap.children.length) targets.push(rec.meshWrap)
      const hits = raycaster.intersectObjects(targets, true)
      if (!hits.length) return
      let o = hits[0].object
      while (o && !o.userData.linkId) o = o.parent
      if (o?.userData.linkId) onSelectRef.current?.({ type: 'link', id: o.userData.linkId })
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    let raf = 0
    const animate = () => {
      raf = requestAnimationFrame(animate)
      const st = S.current
      if (!st) return
      if (st.needsSync) {
        syncScene(st)
        st.needsSync = false
        st.needsHighlight = true
      }
      if (st.needsHighlight) {
        applyHighlight(st)
        st.needsHighlight = false
      }
      applyTransforms(st)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      for (const rec of linkObjs.values()) disposeRec(rec)
      for (const a of jointArrows.values()) { scene.remove(a); a.dispose?.() }
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
      if (window.__dexhandViewport?.worldMatrix === undefined) delete window.__dexhandViewport
      S.current = { disposed: true }
    }
  }, [])

  // ---------- 数据变化 -> 重建 ----------
  useEffect(() => {
    if (S.current) S.current.needsSync = true
  }, [project.links, project.joints, project.rootId])

  useEffect(() => {
    if (S.current) S.current.needsHighlight = true
  }, [selection])

  useEffect(() => {
    if (S.current) S.current.needsSync = true
  }, [options.showAxes, options.showCom, options.showJointAxes])

  useEffect(() => {
    if (fitSignal && S.current) fitView(S.current)
  }, [fitSignal])

  // ---------- 场景同步 ----------
  function syncScene(st) {
    const project = projectRef.current
    const opt = optRef.current
    const { scene, linkObjs } = st
    const alive = new Set(project.links.map((l) => l.id))

    for (const [id, rec] of [...linkObjs.entries()]) {
      if (!alive.has(id)) {
        scene.remove(rec.group)
        disposeRec(rec)
        linkObjs.delete(id)
      }
    }

    for (const link of project.links) {
      let rec = linkObjs.get(link.id)
      if (!rec) {
        rec = createRec(link)
        linkObjs.set(link.id, rec)
        scene.add(rec.group)
      }
      rec.link = link
      rec.group.userData.linkId = link.id
      rec.material.color.set(link.color || '#8ea2b8')
      rec.material.emissive.setHex(0x000000)
      const com = link.com || { x: 0, y: 0, z: 0 }
      rec.com.position.set(com.x || 0, com.y || 0, com.z || 0)
      rec.com.visible = !!(opt.showCom && link.mesh?.dataBase64)
      rec.axes.visible = false // 由 highlight 统一控制
      const unit = UNIT_SCALE[link.mesh?.unitScale] ?? 1
      rec.meshWrap.scale.setScalar(unit)
      const meshKey = link.mesh?.dataBase64 ? `${link.mesh.fileName}|${link.mesh.size}|${link.mesh.dataBase64.length}` : ''
      if (rec.meshKey !== meshKey) loadInto(st, rec, link, meshKey)
    }

    // 关节轴箭头
    const jointIds = new Set(project.joints.map((j) => j.id))
    for (const [id, arrow] of [...st.jointArrows.entries()]) {
      if (!jointIds.has(id)) {
        scene.remove(arrow)
        arrow.dispose?.()
        st.jointArrows.delete(id)
      }
    }
    for (const j of project.joints) {
      if (!st.jointArrows.has(j.id)) {
        const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.05, 0x53e0c0, 0.014, 0.008)
        arrow.line.material.linewidth = 2
        st.jointArrows.set(j.id, arrow)
        scene.add(arrow)
      }
    }
    st.selBoxDirty = true
  }

  function createRec(link) {
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    const meshWrap = new THREE.Group()
    group.add(meshWrap)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(link.color || '#8ea2b8'),
      metalness: 0.28,
      roughness: 0.52,
      side: THREE.DoubleSide
    })
    const axes = new THREE.AxesHelper(0.03)
    axes.material.transparent = true
    axes.material.opacity = 0.9
    axes.visible = false
    group.add(axes)
    const com = new THREE.Mesh(
      new THREE.SphereGeometry(0.0032, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xff56d0, depthTest: false, transparent: true, opacity: 0.95 })
    )
    com.renderOrder = 5
    com.visible = false
    group.add(com)
    return { group, meshWrap, material, axes, com, meshKey: null, loadToken: 0, size: 0.05 }
  }

  function loadInto(st, rec, link, meshKey) {
    rec.meshKey = meshKey
    const token = ++rec.loadToken
    for (const ch of [...rec.meshWrap.children]) {
      rec.meshWrap.remove(ch)
      disposeObj(ch)
    }
    if (!meshKey) return
    loadMeshObject(link)
      .then((obj) => {
        if (rec.loadToken !== token) {
          disposeObj(obj)
          return
        }
        obj.traverse((o) => {
          if (o.isMesh) {
            o.material = rec.material
            o.frustumCulled = false
            if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals()
          }
        })
        rec.meshWrap.add(obj)
        const box = new THREE.Box3().setFromObject(obj)
        const size = box.getSize(new THREE.Vector3())
        const unit = UNIT_SCALE[link.mesh?.unitScale] ?? 1
        rec.size = Math.max(size.length() * unit, 0.02)
        rec.axes.scale.setScalar(rec.size * 0.5)
        rec.com.scale.setScalar(Math.max(rec.size * 12, 1))
        st.selBoxDirty = true
        st.needsHighlight = true
        st.needsFit = true
      })
      .catch((err) => {
        console.warn('[mesh] 加载失败', link.name, err)
        rec.loadError = String(err?.message || err)
      })
  }

  function disposeRec(rec) {
    for (const ch of [...rec.meshWrap.children]) disposeObj(ch)
    rec.axes.dispose?.()
    rec.com.geometry?.dispose?.()
    rec.com.material?.dispose?.()
    rec.material.dispose?.()
  }

  function disposeObj(obj) {
    obj.traverse?.((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.()
      }
    })
  }

  // ---------- 高亮 ----------
  function applyHighlight(st) {
    const sel = selRef.current
    const opt = optRef.current
    for (const [id, rec] of st.linkObjs.entries()) {
      const isSel = sel?.type === 'link' && sel.id === id
      rec.material.emissive.setHex(isSel ? 0x1f5fbf : 0x000000)
      rec.material.emissiveIntensity = isSel ? 0.9 : 0
      rec.axes.visible = !!(opt.showAxes && rec.meshWrap.children.length)
      rec.com.visible = !!(opt.showCom && rec.link?.mesh?.dataBase64)
    }
    // 选中框
    if (st.selBox) {
      st.scene.remove(st.selBox)
      st.selBox.geometry?.dispose?.()
      st.selBox.material?.dispose?.()
      st.selBox = null
    }
    if (sel?.type === 'link') {
      const rec = st.linkObjs.get(sel.id)
      if (rec && rec.meshWrap.children.length) {
        const box = new THREE.Box3().setFromObject(rec.meshWrap)
        if (!box.isEmpty()) {
          const helper = new THREE.Box3Helper(box, 0xffb02e)
          helper.material.transparent = true
          helper.material.opacity = 0.9
          st.scene.add(helper)
          st.selBox = helper
        }
      }
    }
    for (const [jid, arrow] of st.jointArrows.entries()) {
      const on = sel?.type === 'joint' && sel.id === jid
      arrow.visible = !!opt.showJointAxes
      arrow.setColor(new THREE.Color(on ? 0xffb02e : 0x53e0c0))
    }
  }

  // ---------- 变换 ----------
  function applyTransforms(st) {
    const project = projectRef.current
    const jv = jvRef.current || {}
    if (!project) return
    const rootId = resolveRootId(project)
    const world = new Map()
    if (rootId) {
      const queue = [{ id: rootId, m: new THREE.Matrix4() }]
      const visited = new Set()
      while (queue.length) {
        const { id, m } = queue.shift()
        if (visited.has(id)) continue
        visited.add(id)
        world.set(id, m)
        for (const j of project.joints) {
          if (j.parentId !== id || visited.has(j.childId)) continue
          const childM = m.clone().multiply(originMatrix(j)).multiply(motionMatrix(j, jv[j.id] ?? 0))
          queue.push({ id: j.childId, m: childM })
        }
      }
    }
    for (const [id, rec] of st.linkObjs.entries()) {
      const m = world.get(id) || new THREE.Matrix4()
      rec.group.matrix.copy(m)
      rec.group.matrixWorldNeedsUpdate = true
    }
    // 关节轴位置
    for (const j of project.joints) {
      const arrow = st.jointArrows.get(j.id)
      if (!arrow) continue
      const pm = world.get(j.parentId)
      if (!pm) {
        arrow.visible = false
        continue
      }
      const fm = pm.clone().multiply(originMatrix(j))
      arrow.position.setFromMatrixPosition(fm)
      const axis = new THREE.Vector3(j.axis?.x || 0, j.axis?.y || 0, j.axis?.z || 0)
      if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1)
      axis.normalize().transformDirection(fm)
      const len = 0.055
      arrow.setDirection(axis)
      arrow.setLength(len, len * 0.28, len * 0.16)
      arrow.visible = !!optRef.current.showJointAxes
    }
  }

  function fitView(st) {
    const box = new THREE.Box3()
    let has = false
    for (const rec of st.linkObjs.values()) {
      if (!rec.meshWrap.children.length) continue
      const b = new THREE.Box3().setFromObject(rec.meshWrap)
      if (b.isEmpty()) continue
      box.union(b)
      has = true
    }
    if (!has) box.set(new THREE.Vector3(-0.08, -0.08, -0.08), new THREE.Vector3(0.08, 0.08, 0.08))
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    const radius = Math.max(sphere.radius, 0.02)
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(st.camera.fov / 2))) * 1.45
    const dir = new THREE.Vector3(0.85, -1.05, 0.72).normalize()
    st.controls.target.copy(sphere.center)
    st.camera.position.copy(sphere.center).add(dir.multiplyScalar(dist))
    st.camera.near = Math.max(dist / 5000, 1e-4)
    st.camera.far = dist * 30
    st.camera.updateProjectionMatrix()
    st.controls.update()
    st.needsFit = false
  }

  // 首次有网格加载后自动适配视图（每个 link 只自动一次）
  const autoFitRef = useRef(false)
  useEffect(() => {
    const timer = setInterval(() => {
      const st = S.current
      if (!st || !st.needsFit || autoFitRef.current) return
      const anyMesh = [...st.linkObjs.values()].some((r) => r.meshWrap.children.length)
      if (anyMesh) {
        fitView(st)
        autoFitRef.current = true
        clearInterval(timer)
      }
    }, 300)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="viewport" ref={hostRef}>
      <div className="viewport-legend">
        <span><i className="dot dot-com" />质心</span>
        <span><i className="dot dot-axis" />关节轴</span>
        <span className="muted">左键旋转 · 滚轮缩放 · 右键平移</span>
      </div>
      <div className="viewport-actions">
        <button
          className="ghost"
          onClick={() => S.current && fitView(S.current)}
          title="适应视图"
        >
          适应视图
        </button>
      </div>
    </div>
  )
}
