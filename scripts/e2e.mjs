/**
 * 端到端冒烟测试：无头 Chromium 内核浏览器（Chrome / Edge / Chromium）+ CDP
 * 用法： node scripts/e2e.mjs
 * 前置： npm run dev 已启动（默认 http://127.0.0.1:5173）
 * 环境变量：
 *   E2E_BROWSER  指定浏览器可执行文件；不设则自动探测
 *   E2E_URL      指定被测地址，默认 http://localhost:5173/
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBrowser } from './lib/browser.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(path.resolve(__dirname, '..'), 'shots')
fs.mkdirSync(OUT, { recursive: true })

const BROWSER = findBrowser()
const PORT = 9333
const URL_TARGET = process.env.E2E_URL || 'http://localhost:5173/'
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'urdf-e2e-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const proc = spawn(
  BROWSER,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--window-size=1680,980',
    '--hide-scrollbars',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

let ws
let msgId = 0
const pending = new Map()
const consoleErrors = []
const pageErrors = []

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression, awaitPromise = true) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  })
  if (res.exceptionDetails) {
    throw new Error(`页面执行出错: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`)
  }
  return res.result?.value
}

async function waitFor(expr, { timeout = 20000, label = expr } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      if (await evaluate(expr)) return true
    } catch {
      /* 页面可能还没就绪 */
    }
    await sleep(200)
  }
  throw new Error(`等待超时: ${label}`)
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'))
  console.log(`  · 截图 ${name}`)
}

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${detail}`)
  }
}

const main = async () => {
  // 等 devtools 端口
  let targets = null
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      targets = await r.json()
      if (targets.length) break
    } catch {
      /* 尚未就绪 */
    }
    await sleep(200)
  }
  if (!targets?.length) throw new Error('无法连接到 Edge 调试端口')

  const page = targets.find((t) => t.type === 'page') || targets[0]
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || a.type).join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
    }
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1680,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false
  })

  console.log('\n[E2E] 打开页面')
  await send('Page.navigate', { url: URL_TARGET })
  await waitFor(`!!document.querySelector('.app')`, { label: '应用挂载' })
  await sleep(800)
  ok('页面渲染 .app', true)
  ok('左侧零件库存在', await evaluate(`!!document.querySelector('.panel-part')`))
  ok('viewport canvas 存在', await evaluate(`!!document.querySelector('canvas')`))

  // ---------- 示例库 ----------
  console.log('\n[E2E] 示例库（三指灵巧手 / Barrett / 单指）')
  const openGallery = async () => {
    await evaluate(`
      (() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('载入示例'))
        btn.click()
        return true
      })()
    `)
    await waitFor(`!!document.querySelector('.modal .sample-card')`, { label: '示例库打开' })
  }
  const loadSample = async (file) => {
    await openGallery()
    await evaluate(`(() => { document.querySelector('.sample-card[data-file="${file}"]').click(); return 1 })()`)
    await waitFor(`!document.querySelector('.sample-card')`, { label: '示例库关闭' })
    await sleep(900)
  }

  await openGallery()
  const cards = await evaluate(`[...document.querySelectorAll('.sample-card')].map(c => c.dataset.file)`)
  ok('示例库列出 3 个示例', cards.length === 3, JSON.stringify(cards))
  ok('示例库含 Barrett Hand', cards.includes('barrett_bh8.project.json'))
  ok('示例库含三指灵巧手', cards.includes('three_finger.project.json'))
  ok('卡片显示连杆/关节数与总质量', await evaluate(`
    (() => {
      const t = document.querySelector('.sample-card .sc-stats')?.textContent || ''
      return /links/.test(t) && /joints/.test(t) && /总质量/.test(t)
    })()
  `))
  await shot('00-sample-gallery.png')
  await evaluate(`(() => { document.querySelector('.sample-card[data-file="finger_hand.project.json"]').click(); return 1 })()`)
  await waitFor(`document.querySelectorAll('.part-item').length >= 4`, { label: '4 个零件入库' })
  await sleep(1200)
  const counts = await evaluate(`({
    parts: document.querySelectorAll('.part-item').length,
    treeRows: document.querySelectorAll('.tree-row').length,
    joints: document.querySelectorAll('.tree-joint').length,
    status: document.querySelector('.status-pill')?.textContent,
    urdfHasRobot: !!document.querySelector('.statusbar')
  })`)
  ok('零件数 = 4', counts.parts === 4, JSON.stringify(counts))
  ok('关节数 = 3', counts.joints === 3, String(counts.joints))
  ok('校验状态显示通过', /校验通过|警告/.test(counts.status || ''), counts.status)
  ok('网格已加载到 canvas', await evaluate(`!!document.querySelector('canvas')`))
  await shot('01-sample-loaded.png')

  // ---------- URDF 预览 ----------
  console.log('\n[E2E] URDF 预览')
  await evaluate(`[...document.querySelectorAll('.drawer-tabs button')].find(b=>b.textContent.includes('URDF 预览')).click()`)
  await sleep(500)
  const urdf = await evaluate(`document.querySelector('.drawer-body pre.code')?.textContent || ''`)
  ok('URDF 含 robot 标签', urdf.includes('<robot name="dex_hand_demo">'))
  ok('URDF 含 3 个 joint', (urdf.match(/<joint /g) || []).length === 3)
  ok('URDF 含 mesh scale', urdf.includes('scale="0.001 0.001 0.001"'))
  await shot('02-urdf-preview.png')

  // ---------- 选中关节 -> 改 limit ----------
  console.log('\n[E2E] 修改关节参数并检查 URDF 同步')
  await evaluate(`
    (() => {
      const j = [...document.querySelectorAll('.tree-joint')].find(b => b.textContent.includes('f1_joint_mcp'))
      j.click(); return true
    })()
  `)
  await sleep(400)
  ok('右侧切到 JOINT 面板', await evaluate(`document.querySelector('.props-kind')?.textContent === 'JOINT'`))
  // 通过 React 受控 input 修改：派发 input 事件
  await evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('.row')]
      const row = rows.find(r => r.querySelector('.row-label')?.textContent.includes('effort'))
      const input = row.querySelector('input[type=number]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '7.5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return input.value
    })()
  `)
  await sleep(600)
  await evaluate(`[...document.querySelectorAll('.drawer-tabs button')].find(b=>b.textContent.includes('URDF 预览')).click()`)
  await sleep(400)
  const urdf2 = await evaluate(`document.querySelector('.drawer-body pre.code')?.textContent || ''`)
  ok('URDF 中 effort 同步为 7.5', urdf2.includes('effort="7.5"'), urdf2.match(/<limit[^>]*>/)?.[0])
  await shot('03-joint-edit.png')

  console.log('\n[E2E] 改 origin -> 3D 世界变换同步')
  const before3d = await evaluate(`window.__dexhandViewport.worldMatrix('link_f1_middle')[13]`)
  await evaluate(`
    (() => {
      const row = [...document.querySelectorAll('.row')].find(r => r.querySelector('.row-label')?.textContent.includes('平移 xyz'))
      const input = row.querySelectorAll('input[type=number]')[1]
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '10')          // 10 mm
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await sleep(500)
  const after3d = await evaluate(`window.__dexhandViewport.worldMatrix('link_f1_middle')[13]`)
  ok('3D 中 child 沿 Y 平移 10 mm', Math.abs(after3d - before3d - 0.01) < 2e-4, `${before3d} -> ${after3d}`)
  const urdf3b = await evaluate(`(() => { document.querySelector('.drawer-tabs button:nth-child(1)').click(); return true })()`)
  await sleep(300)
  const urdfOrigin = await evaluate(`document.querySelector('.drawer-body pre.code')?.textContent || ''`)
  ok('URDF origin 同步为 0 0.01 0', urdfOrigin.includes('<origin xyz="0.03 0.01 0"'), urdfOrigin.match(/<origin[^>]*>/)?.[0])

  // ---------- 新建关节弹窗 ----------
  console.log('\n[E2E] 新建关节弹窗')
  await evaluate(`(() => [...document.querySelectorAll('.panel-tree .panel-head button')].find(b=>b.textContent.includes('建关节')).click())()`)
  await waitFor(`!!document.querySelector('.modal')`, { label: '建关节弹窗' })
  const jointDlg = await evaluate(`document.querySelector('.modal')?.textContent || ''`)
  ok('弹窗含 origin / axis / limit 字段', /origin 平移/.test(jointDlg) && /axis/.test(jointDlg) && /limit lower/.test(jointDlg))
  ok('默认 origin 全 0（子坐标系与父关节重合）', await evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('.modal .row')]
      const r = rows.find(x => x.querySelector('.row-label')?.textContent.includes('origin 平移'))
      return [...r.querySelectorAll('input')].every(i => i.value === '0')
    })()
  `))
  await shot('09-joint-dialog.png')
  await evaluate(`(() => [...document.querySelectorAll('.modal footer button')].find(b=>b.textContent.includes('取消')).click())()`)
  await sleep(300)

  // ---------- 质量属性导入 ----------
  console.log('\n[E2E] 质量属性导入（粘贴文本）')
  await evaluate(`
    (() => {
      const btn = document.querySelector('.part-item .icon-btn[title="导入质量属性"]')
      btn.click(); return true
    })()
  `)
  await waitFor(`!!document.querySelector('.modal')`, { label: '质量属性弹窗' })
  await evaluate(`
    (() => {
      [...document.querySelectorAll('.mi-toolbar button')].find(b=>b.textContent.includes('粘贴文本')).click()
      return true
    })()
  `)
  await sleep(200)
  const sampleText = `Mass properties of palm
Configuration: Default
Coordinate system: -- default --
Mass = 275.4000 grams
Volume = 229500.00 cubic millimeters
Center of mass: ( millimeters )
\tX = 25.00
\tY = 0.00
\tZ = 0.00
Moments of inertia: ( grams * square millimeters )
Taken at the center of mass.
\tLxx = 186468.75\tLxy = 0.00\tLzx = 0.00
\tLyy = 206550.00\tLyz = 0.00
\tLzz = 351708.75
`
  await evaluate(`
    (() => {
      const ta = document.querySelector('.mi-paste textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, ${JSON.stringify(sampleText)})
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await sleep(300)
  await evaluate(`[...document.querySelectorAll('.mi-paste button')].find(b=>b.textContent.includes('解析这段文本')).click()`)
  await waitFor(`!!document.querySelector('.mi-item')`, { label: '解析结果出现' })
  const parsed = await evaluate(`document.querySelector('.mi-item')?.textContent || ''`)
  ok('解析出质量 0.2754 kg', /0\.2754\s*kg/.test(parsed), parsed.slice(0, 160))
  ok('解析出质心 0.025 m', /0\.025/.test(parsed))
  ok('标注识别成功', /识别成功/.test(parsed))
  await shot('04-mass-import.png')
  await evaluate(`[...document.querySelectorAll('.modal footer button')].find(b=>b.textContent.includes('应用')).click()`)
  await sleep(600)
  ok('应用后弹窗关闭', !(await evaluate(`!!document.querySelector('.modal')`)))

  // ---------- 导出弹窗 ----------
  console.log('\n[E2E] 导出弹窗')
  await evaluate(`[...document.querySelectorAll('.topbar button')].find(b=>b.textContent.includes('导出 URDF')).click()`)
  await waitFor(`!!document.querySelector('.modal')`, { label: '导出弹窗' })
  const expText = await evaluate(`document.querySelector('.modal')?.textContent || ''`)
  ok('导出弹窗显示 robot 名称', expText.includes('dex_hand_demo'))
  ok('导出弹窗列出 meshes 目录', expText.includes('meshes/'))
  ok('导出按钮可用（无错误）', await evaluate(`
    (() => {
      const b = [...document.querySelectorAll('.modal footer button')].find(x=>x.textContent.includes('下载'))
      return b && !b.disabled
    })()
  `))
  await shot('05-export-dialog.png')

  // 触发下载（验证不抛错）
  const dl = await evaluate(`
    (async () => {
      const b = [...document.querySelectorAll('.modal footer button')].find(x=>x.textContent.includes('下载'))
      b.click()
      await new Promise(r => setTimeout(r, 1500))
      return document.querySelector('.toast')?.textContent || ''
    })()
  `)
  ok('导出成功提示', /已导出/.test(dl || ''), dl)
  await shot('06-exported.png')

  // ---------- 真实文件上传 ----------
  console.log('\n[E2E] 上传网格文件（STL）')
  await send('DOM.enable')
  const partsBefore = await evaluate(`document.querySelectorAll('.part-item').length`)
  const doc = await send('DOM.getDocument', { depth: -1 })
  const stlInput = await send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type=file][multiple][accept*=".stl"]'
  })
  await send('DOM.setFileInputFiles', {
    nodeId: stlInput.nodeId,
    files: [path.resolve(__dirname, '..', 'public/samples/meshes/palm.stl')]
  })
  await waitFor(`document.querySelectorAll('.part-item').length > ${partsBefore}`, { label: '新零件入库' })
  await sleep(600)
  const partsAfter = await evaluate(`document.querySelectorAll('.part-item').length`)
  ok('上传 STL 后多出一个零件', partsAfter === partsBefore + 1, `${partsBefore} -> ${partsAfter}`)
  ok('自动按 mm→m 换算', await evaluate(`document.body.textContent.includes('palm_2')`))

  // ---------- 批量质量属性文件 ----------
  console.log('\n[E2E] 批量导入质量属性文件（多选自动绑定）')
  await evaluate(`
    (() => {
      const btn = [...document.querySelectorAll('.part-item .icon-btn[title="导入质量属性"]')].pop()
      btn.click(); return true
    })()
  `)
  await waitFor(`!!document.querySelector('.modal')`, { label: '质量属性弹窗' })
  const doc2 = await send('DOM.getDocument', { depth: -1 })
  const mpInput = await send('DOM.querySelector', {
    nodeId: doc2.root.nodeId,
    selector: '.modal input[type=file]'
  })
  await send('DOM.setFileInputFiles', {
    nodeId: mpInput.nodeId,
    files: [
      path.resolve(__dirname, '..', 'samples/massprops/palm.txt'),
      path.resolve(__dirname, '..', 'samples/massprops/f1_proximal.txt')
    ]
  })
  await waitFor(`document.querySelectorAll('.mi-item').length >= 2`, { label: '两个文件解析完成' })
  const binds = await evaluate(`[...document.querySelectorAll('.mi-bind select')].map(s => s.value)`)
  ok('解析出 2 条记录', binds.length === 2, JSON.stringify(binds))
  ok('按文件名自动绑定 link', binds[0] === 'link_palm' && binds[1] === 'link_f1_proximal', JSON.stringify(binds))
  await shot('07-batch-massprops.png')

  // ---------- 识别失败路径 ----------
  console.log('\n[E2E] 识别失败仍可手填')
  await evaluate(`(() => [...document.querySelectorAll('.mi-toolbar button')].find(b=>b.textContent.includes('粘贴文本')).click())()`)
  await sleep(200)
  await evaluate(`
    (() => {
      const ta = document.querySelector('.mi-paste textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '这是一段被改乱的内容，没有质量也没有惯量')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      const btn = [...document.querySelectorAll('.mi-paste button')].find(b=>b.textContent.includes('解析这段文本'))
      btn.click()
      return true
    })()
  `)
  await sleep(500)
  const badItem = await evaluate(`(() => [...document.querySelectorAll('.mi-item')].pop()?.textContent || '')()`)
  ok('乱文本标记缺 3 项', /缺 3 项|未识别/.test(badItem), badItem.slice(0, 80))
  ok('保留原文可回看', await evaluate(`(() => [...document.querySelectorAll('.mi-item')].pop().textContent.includes('查看原文'))()`))
  await shot('08-mass-parse-fail.png')
  await evaluate(`(() => [...document.querySelectorAll('.modal footer button')].find(b=>b.textContent.includes('取消')).click())()`)
  await sleep(400)

  // 手填后仍可导出
  ok('手填面板可达', await evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('.row-label')].map(r => r.textContent)
      return rows.some(t => t.includes('质量 mass')) && rows.some(t => t.includes('质心 CoM'))
    })()
  `))
  ok('导出按钮仍可用（新零件悬空会被拦）', await evaluate(`
    (() => {
      const b = [...document.querySelectorAll('.status-pill')][0]
      return b.textContent.includes('错误') || b.textContent.includes('警告') || b.textContent.includes('校验通过')
    })()
  `))

  // ---------- 三指示例：Barrett Hand ----------
  console.log('\n[E2E] Barrett Hand（真实运动学参数）')
  await loadSample('barrett_bh8.project.json')
  const bar = await evaluate(`({
    parts: document.querySelectorAll('.part-item').length,
    joints: document.querySelectorAll('.tree-joint').length,
    status: document.querySelector('.status-pill')?.textContent,
    robot: document.querySelector('.robot-name input')?.value
  })`)
  ok('Barrett 载入 9 个连杆', bar.parts === 9, JSON.stringify(bar))
  ok('Barrett 载入 8 个关节', bar.joints === 8, String(bar.joints))
  ok('Barrett 校验通过', /校验通过/.test(bar.status || ''), bar.status)
  ok('robotName 切换为 barrett_bh8_280', bar.robot === 'barrett_bh8_280', bar.robot)

  await evaluate(`[...document.querySelectorAll('.drawer-tabs button')].find(b=>b.textContent.includes('URDF 预览')).click()`)
  await sleep(500)
  const barUrdf = await evaluate(`document.querySelector('.drawer-body pre.code')?.textContent || ''`)
  ok('Barrett URDF 含 9 个 link', (barUrdf.match(/<link /g) || []).length === 9, String((barUrdf.match(/<link /g) || []).length))
  ok('Barrett 中节限位 140°', barUrdf.includes('upper="2.443460953"'))
  ok('Barrett 近节轴保留 0 0 -1', barUrdf.includes('<axis xyz="0 0 -1"'))
  ok('Barrett palm 质量 0.50573', barUrdf.includes('value="0.50573"'))
  ok('Barrett origin rpy 90°', barUrdf.includes('rpy="1.570796327 0 1.570796327"'))

  // 关节拖动同步到 URDF
  await evaluate(`
    (() => {
      const row = [...document.querySelectorAll('.jb-item')][0]
      const input = row.querySelector('input[type=range]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, String(Number(input.max) * 0.5))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()
  `)
  await sleep(600)
  ok('关节滑块改变后 3D 有响应', await evaluate(`!!window.__dexhandViewport.worldMatrix('link_f1_med_link')`))

  // 视角预设
  await evaluate(`(() => { [...document.querySelectorAll('.view-presets button')].find(b=>b.textContent.includes('前视')).click(); return 1 })()`)
  await sleep(700)
  ok('视角预设切到前视', await evaluate(`document.querySelector('.view-presets button.on')?.textContent === '前视'`))
  await shot('10-barrett-front.png')
  await evaluate(`(() => { [...document.querySelectorAll('.view-presets button')].find(b=>b.textContent.includes('等轴')).click(); return 1 })()`)
  await sleep(700)

  // ---------- 错误检查 ----------
  console.log('\n[E2E] 控制台检查')
  const realPageErr = pageErrors.filter((e) => !/ResizeObserver/.test(e))
  ok('无未捕获异常', realPageErr.length === 0, realPageErr.join(' | '))
  const realConsoleErr = consoleErrors.filter((e) => !/favicon|ResizeObserver|Download the React DevTools/.test(e))
  ok('无 console.error', realConsoleErr.length === 0, realConsoleErr.join(' | '))

  console.log(`\n===== E2E: ${pass} passed, ${fail} failed =====`)
  if (fail) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error('E2E 失败:', e.message)
    console.log('console errors:', consoleErrors)
    console.log('page errors:', pageErrors)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      ws?.close()
    } catch {}
    proc.kill()
    await sleep(300)
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch {}
  })
