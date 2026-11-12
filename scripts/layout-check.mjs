/**
 * 布局体检：在常见窗口尺寸下检查横向溢出与元素越界。
 * 用法：先 npm run dev，然后 node scripts/layout-check.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9351
const SIZES = [
  [1920, 1080],
  [1680, 980],
  [1440, 900],
  [1366, 768],
  [1280, 800]
]
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'))
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
    '--window-size=1920,1080',
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
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description
}

let bad = 0
for (const [w, h] of SIZES) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'http://localhost:5173/' })
  await sleep(1200)
  // 用「三指灵巧手」这个最挤的示例：10 个零件 + 9 个关节滑块
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('载入示例')); b && b.click(); return 1 })()`)
  await sleep(900)
  await ev(`(() => { const c = document.querySelector('.sample-card[data-file="three_finger.project.json"]'); c && c.click(); return 1 })()`)
  await sleep(2600)
  // 关节条必须能容纳全部 9 个滑块（换行后不被裁）
  const jb = await ev(`(() => {
    const el = document.querySelector('.jointbar')
    if (!el) return 'no jointbar'
    const items = [...el.querySelectorAll('.jb-item')]
    const hidden = items.filter(i => {
      const r = i.getBoundingClientRect()
      return r.right > el.getBoundingClientRect().right + 1 || r.bottom > el.getBoundingClientRect().bottom + 1
    }).length
    return { n: items.length, hidden }
  })()`)
  if (typeof jb === 'object' && jb.hidden > 0) {
    console.log(`${w}x${h}: ✗ 关节条有 ${jb.hidden}/${jb.n} 个滑块被裁`)
    bad++
  }

  const report = await ev(`(() => {
    const out = []
    const check = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return
      const ox = el.scrollWidth - el.clientWidth
      if (ox > 1) out.push(sel + ' 横向溢出 ' + ox + 'px')
    }
    ;['.main', '.col-left', '.col-center', '.col-right', '.props-scroll', '.panel-scroll', '.drawer-body', '.statusbar', '.topbar'].forEach(check)
    // 元素是否超出视口右边界
    for (const sel of ['.topbar button.primary', '.status-pill', '.viewport', '.props-head']) {
      const el = document.querySelector(sel)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.right > window.innerWidth + 1) out.push(sel + ' 超出右边界 ' + Math.round(r.right - window.innerWidth) + 'px')
      if (r.width < 1) out.push(sel + ' 宽度为 0')
    }
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth + 1) out.push('页面出现横向滚动 ' + (doc.scrollWidth - doc.clientWidth))
    const row = document.querySelector('.row')
    if (row) {
      const lbl = row.querySelector('.row-label')
      if (lbl && lbl.getBoundingClientRect().height > 40) out.push('.row-label 高度异常 ' + Math.round(lbl.getBoundingClientRect().height))
    }
    return out
  })()`)
  const list = Array.isArray(report) ? report : []
  if (list.length) bad += list.length
  console.log(`${w}x${h}: ${list.length ? '✗ ' + list.join(' | ') : '✓ 无溢出'}`)
  const s = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`shots/layout-${w}x${h}.png`, Buffer.from(s.result.data, 'base64'))
}
console.log(`\n共 ${bad} 处问题`)
proc.kill()
process.exit(bad ? 1 : 0)
