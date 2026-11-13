// 下载本地抠图模型 Silueta（约 43MB）。模型不放进 Git 仓库，避免仓库过大。
// 用法：npm run fetch-model
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'assets', 'models', 'silueta.onnx')
const url = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx'
const expectedSize = 44173029
const expectedSha = '75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb'

if (fs.existsSync(target) && fs.statSync(target).size === expectedSize) {
  console.log('Silueta model already exists:', target)
  process.exit(0)
}
fs.mkdirSync(path.dirname(target), { recursive: true })
console.log('Downloading Silueta model (43MB) ...')
const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180000) })
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
const buffer = Buffer.from(await res.arrayBuffer())
if (buffer.length !== expectedSize) throw new Error(`Unexpected size: ${buffer.length}`)
const sha = crypto.createHash('sha256').update(buffer).digest('hex')
if (sha !== expectedSha) throw new Error(`Checksum mismatch: ${sha}`)
fs.writeFileSync(target, buffer)
console.log('Saved:', target)
console.log('Local cutout is ready. If you skip this step, the plugin still works and falls back to the built-in edge cutout.')
