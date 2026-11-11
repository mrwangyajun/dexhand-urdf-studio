/**
 * 文件文本解码：兼容 SolidWorks 导出的 UTF-16 / GBK / UTF-8
 */
export async function fileToText(file) {
  const buf = await file.arrayBuffer()
  return decodeTextBuffer(buf)
}

export function decodeTextBuffer(buf) {
  const u8 = new Uint8Array(buf)
  if (u8.length > 1 && u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8)
  if (u8.length > 1 && u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8)
  let s = new TextDecoder('utf-8', { fatal: false }).decode(u8)
  if (s.includes('\uFFFD')) {
    try {
      s = new TextDecoder('gbk', { fatal: false }).decode(u8)
    } catch {
      /* 忽略：浏览器不支持 gbk 时保留 utf-8 结果 */
    }
  }
  return s
}

export function isPdf(file) {
  return /\.pdf$/i.test(file?.name || '') || file?.type === 'application/pdf'
}
