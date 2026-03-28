/**
 * 监听模式：你手动打开笔记，脚本自动提取内容+截图保存
 * 
 * 用法：
 * 1. 确保Chrome以调试模式运行（端口9222）
 * 2. 运行此脚本
 * 3. 在Chrome中手动点开每篇笔记，脚本自动保存文本+截图
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, 'notes-output.json');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// 加载已有数据
let notes = [];
if (fs.existsSync(OUTPUT_FILE)) {
  try { notes = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8')); } catch {}
}
const savedUrls = new Set(notes.filter(n => (n.content || '').length > 5).map(n => n.url));
console.log(`已有 ${notes.length} 篇笔记 (${savedUrls.size} 篇有内容)\n`);

async function extractNote(page) {
  return page.evaluate(() => {
    function getText(sels) {
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          if (el) { const t = el.innerText?.trim(); if (t && t.length > 1) return t; }
        } catch {}
      }
      return '';
    }
    const title = getText(['#detail-title', '.note-text .title', '.title', 'h1']);
    const content = getText(['#detail-desc .note-text', '#detail-desc', '.note-text .desc', '.note-text', '.desc']);
    const date = getText(['.date', '[class*="date"]', 'time']);
    const images = [];
    const seen = new Set();
    const imgSels = ['.swiper-slide img', '[class*="slide"] img', '[class*="swiper"] img', 'img[src*="xhscdn"]', 'img[src*="sns-img"]'];
    for (const s of imgSels) {
      document.querySelectorAll(s).forEach(img => {
        const src = img.src || img.dataset?.src || '';
        if (src && !seen.has(src) && !src.includes('avatar') && !src.includes('emoji') && src.length > 30) {
          seen.add(src); images.push(src);
        }
      });
    }
    const tags = [...document.querySelectorAll('a[href*="/search_result/"]')].map(e => e.innerText.trim()).filter(t => t.startsWith('#'));
    return { title, content, date, images, tags };
  });
}

function saveNotes() {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(notes, null, 2), 'utf-8');
}

async function screenshotPage(page, title, index) {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').substring(0, 40);
  const filenames = [];
  try {
    // 获取图片总数
    const totalImages = await page.evaluate(() => {
      // 小红书轮播指示器：小圆点数量
      const dots = document.querySelectorAll('.carousel-indicator .dot, [class*="indicator"] span, [class*="indicator"] div, .slide-indicator span');
      if (dots.length > 1) return dots.length;
      // 或者看swiper里有几张图
      const slides = document.querySelectorAll('.swiper-slide, [class*="slide"]');
      if (slides.length > 1) return slides.length;
      return 1;
    });
    
    const maxImages = Math.min(totalImages, 20);
    console.log(`     共 ${totalImages} 张图片`);

    for (let i = 0; i < maxImages; i++) {
      const filename = `${String(index).padStart(2, '0')}_${safeTitle}_p${i + 1}.png`;
      
      // 截当前显示的图
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, filename), type: 'png' });
      filenames.push(filename);

      if (i < maxImages - 1) {
        // 点击图片右半部分来翻到下一张
        const swiped = await page.evaluate(() => {
          // 找到轮播容器并点击右半部分
          const container = document.querySelector('.swiper-slide.swiper-slide-active, [class*="carousel"] [class*="slide"], [class*="note-slider"], .note-scroller');
          if (container) {
            const rect = container.getBoundingClientRect();
            const clickX = rect.left + rect.width * 0.85;
            const clickY = rect.top + rect.height * 0.5;
            const el = document.elementFromPoint(clickX, clickY);
            if (el) { el.click(); return 'click-right'; }
          }
          // 尝试找下一张按钮
          const btns = document.querySelectorAll('[class*="next"], [class*="right"]');
          for (const btn of btns) {
            if (btn.offsetParent !== null && btn.offsetWidth > 0) { btn.click(); return 'btn'; }
          }
          return null;
        });
        
        if (!swiped) {
          // 最后手段：在图片区域模拟鼠标点击右侧
          const imgEl = await page.$('.swiper-slide img, [class*="slide"] img, img[src*="xhscdn"]');
          if (imgEl) {
            const box = await imgEl.boundingBox();
            if (box) {
              await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
            }
          }
        }
        await sleep(800);
      }
    }
    return filenames;
  } catch (err) {
    console.log(`     截图失败: ${err.message.substring(0, 60)}`);
    return filenames.length > 0 ? filenames : null;
  }
}

async function main() {
  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: 'http://127.0.0.1:9222',
      defaultViewport: null,
      protocolTimeout: 180000,
    });
    console.log('✓ 已连接Chrome\n');
  } catch (e) {
    console.error('连接Chrome失败，请确保Chrome以调试模式运行（端口9222）');
    process.exit(1);
  }

  // 先扫描所有已打开的笔记标签页
  console.log('📸 扫描已打开的标签页...');
  const pages = await browser.pages();
  let scanned = 0;
  for (const page of pages) {
    const url = page.url();
    if (!url.includes('xiaohongshu.com/explore/')) continue;
    const cleanUrl = url.split('?')[0];
    
    if (savedUrls.has(cleanUrl)) {
      // 已有文本但可能没截图，补截图
      const existing = notes.find(n => n.url === cleanUrl);
      if (existing && !existing.screenshots) {
        const filenames = await screenshotPage(page, existing.title || 'untitled', existing.index || scanned + 1);
        if (filenames && filenames.length > 0) {
          existing.screenshots = filenames;
          console.log(`  📷 补截图 #${existing.index}: ${existing.title} -> ${filenames.length}张`);
          scanned++;
        }
      }
      continue;
    }

    // 新笔记：提取文本+截图
    try {
      await sleep(1000);
      const data = await extractNote(page);
      const noteIndex = notes.length + 1;
      const title = data.title || cleanUrl.split('/').pop();
      const filenames = await screenshotPage(page, title, noteIndex);
      
      const noteData = {
        url: cleanUrl,
        title: data.title,
        content: data.content,
        date: data.date,
        images: data.images,
        tags: data.tags,
        screenshots: filenames,
        index: noteIndex,
      };

      notes.push(noteData);
      savedUrls.add(cleanUrl);
      scanned++;
      console.log(`  ✅ #${noteIndex}: ${title} | ${(data.content || '').length}字 | ${data.images.length}图 | 📷${filenames ? filenames.length + '张' : '无'}`);
    } catch (err) {
      console.log(`  ❌ ${cleanUrl}: ${err.message.substring(0, 60)}`);
    }
  }
  saveNotes();
  console.log(`\n扫描完成: 处理了 ${scanned} 个标签页\n`);

  // 进入监听模式
  let lastUrl = '';
  let newCount = 0;
  console.log('🔍 监听中... 打开新笔记会自动保存+截图');
  console.log('   按 Ctrl+C 停止\n');

  while (true) {
    try {
      const allPages = await browser.pages();
      for (const page of allPages) {
        const url = page.url();
        if (url.includes('xiaohongshu.com/explore/') && url !== lastUrl) {
          const cleanUrl = url.split('?')[0];
          if (savedUrls.has(cleanUrl)) {
            lastUrl = url;
            continue;
          }
          lastUrl = url;
          await sleep(2500);

          try {
            const data = await extractNote(page);
            const noteIndex = notes.length + 1;
            const title = data.title || cleanUrl.split('/').pop();
            const filenames = await screenshotPage(page, title, noteIndex);

            const noteData = {
              url: cleanUrl,
              title: data.title,
              content: data.content,
              date: data.date,
              images: data.images,
              tags: data.tags,
              screenshots: filenames,
              index: noteIndex,
            };

            const existing = notes.findIndex(n => n.url === cleanUrl);
            if (existing >= 0) {
              notes[existing] = { ...notes[existing], ...noteData, index: notes[existing].index };
            } else {
              notes.push(noteData);
            }
            savedUrls.add(cleanUrl);
            newCount++;
            saveNotes();
            console.log(`  ✅ #${noteIndex}: ${title} | ${(data.content || '').length}字 | 📷${filenames ? filenames.length + '张' : '无'}`);
          } catch (err) {
            console.log(`  ❌ 提取失败: ${err.message.substring(0, 60)}`);
          }
        }
      }
    } catch (e) {
      if (e.message.includes('disconnected') || e.message.includes('closed')) {
        console.log('\nChrome已断开，退出');
        break;
      }
    }
    await sleep(1500);
  }

  saveNotes();
  console.log(`完成! 新增 ${newCount} 篇`);
}

main().catch(err => { console.error('出错:', err); process.exit(1); });
