/**
 * 本地收集服务器 - 接收油猴脚本发来的笔记数据
 * node scripts/collect-server.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, 'notes-output.json');
const PORT = 3001;

// 加载已有数据
let notes = [];
if (fs.existsSync(OUTPUT_FILE)) {
  try { notes = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8')); } catch {}
}
console.log(`已有 ${notes.length} 篇笔记\n`);

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // GET /status - 查看状态
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ count: notes.length, urls: notes.map(n => n.url) }));
    return;
  }

  // POST /save - 保存笔记
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        // 去重
        const exists = notes.find(n => n.url === data.url);
        if (exists) {
          // 更新
          Object.assign(exists, data);
          console.log(`[更新] ${data.title || data.url}`);
        } else {
          data.index = notes.length + 1;
          notes.push(data);
          console.log(`[新增 #${data.index}] ${data.title || data.url}`);
        }
        console.log(`  内容: ${(data.content || '').length}字, 图片: ${(data.images || []).length}张`);

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(notes, null, 2), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: notes.length }));
      } catch (e) {
        console.error('解析失败:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`收集服务器运行在 http://localhost:${PORT}`);
  console.log(`状态查看: http://localhost:${PORT}/status`);
  console.log(`\n现在去浏览器打开小红书笔记，点击页面上的"📥保存笔记"按钮即可\n`);
});
