/**
 * SolidWorks 质量属性文本解析
 * 支持：TXT/CSV 导出、质量属性窗口复制的纯文本、PDF 里复制出来的文本（含表格错行）
 * 输出统一换算为 SI（kg, m, kg·m^2）
 */
import {
  MASS_UNITS,
  LENGTH_UNITS,
  inertiaFactor,
  findMassUnit,
  findLengthUnit,
  parseNumber
} from './units.js'

export function normalizeText(input) {
  return String(input || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2000-\u200a\u3000]/g, ' ')
    .replace(/：/g, ':')
    .replace(/＝/g, '=')
    .replace(/，/g, ',')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[−–—]/g, '-')
    .replace(/[×·∙⋅]/g, '*')
    .replace(/[”"]/g, '')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
}

// 注意排除标题行 "Mass properties of ..."（否则会把零件名里的数字当成质量）
const RE_MASS_LINE = /^\s*(?:mass(?!\s*propert)|质量|总质量)/i
const RE_COM_HEADER = /(center of mass|centre of mass|center of gravity|centre of gravity|重心|质心|质量中心|質心)/i
const RE_INERTIA_HEADER = /(moments? of inertia|inertia tensor|惯性力矩|惯性矩|惯性张量|慣性力矩|慣性張量)/i
const RE_PRINCIPAL = /(principal (axes|moments)|惯性主轴|主惯性|慣性主軸)/i

const NUM = '[-+]?(?:\\d[\\d.,\\s]*\\d|\\d)(?:[eE][-+]?\\d+)?'

function linesOf(text) {
  return normalizeText(text).split('\n').map((l) => l.trim())
}

function matchAxis(segment, axis) {
  const re = new RegExp(`(?<![a-z0-9])${axis}\\s*(?:[:=,]|\\s)\\s*(${NUM})`, 'i')
  const m = segment.match(re)
  if (!m) return null
  return parseNumber(m[1])
}

/** 从一段文本解析 X/Y/Z 三轴数值 */
export function parseXYZ(segment) {
  const x = matchAxis(segment, 'x')
  const y = matchAxis(segment, 'y')
  const z = matchAxis(segment, 'z')
  if (x == null || y == null || z == null) return null
  return { x, y, z }
}

/** 解析质量值 + 单位（返回原始数值与原始单位） */
function parseMassBlock(text) {
  const lines = linesOf(text)
  const idx = lines.findIndex((l) => RE_MASS_LINE.test(l))
  const candidates = []
  if (idx >= 0) {
    // 先试单独一行，再试与下一行合并（PDF 复制常把两行挤在一起）
    candidates.push(lines[idx])
    candidates.push(lines.slice(idx, idx + 2).join(' '))
  }
  const inline = normalizeText(text).match(/(?<![a-z])mass\s*[:=]\s*([-+]?[\d.,]+(?:[eE][-+]?\d+)?)\s*([a-zA-Z\u4e00-\u9fa5/*^0-9]*)/i)
  if (inline) candidates.push(inline[0])

  for (const cand of candidates) {
    // 去掉开头的关键字，避免把 "Mass properties of Part 1" 里的数字当质量
    const body = cand.replace(/^\s*(mass properties?|mass|质量)\s*[:=,]?/i, ' ')
    const numMatch = body.match(new RegExp(NUM))
    if (!numMatch) continue
    const value = parseNumber(numMatch[0])
    if (value == null) continue
    const rest = body.slice((numMatch.index ?? 0) + numMatch[0].length)
    let unit = findMassUnit(rest)
    if (!unit) unit = findMassUnit(body)
    return { value, unit, rawLine: cand.trim() }
  }
  return null
}

/** 解析质心块 */
function parseComBlock(text) {
  const norm = normalizeText(text)
  const m = RE_COM_HEADER.exec(norm)
  if (!m) return null
  const start = m.index
  const after = norm.slice(start).split('\n')
  // 表头 + 后面最多 6 行（PDF 复制可能把 XYZ 挤在一行）
  const segment = after.slice(0, 7).join(' ')
  const xyz = parseXYZ(segment)
  if (!xyz) return null
  let unit = findLengthUnit(segment)
  if (!unit) {
    // 有的导出把单位写在下一行 "( millimeters )"
    unit = null
  }
  return { xyz, unit, segment, headerLine: after[0] }
}

const INERTIA_LABEL_MAP = {
  lxx: 'ixx', lxy: 'ixy', lxz: 'ixz', lzx: 'ixz',
  lyy: 'iyy', lyz: 'iyz', lzy: 'iyz',
  lzz: 'izz',
  ixx: 'ixx', ixy: 'ixy', ixz: 'ixz', izx: 'ixz',
  iyy: 'iyy', iyz: 'iyz', izy: 'iyz',
  izz: 'izz'
}

/** 解析所有「惯性力矩」块，返回 [{frame, values, unitText, block}] */
export function parseInertiaBlocks(text) {
  const norm = normalizeText(text)
  const blocks = []
  const re = new RegExp(RE_INERTIA_HEADER.source, 'gi')
  let m
  while ((m = re.exec(norm)) !== null) {
    const headerEnd = norm.indexOf('\n', m.index)
    const blockStart = headerEnd < 0 ? m.index : headerEnd
    // 块结束：遇到下一个已知小节标题
    const tail = norm.slice(blockStart)
    const cut = tail.slice(1).search(/(?:^|\n)\s*(moments? of inertia|principal|mass properties|density|volume|surface|center of mass|重心|质心|惯性|质量|密度|体积|表面积)/i)
    const block = cut > 0 ? tail.slice(0, cut + 1) : tail.slice(0, 900)
    const frame = /(output coordinate system|输出坐标系|輸出座標系)/i.test(block)
      ? 'output'
      : /(center of mass|centre of mass|重心|质心|質心)/i.test(block)
        ? 'com'
        : 'unknown'
    const values = {}
    const valRe = /(?<![a-z])([li][xyz][xyz])\s*[:=]\s*([-+]?[\d.,]+(?:[eE][-+]?\d+)?)/gi
    let vm
    while ((vm = valRe.exec(block)) !== null) {
      const key = INERTIA_LABEL_MAP[vm[1].toLowerCase()]
      if (key) values[key] = parseNumber(vm[2])
    }
    // 主惯性矩兜底
    const principal = {}
    const pRe = /(?<![a-z])(p[xyz])\s*[:=]\s*([-+]?[\d.,]+(?:[eE][-+]?\d+)?)/gi
    let pm
    while ((pm = pRe.exec(block)) !== null) principal[pm[1].toLowerCase()] = parseNumber(pm[2])

    const unitText = (block.match(/\(([^)]*\*[^)]*|[^)]*(?:mm|cm|m|克|千克|gram)[^)]*)\)/i) || [])[1] ||
      (norm.slice(m.index, blockStart + 2).match(/\(([^)]*)\)/) || [])[1] || ''
    blocks.push({ frame, values, principal, unitText, block, header: norm.slice(m.index, blockStart + 1) })
  }

  // 兜底：CSV / 表格形式没有「Moments of inertia」标题，直接按 Lxx/Lxy… 逐行出现
  if (!blocks.length) {
    const values = {}
    const valRe = /(?<![a-z])([li][xyz][xyz])\s*[:=,]\s*([-+]?[\d.,]+(?:[eE][-+]?\d+)?)/gi
    let vm
    while ((vm = valRe.exec(norm)) !== null) {
      const key = INERTIA_LABEL_MAP[vm[1].toLowerCase()]
      if (key && values[key] == null) values[key] = parseNumber(vm[2])
    }
    if (Object.keys(values).length >= 3) {
      const frame = /(output coordinate system|输出坐标系|輸出座標系)/i.test(norm) ? 'output' : 'com'
      blocks.push({ frame, values, principal: {}, unitText: norm, block: norm, header: '', inferred: true })
    }
  }
  return blocks
}

