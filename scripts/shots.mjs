/**
 * 视觉检查辅助脚本：分区高倍截图，便于逐块审查排版。
 * 用法：先 npm run dev，然后 node scripts/shots.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findBrowser } from './lib/browser.mjs'

const BROWSER = findBrowser()
const PORT = 9350
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'))
const proc = spawn(
  BROWSER,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--window-size=1680,980',
    'about:blank'
  ],
  { stdio: 'ignore' }
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    targets = await r.json()
    if (targets.length) break
  } catch {
    /* 等待浏览器 */
  }
  await sleep(200)
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m)
    pend.delete(m.id)
  }
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise((r) => pend.set(i, r))
}
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 980, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: process.env.E2E_URL || 'http://localhost:5173/' })
await sleep(1800)
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description
}
await ev(`localStorage.clear()`)
await send('Page.reload')
await sleep(1600)
const shotEl = async (sel, name) => {
  const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('${sel}').getBoundingClientRect())`))
  const clip = {
    x: Math.round(Math.max(r.x, 0)),
    y: Math.round(Math.max(r.y, 0)),
    width: Math.round(r.width),
    height: Math.round(Math.min(r.height, 980 - Math.max(r.y, 0))),
    scale: 2
  }
  const s = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })
  if (!s.result?.data) {
    console.log('capture failed', name, JSON.stringify(s).slice(0, 200))
    return
  }
  fs.writeFileSync(`shots/${name}`, Buffer.from(s.result.data, 'base64'))
  console.log('saved', name, clip.width, clip.height)
}

await shotEl('.app', 'p-empty.png')

await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('载入示例')); b && b.click(); return 1 })()`)
await sleep(2800)

await shotEl('.col-left', 'p-left.png')
await shotEl('.col-right', 'p-right.png')
await shotEl('.drawer', 'p-drawer.png')
await shotEl('.topbar', 'p-top.png')

// 弹窗
await ev(`(() => { document.querySelector('.part-item .icon-btn[title="导入质量属性"]').click(); return 1 })()`)
await sleep(700)
await shotEl('.modal', 'p-modal-mass.png')
await ev(`(() => { const b = [...document.querySelectorAll('.modal footer button')].find(x => x.textContent.includes('取消')); b && b.click(); return 1 })()`)
await sleep(500)

await ev(`(() => { const b = [...document.querySelectorAll('.topbar button')].find(x => x.textContent.includes('导出 URDF')); b && b.click(); return 1 })()`)
await sleep(700)
await shotEl('.modal', 'p-modal-export.png')
await ev(`(() => { const b = [...document.querySelectorAll('.modal footer button')].find(x => x.textContent.includes('取消')); b && b.click(); return 1 })()`)
await sleep(400)

await ev(`(() => { const b = [...document.querySelectorAll('.panel-tree .panel-head button')].find(x => x.textContent.includes('建关节')); b && b.click(); return 1 })()`)
await sleep(700)
await shotEl('.modal', 'p-modal-joint.png')

proc.kill()
process.exit(0)
