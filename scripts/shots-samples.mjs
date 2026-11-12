/**
 * 界面截图（视觉走查用）：打开示例库 -> 逐个载入示例
 * 用法： node scripts/shots-samples.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9361
const W = 1680
const H = 980
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'))
const proc = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-proxy-server',
    '--proxy-bypass-list=*',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    `--window-size=${W},${H}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const debug = process.env.LIST

let targets
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    targets = await r.json()
    if (targets.length) break
  } catch {}
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(1800)

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description
}

await ev(`localStorage.clear(); location.reload()`)
await sleep(2000)

const shot = async (sel, name, pad = { l: 0, t: 0, r: 0, b: 0 }, scale = 2) => {
  if (sel === '.app') {
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1.5, mobile: false })
    await sleep(500)
    const s = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(`shots/${name}`, Buffer.from(s.result.data, 'base64'))
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
    await sleep(300)
    console.log('saved', name)
    return
  }
  const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('${sel}').getBoundingClientRect())`))
  const clip = {
    x: Math.max(r.x - pad.l, 0),
    y: Math.max(r.y - pad.t, 0),
    width: Math.round(r.width + pad.l + pad.r),
    height: Math.round(r.height + pad.t + pad.b),
    scale
  }
  const s = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true })
  fs.writeFileSync(`shots/${name}`, Buffer.from(s.result.data, 'base64'))
  console.log('saved', name)
}

// 打开示例库
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('载入示例')); b.click(); return 1 })()`)
await sleep(900)
await shot('.modal', 's-gallery.png', { l: 0, t: 0, r: 0, b: 0 }, 2)

const load = async (file) => {
  await ev(`(() => { const c = document.querySelector('.sample-card[data-file="${file}"]'); c.click(); return 1 })()`)
  await sleep(3200)
}

// 收起底部抽屉，让 3D 占满
const collapseDrawer = async () => {
  await ev(`(() => { const b = document.querySelector('.drawer-tabs button.icon-btn'); if (b) b.click(); return 1 })()`)
  await sleep(700)
}

// 三指灵巧手
await load('three_finger.project.json')
await collapseDrawer()
console.log('3f links', await ev(`document.querySelectorAll('.part-item').length`))
await shot('.app', 's-three-finger.png', {}, 1.5)

// Barrett
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('载入示例')); b.click(); return 1 })()`)
await sleep(800)
await load('barrett_bh8.project.json')
await collapseDrawer()
console.log('bar links', await ev(`document.querySelectorAll('.part-item').length`))
console.log('status', await ev(`document.querySelector('.status-pill')?.textContent`))
await shot('.app', 's-barrett.png', {}, 1.5)

if (debug) console.log(JSON.stringify(await ev(`({ title: document.title, n: document.querySelectorAll('.part-item').length })`)))

proc.kill()
process.exit(0)
