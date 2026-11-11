/**
 * 单位与数值处理
 * 内部统一存储：米(m)、千克(kg)、千克·平方米(kg·m^2)、弧度(rad)
 * 只在「输入/解析/展示」时做换算，导出永远用 SI。
 */

export const MASS_UNITS = {
  kg: { key: 'kg', factor: 1, label: 'kg' },
  g: { key: 'g', factor: 1e-3, label: 'g' },
  mg: { key: 'mg', factor: 1e-6, label: 'mg' },
  t: { key: 't', factor: 1000, label: 't' },
  lb: { key: 'lb', factor: 0.45359237, label: 'lb' },
  oz: { key: 'oz', factor: 0.028349523125, label: 'oz' }
}

export const LENGTH_UNITS = {
  m: { key: 'm', factor: 1, label: 'm' },
  mm: { key: 'mm', factor: 1e-3, label: 'mm' },
  cm: { key: 'cm', factor: 1e-2, label: 'cm' },
  um: { key: 'um', factor: 1e-6, label: 'um' },
  in: { key: 'in', factor: 0.0254, label: 'in' },
  ft: { key: 'ft', factor: 0.3048, label: 'ft' }
}

/** 惯量单位：质量 × 长度^2 */
export function inertiaFactor(massKey, lengthKey) {
  const m = MASS_UNITS[massKey]?.factor ?? 1
  const l = LENGTH_UNITS[lengthKey]?.factor ?? 1
  return m * l * l
}

export const INERTIA_PRESETS = [
  { key: 'kgm2', label: 'kg·m²', factor: 1 },
  { key: 'kgmm2', label: 'kg·mm²', factor: 1e-6 },
  { key: 'gmm2', label: 'g·mm²', factor: 1e-9 },
  { key: 'gcm2', label: 'g·cm²', factor: 1e-7 }
]

const MASS_TOKENS = [
  { re: /(kilograms?|kgs?|千克|公斤)/i, key: 'kg' },
  { re: /(milligrams?|毫克)/i, key: 'mg' },
  { re: /(grams?|克|gm)\b/i, key: 'g' },
  { re: /(pounds?|lbs?|磅)/i, key: 'lb' },
  { re: /(ounces?|oz|盎司)/i, key: 'oz' },
  { re: /(tonnes?|tons?|吨)/i, key: 't' }
]

// 长的写在前面，保证 "mm" 不会被 "m" 抢先匹配
const LENGTH_RE =
  /(millimet(?:er|re)s?|micromet(?:er|re)s?|centimet(?:er|re)s?|kilomet(?:er|re)s?|met(?:er|re)s?|inches|inch|feet|foot|毫米|微米|厘米|公里|千米|米|kmm|\bmm\b|\bcm\b|\bkm\b|\bum\b|\bin\b|\bft\b|\bm\b)/i

/** 从一段文本里找质量单位，返回 {key, factor, raw} 或 null */
export function findMassUnit(text) {
  const s = String(text || '')
  for (const t of MASS_TOKENS) {
    const m = s.match(t.re)
    if (m) return { key: t.key, factor: MASS_UNITS[t.key].factor, raw: m[1] }
  }
  return null
}

function normalizeLengthToken(tok) {
  const t = String(tok).toLowerCase()
  if (/milli|毫米|^mm$/.test(t)) return 'mm'
  if (/micro|微米|^um$/.test(t)) return 'um'
  if (/centi|厘米|^cm$/.test(t)) return 'cm'
  if (/kilo|公里|千米|^km$/.test(t)) return 'km'
  if (/inch|inches|^in$/.test(t)) return 'in'
  if (/feet|foot|^ft$/.test(t)) return 'ft'
  if (/met|^m$|米/.test(t)) return 'm'
  return null
}

/** 从一段文本里找长度单位，返回 {key, factor, raw} 或 null */
export function findLengthUnit(text) {
  const s = String(text || '')
  const m = s.match(LENGTH_RE)
  if (!m) return null
  const key = normalizeLengthToken(m[1])
  if (!key || !LENGTH_UNITS[key]) return null
  return { key, factor: LENGTH_UNITS[key].factor, raw: m[1] }
}

/** 数值解析：兼容 1,234.56 / 1.234,56 / 1 234,56 / 科学计数 */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (input == null) return null
  let s = String(input).trim()
  if (!s) return null
  s = s.replace(/[\s\u00a0]/g, '')
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // 最后出现的那个是小数点
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.')
    } else {
      s = s.replace(/,/g, '')
    }
  } else if (hasComma) {
    const parts = s.split(',')
    if (parts.length > 2 || /^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, '')
    } else {
      s = s.replace(',', '.')
    }
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

/** 取字符串里第一个数字 */
export function firstNumber(text) {
  const m = String(text || '').match(/[-+]?(?:\d[\d.,\s]*\d|\d)(?:[eE][-+]?\d+)?|[-+]?\d/)
  if (!m) return null
  return parseNumber(m[0])
}

/** 数值输出：去掉多余 0，不用科学计数法 */
export function fmt(v, maxDec = 9) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) < 1e-12) return '0'
  let s = n.toFixed(maxDec)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** 展示用：有效数字压缩 */
export function fmtShort(v, sig = 6) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs < 1e-4 || abs >= 1e6) return n.toExponential(Math.max(0, sig - 1)).replace('e', 'e')
  const s = Number(n.toPrecision(sig)).toString()
  return s
}

export const deg2rad = (d) => (Number(d) || 0) * (Math.PI / 180)
export const rad2deg = (r) => (Number(r) || 0) * (180 / Math.PI)

/** 显示单位换算：SI -> 指定单位 */
export function fromSI(value, factor) {
  return (Number(value) || 0) / factor
}
/** 指定单位 -> SI */
export function toSI(value, factor) {
  return (Number(value) || 0) * factor
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