function inertiaUnitFromText(text, fallbackMass, fallbackLen) {
  const mu = findMassUnit(text)
  const lu = findLengthUnit(text)
  if (mu && lu) {
    return {
      massKey: mu.key,
      lengthKey: lu.key,
      factor: inertiaFactor(mu.key, lu.key),
      raw: `${mu.raw} * ${lu.raw}^2`,
      assumed: false
    }
  }
  if (fallbackMass && fallbackLen) {
    return {
      massKey: fallbackMass,
      lengthKey: fallbackLen,
      factor: inertiaFactor(fallbackMass, fallbackLen),
      raw: `${fallbackMass}*${fallbackLen}^2`,
      assumed: true
    }
  }
  return null
}

function detectCoordSystem(text) {
  const m = normalizeText(text).match(/(?:coordinate system|坐标系)\s*[:=]\s*([^\n]+)/i)
  return m ? m[1].trim() : ''
}

function detectPartName(text) {
  const lines = linesOf(text).filter(Boolean)
  const first = lines[0] || ''
  const en = first.match(/mass properties of\s+(.+)$/i)
  if (en) return en[1].trim()
  const cn = first.match(/^(.+?)\s*的(?:质量|物理)属性/)
  if (cn) return cn[1].trim()
  return ''
}

/**
 * 主入口
 * @returns {{
 *   ok:boolean, mass:number|null, com:{x,y,z}|null, inertia:object|null,
 *   inertiaFrame:'com'|'output',
 *   meta:object, missing:string[], warnings:string[], notes:string[], raw:string
 * }}
 */
