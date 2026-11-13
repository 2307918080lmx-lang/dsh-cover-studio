// 独立预览用开发服务器：不依赖 DSH 宿主，只提供插件自己的 HTTP API 和工作室 UI。
// 需要先生成数据目录：默认 $DSH_HOME（或 ~/.dsh-cover-studio-dev）。
// 运行：npm run dev，然后打开 http://127.0.0.1:8790/
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

process.env.DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh-cover-studio-dev')

const { createServer } = await import('../lib/server.js')
const { Secrets } = await import('../lib/settings.js')
const { JobManager } = await import('../lib/generate.js')

const log = (...args) => console.log('[cover-studio]', ...args)
const ctx = { get: () => null }
const server = createServer({
  ctx,
  secrets: new Secrets(ctx),
  jobs: new JobManager(log),
  log,
  getOpenState: () => ({ at: 0 }),
  setOpenState: () => {},
})
const port = Number(process.env.PORT || 8790)
http.createServer((req, res) => server.route(req, res)).listen(port, '127.0.0.1', () => {
  console.log(`Cover Studio dev server: http://127.0.0.1:${port}/`)
  console.log(`Data dir: ${process.env.DSH_HOME}`)
})
