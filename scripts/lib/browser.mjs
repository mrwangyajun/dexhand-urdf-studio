/**
 * 定位一个可用的 Chromium 内核浏览器（Chrome / Edge / Chromium / Headless Shell）。
 *
 * 优先级：环境变量 E2E_BROWSER > 平台常见安装路径。
 * 供 e2e / shots / shots-samples / layout-check 复用，避免各脚本各写一份路径。
 */
import fs from 'node:fs'

const CANDIDATES = {
  win32: (env) => {
    const win = env.ProgramFiles || 'C:/Program Files'
    const winX86 = env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'
    const local = env.LOCALAPPDATA || ''
    return [
      `${win}/Google/Chrome/Application/chrome.exe`,
      `${winX86}/Google/Chrome/Application/chrome.exe`,
      local && `${local}/Google/Chrome/Application/chrome.exe`,
      `${winX86}/Microsoft/Edge/Application/msedge.exe`,
      `${win}/Microsoft/Edge/Application/msedge.exe`,
      `${winX86}/Chromium/Application/chrome.exe`
    ]
  },
  darwin: () => [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: () => [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge'
  ]
}

export function findBrowser({ silent = false } = {}) {
  if (process.env.E2E_BROWSER) return process.env.E2E_BROWSER

  const list = (CANDIDATES[process.platform] || CANDIDATES.linux)(process.env)
  const found = list.filter(Boolean).find((p) => fs.existsSync(p))

  if (!found) {
    console.error(
      '找不到 Chromium 内核浏览器。请用 E2E_BROWSER 指定可执行文件，例如：\n' +
        '  E2E_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e'
    )
    if (!silent) process.exit(1)
  }
  return found
}
