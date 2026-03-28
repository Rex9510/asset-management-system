/**
 * 自动收集小红书笔记 - 通过CDP连接已打开的Chrome
 * 
 * 使用方法：
 * 1. 关闭所有Chrome窗口
 * 2. 用调试模式启动Chrome（脚本会自动启动）
 * 3. 在Chrome中登录小红书
 * 4. 回终端按回车，脚本自动收集所有笔记
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import readline from 'readline';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = path.join(__dirname, 'notes-output.json');
const USER_ID = '64a14c9d000000001c028bf2';
const PROFILE_URL = `https://www.xiaohongshu.com/user/profile/${USER_ID}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function waitEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => { rl.question(msg, () => { rl.close(); r(); }); });
}

// 保存到collect-server
async function saveToServer(data) {
  return new Promise((resolve) => {
    const body = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost', port: 3001, path: '/save',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: false }); } });
    });
    req.on('error', () => resolve({ ok: false }));
    req.write(body); req.end();
  });
}

async function main() {
  // 找Chrome路径
  const chromePaths = [
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  let chromePath = null;
  for (const p of chromePaths) { if (fs.existsSync(p)) { chromePath = p; break; } }
  if (!chromePath) { console.error('找不到Chrome'); process.exit(1); }
  console.log('Chrome路径:', chromePath);

  // 启动带调试端口的Chrome
  console.log('\n启动Chrome（调试模式）...');
  // 使用临时用户数据目录避免锁文件冲突
  const tempUserDataDir = path.join(process.env.TEMP || process.env.LOCALAPPDATA, 'chrome-debug-xhs');
  console.log('用户数据目录:', tempUserDataDir);
  const chrome = spawn(chromePath, [
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${tempUserDataDir}`,
  ], { detached: true, stdio: 'ignore' });
  chrome.unref();

  // 等待Chrome调试端口就绪（重试多次）
  let browser;
  for (let attempt = 1; attempt <= 15; attempt++) {
    await sleep(2000);
    try {
      console.log(`连接Chrome... (尝试 ${attempt}/15)`);
      browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null,
        protocolTimeout: 120000,
      });
      console.log('✓ 已连接Chrome');
      break;
    } catch (e) {
      if (attempt === 15) {
        console.error('连接失败，15次重试均失败');
        console.error(e.message);
        process.exit(1);
      }
    }
  }

  // 打开小红书
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  console.log('打开小红书...');
  await page.goto('https://www.xiaohongshu.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);

  // 自动检测登录状态（轮询，无需手动按回车）
  console.log('\n=== 请在Chrome中登录小红书（扫码或账号登录）===');
  console.log('=== 脚本会自动检测登录状态 ===\n');
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    try {
      const loggedIn = await page.evaluate(() => {
        // 检测多种登录标志
        const hasUser = !!document.querySelector('[class*="user"]') || !!document.querySelector('.side-bar [href*="/user/"]');
        const hasLogin = !!document.querySelector('[class*="login-btn"]') || !!document.querySelector('[class*="login-container"]');
        const hasAvatar = !!document.querySelector('[class*="avatar"]');
        return (hasUser || hasAvatar) && !hasLogin;
      });
      if (loggedIn) {
        console.log('✓ 检测到已登录');
        break;
      }
      if (i % 10 === 0) console.log(`  等待登录... (${i * 3}秒)`);
    } catch { /* page可能在导航中 */ }
  }
  await sleep(2000);

  // 进入博主主页
  console.log('\n进入语风swiss主页...');
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(4000);

  // 滚动加载所有笔记
  console.log('滚动加载笔记列表...');
  let prevCount = 0, stableRounds = 0;
  for (let i = 0; i < 80; i++) {
    const count = await page.evaluate(
      () => document.querySelectorAll('section.note-item a[href*="/explore/"]').length
    ).catch(() => 0);
    if (count === prevCount) { stableRounds++; if (stableRounds >= 5) break; } else stableRounds = 0;
    prevCount = count;
    if (i % 5 === 0) console.log(`  滚动${i + 1}: ${count}篇`);
    await page.evaluate(() => window.scrollBy(0, 600));
    await sleep(1200);
  }

  // 收集所有笔记URL
  const noteLinks = await page.evaluate(() => {
    const links = document.querySelectorAll('section.note-item a[href*="/explore/"]');
    return [...links].map(a => {
      const href = a.href.split('?')[0];
      const section = a.closest('section.note-item');
      const titleEl = section?.querySelector('.title, [class*="title"], span');
      return { url: href, cardTitle: titleEl?.innerText?.trim() || '' };
    }).filter(n => n.url);
  });
  console.log(`\n共找到 ${noteLinks.length} 篇笔记\n`);

  if (noteLinks.length === 0) {
    console.log('没找到笔记，退出');
    await page.close();
    browser.disconnect();
    return;
  }

  // 逐个打开笔记详情页并提取内容
  const results = [];
  for (let i = 0; i < noteLinks.length; i++) {
    const { url, cardTitle } = noteLinks[i];
    console.log(`[${i + 1}/${noteLinks.length}] ${cardTitle || url.split('/').pop()}`);

    try {
      // 新标签页打开笔记
      const notePage = await browser.newPage();
      await notePage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await notePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(3000);

      // 提取笔记内容
      const data = await notePage.evaluate(() => {
        function getText(sels) {
          for (const s of sels) {
            try { const el = document.querySelector(s); if (el) { const t = el.innerText?.trim(); if (t && t.length > 1) return t; } } catch {}
          }
          return '';
        }
        const title = getText(['#detail-title', '.note-text .title', '.title', 'h1']);
        const content = getText(['#detail-desc .note-text', '#detail-desc', '.note-text .desc', '.note-text', '.desc']);
        const date = getText(['.date', '[class*="date"]', 'time']);
        const images = [];
        const seen = new Set();
        const imgSels = ['.swiper-slide img', '[class*="slide"] img', '[class*="swiper"] img', 'img[src*="xhscdn"]', 'img[src*="sns-img"]', 'img[src*="ci.xiaohongshu"]'];
        for (const s of imgSels) {
          document.querySelectorAll(s).forEach(img => {
            const src = img.src || img.dataset?.src || '';
            if (src && !seen.has(src) && !src.includes('avatar') && !src.includes('emoji') && src.length > 30) { seen.add(src); images.push(src); }
          });
        }
        const tags = [...document.querySelectorAll('a[href*="/search_result/"]')].map(e => e.innerText.trim()).filter(t => t.startsWith('#'));
        return { title, content, date, images, tags };
      });

      const noteData = {
        url,
        title: data.title || cardTitle,
        content: data.content,
        date: data.date,
        images: data.images,
        tags: data.tags,
      };

      // 保存到collect-server
      const saveResult = await saveToServer(noteData);
      if (saveResult.ok) {
        console.log(`  ✅ ${noteData.title || '(无标题)'} | ${(noteData.content || '').length}字 | ${noteData.images.length}图`);
      } else {
        console.log(`  ⚠️ 服务器保存失败，本地保存`);
      }
      results.push(noteData);

      await notePage.close();
    } catch (err) {
      console.log(`  ❌ 失败: ${err.message.substring(0, 80)}`);
      results.push({ url, title: cardTitle, content: '', error: err.message.substring(0, 200) });
    }

    // 随机延迟避免被封
    await sleep(2000 + Math.random() * 2000);

    // 每5篇本地也保存一次
    if ((i + 1) % 5 === 0 || i === noteLinks.length - 1) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
    }
  }

  // 最终保存
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  const withContent = results.filter(r => (r.content || '').length > 10).length;
  console.log(`\n✅ 完成! 共 ${results.length} 篇, 有内容 ${withContent} 篇`);
  console.log(`保存到 ${OUTPUT_FILE}`);

  await page.close();
  browser.disconnect();
}

main().catch(err => { console.error('出错:', err); process.exit(1); });