export function parseMassProperties(text) {
  const raw = String(text || '')
  const result = {
    ok: false,
    mass: null,
    com: null,
    inertia: null,
    inertiaFrame: 'com',
    meta: {
      partName: '',
      coordSystem: '',
      massUnit: null,
      lengthUnit: null,
      inertiaUnit: null,
      massRaw: '',
      comRaw: '',
      inertiaRaw: ''
    },
    missing: [],
    warnings: [],
    notes: [],
    raw
  }
  if (!raw.trim()) {
    result.missing = ['mass', 'com', 'inertia']
    result.warnings.push('文本为空')
    return result
  }
  const norm = normalizeText(raw)

  if (!/[\u4e00-\u9fa5]|mass|mass properties/i.test(norm)) {
    result.warnings.push('未发现质量属性相关关键字（Mass / 质量）')
  }

  result.meta.partName = detectPartName(norm)
  result.meta.coordSystem = detectCoordSystem(norm)
  if (result.meta.coordSystem) {
    result.notes.push(
      `质量属性相对 SolidWorks 坐标系「${result.meta.coordSystem}」；请确认它与本 link 的坐标系一致，否则质心/惯量需要换算`
    )
  }

  // ---- 质量 ----
  const massBlock = parseMassBlock(norm)
  if (massBlock && massBlock.value != null) {
    const unit = massBlock.unit
    if (unit) {
      result.mass = massBlock.value * unit.factor
      result.meta.massUnit = { key: unit.key, raw: unit.raw, factor: unit.factor }
      result.meta.massRaw = `${massBlock.value} ${unit.raw}`
    } else {
      // 未识别单位：按克处理（SW 默认），并明确告警
      result.mass = massBlock.value * MASS_UNITS.g.factor
      result.meta.massUnit = { key: 'g', raw: '(假定)', factor: 1e-3, assumed: true }
      result.meta.massRaw = `${massBlock.value} (原始单位未识别)`
      result.warnings.push('质量单位未识别，已按 g 换算，请确认')
    }
  } else {
    result.missing.push('mass')
  }

  // ---- 质心 ----
  const comBlock = parseComBlock(norm)
  if (comBlock) {
    const unit = comBlock.unit
    if (unit) {
      result.com = {
        x: comBlock.xyz.x * unit.factor,
        y: comBlock.xyz.y * unit.factor,
        z: comBlock.xyz.z * unit.factor
      }
      result.meta.lengthUnit = { key: unit.key, raw: unit.raw, factor: unit.factor }
    } else {
      result.com = {
        x: comBlock.xyz.x * LENGTH_UNITS.mm.factor,
        y: comBlock.xyz.y * LENGTH_UNITS.mm.factor,
        z: comBlock.xyz.z * LENGTH_UNITS.mm.factor
      }
      result.meta.lengthUnit = { key: 'mm', raw: '(假定)', factor: 1e-3, assumed: true }
      result.warnings.push('质心/长度单位未识别，已按 mm 换算，请确认')
    }
    result.meta.comRaw = `X=${comBlock.xyz.x} Y=${comBlock.xyz.y} Z=${comBlock.xyz.z} ${unit ? unit.raw : '?'}`
  } else {
    result.missing.push('com')
  }

  // ---- 惯量 ----
  const blocks = parseInertiaBlocks(norm)
  const comBlockI = blocks.find((b) => b.frame === 'com' && Object.keys(b.values).length >= 3)
  const outBlockI = blocks.find((b) => b.frame === 'output' && Object.keys(b.values).length >= 3)
  const anyBlock = blocks.find((b) => Object.keys(b.values).length >= 3)
  let chosen = comBlockI || outBlockI || anyBlock || null

  if (chosen) {
    const v = { ...chosen.values }
    if (v.ixx == null || v.iyy == null || v.izz == null) chosen = null
    else {
      const unitInfo = inertiaUnitFromText(chosen.unitText || chosen.header, result.meta.massUnit?.key, result.meta.lengthUnit?.key)
      const factor = unitInfo ? unitInfo.factor : inertiaFactor('g', 'mm')
      result.inertia = {
        ixx: v.ixx * factor,
        ixy: (v.ixy ?? 0) * factor,
        ixz: (v.ixz ?? 0) * factor,
        iyy: v.iyy * factor,
        iyz: (v.iyz ?? 0) * factor,
        izz: v.izz * factor
      }
      result.inertiaFrame = chosen.frame === 'output' ? 'output' : 'com'
      result.meta.inertiaUnit = {
        raw: unitInfo ? unitInfo.raw : '(假定) g*mm^2',
        factor,
        assumed: !unitInfo || unitInfo.assumed
      }
      result.meta.inertiaRaw = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz']
        .map((k) => `${k}=${v[k] ?? 0}`)
        .join(' ')
      if (v.ixy == null || v.ixz == null || v.iyz == null) {
        result.notes.push('惯性积 ixy/ixz/iyz 未给出，按 0 处理（对称件通常成立）')
      }
      if (chosen.frame === 'output') {
        result.notes.push('惯量取自「输出坐标系」，导出时会用平行轴定理换算到质心')
      }
      if (chosen.frame === 'unknown') {
        result.warnings.push('未识别惯量参考系（质心/输出坐标系），已按「质心」处理，请确认')
      }
    }
  }

  if (!result.inertia) {
    // 只有主惯性矩时兜底
    const principalBlock = blocks.find((b) => b.principal && b.principal.px != null && b.principal.py != null && b.principal.pz != null)
    if (principalBlock) {
      const unitInfo = inertiaUnitFromText(principalBlock.unitText || principalBlock.header, result.meta.massUnit?.key, result.meta.lengthUnit?.key)
      const factor = unitInfo ? unitInfo.factor : inertiaFactor('g', 'mm')
      result.inertia = {
        ixx: principalBlock.principal.px * factor,
        ixy: 0,
        ixz: 0,
        iyy: principalBlock.principal.py * factor,
        iyz: 0,
        izz: principalBlock.principal.pz * factor
      }
      result.inertiaFrame = 'com'
      result.meta.inertiaUnit = { raw: unitInfo?.raw || '(假定) g*mm^2', factor, assumed: true }
      result.warnings.push('只找到主惯性矩，已作为对角惯量使用（惯量积按 0），请核对主轴是否与坐标轴一致')
    } else {
      result.missing.push('inertia')
    }
  }

  result.ok = result.missing.length === 0
  if (!result.ok) {
    result.warnings.push(`未识别字段：${result.missing.map((k) => ({ mass: '质量', com: '质心', inertia: '惯量' }[k] || k)).join('、')}，可手填补全`)
  }
  if (result.mass != null && result.mass <= 0) {
    result.warnings.push('质量不大于 0，请检查')
  }
  return result
}

/** 供 UI 展示：解析摘要行 */
export function summarizeParse(r) {
  if (!r) return []
  const rows = []
  if (r.mass != null) rows.push({ k: '质量', v: `${r.mass.toPrecision(6)} kg`, raw: r.meta.massRaw })
  if (r.com) rows.push({ k: '质心', v: `(${r.com.x.toPrecision(4)}, ${r.com.y.toPrecision(4)}, ${r.com.z.toPrecision(4)}) m`, raw: r.meta.comRaw })
  if (r.inertia) {
    rows.push({
      k: '惯量',
      v: `ixx=${r.inertia.ixx.toPrecision(4)} iyy=${r.inertia.iyy.toPrecision(4)} izz=${r.inertia.izz.toPrecision(4)}`,
      raw: r.meta.inertiaRaw
    })
  }
  return rows
}
