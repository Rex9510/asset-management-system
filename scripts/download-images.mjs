/**
 * 下载所有笔记的图片到本地
 * 通过CDP连接Chrome，利用浏览器的cookie/session直接fetch图片
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTES_FILE = path.join(__dirname, 'notes-output.json');
const IMG_DIR = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

async function main() {
  const notes = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
  console.log(`共 ${notes.length} 篇笔记\n`);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
      protocolTimeout: 180000,
    });
    console.log('✓ 已连接Chrome');
  } catch (e) {
    console.error('连接失败:', e.message);
    process.exit(1);
  }

  // 用一个标签页来下载图片
  const page = await browser.newPage();
  let totalDownloaded = 0;

  for (const note of notes) {
    if (!note.images || note.images.length === 0) continue;
    const idx = String(note.index || 0).padStart(2, '0');
    const safeTitle = (note.title || 'untitled').replace(/[\\/:*?"<>|]/g, '_').substring(0, 30);
    const noteDir = path.join(IMG_DIR, `${idx}_${safeTitle}`);
    
    // 检查是否已下载
    if (fs.existsSync(noteDir)) {
      const existing = fs.readdirSync(noteDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'));
      if (existing.length >= note.images.length) {
        console.log(`⏭️  #${idx} ${note.title} (已有${existing.length}张)`);
        continue;
      }
    }
    if (!fs.existsSync(noteDir)) fs.mkdirSync(noteDir, { recursive: true });

    console.log(`📥 #${idx} ${note.title} (${note.images.length}张)`);
    let downloaded = 0;

    for (let i = 0; i < note.images.length; i++) {
      const imgUrl = note.images[i];
      const ext = imgUrl.includes('.webp') ? 'webp' : imgUrl.includes('.jpg') ? 'jpg' : 'png';
      const filename = `${i + 1}.${ext}`;
      const filepath = path.join(noteDir, filename);
      
      if (fs.existsSync(filepath) && fs.statSync(filepath).size > 1000) {
        downloaded++;
        continue;
      }

      try {
        // 用浏览器fetch图片（带cookie），转为base64
        const base64 = await page.evaluate(async (url) => {
          const resp = await fetch(url);
          if (!resp.ok) return null;
          const blob = await resp.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(blob);
          });
        }, imgUrl);

        if (base64) {
          fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
          downloaded++;
        }
      } catch (err) {
        // 静默跳过
      }
    }
    totalDownloaded += downloaded;
    console.log(`  ✅ ${downloaded}/${note.images.length} 张`);
  }

  console.log(`\n完成! 共下载 ${totalDownloaded} 张图片`);
  await page.close();
  browser.disconnect();
}

main().catch(err => { console.error('出错:', err); process.exit(1); });
