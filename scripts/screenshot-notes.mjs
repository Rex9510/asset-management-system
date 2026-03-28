/**
 * 截图所有已打开的小红书笔记页面
 * 连接Chrome CDP，遍历所有标签页，对笔记详情页全页截图
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function main() {
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
      protocolTimeout: 60000,
    });
    console.log('✓ 已连接Chrome');
  } catch (e) {
    console.error('连接失败:', e.message);
    process.exit(1);
  }

  const pages = await browser.pages();
  console.log(`共 ${pages.length} 个标签页\n`);

  // 加载已有笔记数据用于匹配标题
  let notes = [];
  const notesFile = path.join(__dirname, 'notes-output.json');
  if (fs.existsSync(notesFile)) {
    try { notes = JSON.parse(fs.readFileSync(notesFile, 'utf-8')); } catch {}
  }

  let count = 0;
  for (const page of pages) {
    const url = page.url();
    if (!url.includes('xiaohongshu.com/explore/')) continue;

    const noteId = url.split('/explore/')[1]?.split('?')[0] || 'unknown';
    const note = notes.find(n => n.url?.includes(noteId));
    const title = note?.title || noteId;
    // 文件名安全处理
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 40);
    const filename = `${String(count + 1).padStart(2, '0')}_${safeTitle}.png`;

    try {
      // 滚动到顶部
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);

      // 全页截图
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, filename),
        fullPage: true,
        type: 'png',
      });
      count++;
      console.log(`✅ [${count}] ${title} -> ${filename}`);
    } catch (err) {
      console.log(`❌ ${title}: ${err.message.substring(0, 60)}`);
    }
  }

  console.log(`\n完成! 截图 ${count} 张，保存到 ${SCREENSHOT_DIR}`);
  browser.disconnect();
}

main().catch(err => { console.error('出错:', err); process.exit(1); });
