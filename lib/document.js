import zlib from 'node:zlib'
import path from 'node:path'

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.yaml', '.yml', '.html', '.htm'])

function cleanText(value, max = 20000) {
  const s = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
  return s.length > max ? s.slice(0, max) + '\n\n（文档内容过长，已截断）' : s
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

function parseZipEntries(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('DOCX 不是有效的 zip')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    entries.set(name, { method, compressedSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readZipEntry(buf, entry) {
  const p = entry.localOffset
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) throw new Error('DOCX zip 条目损坏')
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const dataStart = p + 30 + nameLen + extraLen
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: 24 * 1024 * 1024 })
  throw new Error('DOCX 使用了不支持的压缩方式')
}

function extractDocx(buffer) {
  const entries = parseZipEntries(buffer)
  const target = entries.get('word/document.xml')
  if (!target) throw new Error('DOCX 里没有 word/document.xml')
  const xml = readZipEntry(buffer, target).toString('utf8')
  const text = xml
    .replace(/<w:tab\b[^>]*\/>/gi, '\t')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<\/w:tc>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text)
}

function decodePdfString(raw) {
  return String(raw || '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
}

function extractPdf(buffer) {
  const raw = buffer.toString('latin1')
  const chunks = []
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let m
  while ((m = streamRe.exec(raw))) {
    const before = raw.slice(Math.max(0, m.index - 500), m.index)
    let data = Buffer.from(m[1], 'latin1')
    if (/\/FlateDecode/.test(before)) {
      try { data = zlib.inflateSync(data, { maxOutputLength: 12 * 1024 * 1024 }) } catch { try { data = zlib.inflateRawSync(data, { maxOutputLength: 12 * 1024 * 1024 }) } catch { continue } }
    }
    const content = data.toString('latin1')
    if (!/BT|Tj|TJ/.test(content)) continue
    const textChunks = []
    const btRe = /BT([\s\S]*?)ET/g
    let b
    while ((b = btRe.exec(content))) {
      const block = b[1]
      const tokenRe = /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[\s\S]*?)\]\s*TJ|T\*|TD|Td|'|"/g
      let t
      while ((t = tokenRe.exec(block))) {
        const token = t[0]
        if (token === 'T*' || token === 'TD' || token === 'Td' || token === "'" || token === '"') {
          textChunks.push('\n')
          continue
        }
        const strings = token.match(/\((?:\\.|[^\\()])*\)/g) || []
        if (strings.length) {
          textChunks.push(strings.map((s) => decodePdfString(s.slice(1, -1))).join(''))
        }
      }
    }
    if (textChunks.length) chunks.push(textChunks.join(''))
  }
  const text = chunks.join('\n')
  if (!text.replace(/\s/g, '')) {
    throw new Error('PDF 文本提取失败（可能是扫描件或特殊字体）。请复制正文粘贴，或另存为 DOCX/TXT 再拖入。')
  }
  return text
}

export function extractDocumentText(buffer, filename) {
  if (!buffer || buffer.length > 14 * 1024 * 1024) throw new Error('文档超过 14MB')
  const ext = path.extname(String(filename || '')).toLowerCase()
  if (TEXT_EXT.has(ext)) {
    let text = buffer.toString('utf8')
    if (ext === '.html' || ext === '.htm') {
      text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    }
    return { text: cleanText(text), kind: ext.slice(1) }
  }
  if (ext === '.docx') return { text: cleanText(extractDocx(buffer)), kind: 'docx' }
  if (ext === '.pdf') return { text: cleanText(extractPdf(buffer)), kind: 'pdf' }
  if (ext === '.doc') throw new Error('旧版 .doc 不支持直接解析，请另存为 DOCX 或复制正文')
  // 没有扩展名时按文本试一下
  const text = buffer.toString('utf8')
  if (text.replace(/\s/g, '').length > 20 && !text.includes('\u0000')) return { text: cleanText(text), kind: 'text' }
  throw new Error('不支持的文档格式，请用 TXT / MD / PDF / DOCX')
}
