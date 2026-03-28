/**
 * 小红书笔记抓取脚本 - 语风swiss
 * 策略：在主页收集笔记ID → 用浏览器内fetch调用XHS内部API获取笔记详情
 * node scripts/scrape-xiaohongshu.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_ID = '64a14c9d000000001c028bf2';
const PROFILE_URL = `https://www.xiaohongshu.com/user/profile/${USER_ID}`;
const OUTPUT_FILE = path.join(__dirname, 'notes-output.json');

const BROWSER_PATHS = [
  process.env.LOCALAPPDATA + '\\Programs\\Quark\\6.5.5.759\\quark.exe',
  process.env.LOCALAPPDATA + '\\Programs\\Quark\\quark.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
];

function findBrowser() {
  for (const p of BROWSER_PATHS) { if (fs.existsSync(p)) return p; }
  return null;
}
function waitEnter(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => { rl.question(msg, () => { rl.close(); r(); }); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const bp = findBrowser();
  if (!bp) { console.error('找不到浏览器'); process.exit(1); }
  console.log('浏览器:', bp);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: bp,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
    protocolTimeout: 180000,
  });

  let page = (await browser.pages())[0] || await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  console.log('打开小红书...');
  await page.goto('https://www.xiaohongshu.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('\n=== 请在浏览器中扫码登录小红书 ===');
  console.log('=== 登录成功后回终端按回车 ===\n');
  await waitEnter('按回车继续...');
  await sleep(2000);

  const allPages = await browser.pages();
  page = allPages[allPages.length - 1];

  // === 第一步：去主页收集所有笔记URL和ID ===
  console.log('进入语风swiss主页...');
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async () => {
    page = await browser.newPage();
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  });
  await sleep(4000);

  console.log('滚动加载笔记...');
  let prevCount = 0, stableRounds = 0;
  for (let i = 0; i < 60; i++) {
    const count = await page.evaluate(
      () => document.querySelectorAll('section.note-item a[href*="/explore/"]').length
    ).catch(() => 0);
    if (count === prevCount) { stableRounds++; if (stableRounds >= 4) break; } else stableRounds = 0;
    prevCount = count;
    console.log(`  滚动${i + 1}: ${count}篇`);
    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(1500);
  }

  // 收集笔记ID和URL
  const notes = await page.evaluate(() => {
    const links = document.querySelectorAll('section.note-item a[href*="/explore/"]');
    return [...links].map(a => {
      const href = a.href.split('?')[0];
      const noteId = href.split('/explore/')[1];
      // 也尝试获取卡片上的标题
      const section = a.closest('section.note-item');
      const titleEl = section?.querySelector('.title, [class*="title"], span');
      const title = titleEl?.innerText?.trim() || '';
      return { noteId, url: href, cardTitle: title };
    }).filter(n => n.noteId);
  });
  console.log(`收集到 ${notes.length} 篇笔记\n`);

  if (notes.length === 0) {
    console.log('没有找到笔记，退出');
    await browser.close();
    return;
  }

  // === 第二步：尝试用内部API获取笔记详情 ===
  // 先测试一下API是否可用
  console.log('测试XHS内部API...');
  const apiTest = await page.evaluate(async (noteId) => {
    try {
      const resp = await fetch(`/api/sns/web/v1/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_note_id: noteId,
          image_formats: ['jpg', 'webp'],
        }),
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, hasData: !!data?.data, code: data?.code, keys: Object.keys(data || {}) };
    } catch (e) {
      return { error: e.message };
    }
  }, notes[0].noteId);
  console.log('API测试结果:', JSON.stringify(apiTest));

  const useApi = apiTest.ok && apiTest.hasData;
  console.log(useApi ? '✓ API可用，使用API模式抓取' : '✗ API不可用，使用点击弹窗模式抓取');

  const results = [];

  if (useApi) {
    // === API模式：直接调用内部接口 ===
    for (let i = 0; i < notes.length; i++) {
      const { noteId, url, cardTitle } = notes[i];
      console.log(`[${i + 1}/${notes.length}] ${noteId}`);

      try {
        const data = await page.evaluate(async (nid) => {
          try {
            const resp = await fetch(`/api/sns/web/v1/feed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_note_id: nid,
                image_formats: ['jpg', 'webp'],
              }),
            });
            const json = await resp.json();
            if (!json?.data?.items?.[0]?.note_card) return { error: 'no note_card in response' };

            const card = json.data.items[0].note_card;
            const title = card.title || '';
            const desc = card.desc || '';
            const time = card.time || card.last_update_time || '';
            const tags = (card.tag_list || []).map(t => '#' + (t.name || t));
            const images = (card.image_list || []).map(img => {
              // 优先取原图URL
              return img.url_default || img.url || img.info_list?.[0]?.url || '';
            }).filter(u => u);
            const type = card.type || '';
            const interactInfo = card.interact_info || {};

            return {
              title, desc, time, tags, images, type,
              likes: interactInfo.liked_count || '0',
              comments: interactInfo.comment_count || '0',
              collected: interactInfo.collected_count || '0',
            };
          } catch (e) {
            return { error: e.message };
          }
        }, noteId);

        if (data.error) {
          console.log(`  失败: ${data.error}`);
          results.push({ index: i + 1, url, noteId, title: cardTitle, content: '', error: data.error });
        } else {
          results.push({
            index: i + 1,
            url,
            noteId,
            title: data.title,
            content: data.desc,
            date: data.time ? new Date(data.time).toISOString() : '',
            tags: data.tags,
            images: data.images,
            type: data.type,
            likes: data.likes,
            comments: data.comments,
            collected: data.collected,
          });
          console.log(`  标题: ${data.title || '(无)'}`);
          console.log(`  内容: ${(data.desc || '').length}字`);
          console.log(`  图片: ${(data.images || []).length}张`);
        }
      } catch (err) {
        console.log(`  异常: ${err.message.substring(0, 100)}`);
        results.push({ index: i + 1, url, noteId, title: cardTitle, content: '', error: err.message.substring(0, 200) });
      }

      // 每5篇保存
      if ((i + 1) % 5 === 0 || i === notes.length - 1) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`  [已保存 ${results.length} 篇]\n`);
      }
      await sleep(1500 + Math.random() * 1500);
    }
  } else {
    // === 点击模式：在主页点击卡片，等弹窗出现后抓取 ===
    console.log('使用点击弹窗模式...');
    // 滚回顶部
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(1500);

    for (let i = 0; i < notes.length; i++) {
      const { url, cardTitle } = notes[i];
      console.log(`[${i + 1}/${notes.length}] 点击卡片...`);

      try {
        const cards = await page.$$('section.note-item');
        if (i >= cards.length) { console.log('  超出范围'); break; }

        await cards[i].evaluate(el => el.scrollIntoView({ block: 'center' }));
        await sleep(600);

        // 点击封面
        const cover = await cards[i].$('a.cover, [class*="cover"], img');
        if (cover) await cover.click(); else await cards[i].click();
        await sleep(4000);

        // 检查URL是否变了（跳转到详情页 vs 弹窗）
        const currentUrl = page.url();
        const isDetailPage = currentUrl.includes('/explore/');

        // 抓取内容
        const data = await page.evaluate(() => {
          function getText(sels) {
            for (const s of sels) {
              try {
                const el = document.querySelector(s);
                if (el) { const t = el.innerText?.trim(); if (t) return t; }
              } catch {}
            }
            return '';
          }
          const title = getText(['#detail-title', '.note-text .title', '.title', 'h1']);
          const content = getText(['#detail-desc', '.note-text .desc', '.note-text', '.desc']);
          const date = getText(['.date', '[class*="date"]', 'time']);
          let images = [];
          const imgs = document.querySelectorAll('.swiper-slide img, [class*="slide"] img, img[src*="xhscdn"], img[src*="sns-img"]');
          const seen = new Set();
          for (const img of imgs) {
            const src = img.src || img.getAttribute('data-src') || '';
            if (src && !seen.has(src) && !src.includes('avatar') && src.length > 20) { seen.add(src); images.push(src); }
          }
          return { title, content, date, images };
        });

        results.push({
          index: i + 1, url,
          title: data.title || cardTitle,
          content: data.content,
          date: data.date,
          tags: [],
          images: data.images,
        });
        console.log(`  标题: ${data.title || cardTitle || '(无)'}`);
        console.log(`  内容: ${(data.content || '').length}字, 图片: ${(data.images || []).length}张`);

        // 关闭/返回
        if (isDetailPage) {
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
          await sleep(2000);
          if (!page.url().includes('/user/profile/')) {
            await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(3000);
          }
        } else {
          await page.keyboard.press('Escape');
          await sleep(1000);
        }
      } catch (err) {
        console.log(`  失败: ${err.message.substring(0, 100)}`);
        results.push({ index: i + 1, url, title: cardTitle, content: '', error: err.message.substring(0, 200) });
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(1000);
      }

      if ((i + 1) % 5 === 0 || i === notes.length - 1) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`  [已保存 ${results.length} 篇]\n`);
      }
      await sleep(1000 + Math.random() * 1500);
    }
  }

  // 最终保存
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  const withContent = results.filter(r => (r.content || '').length > 10).length;
  const withTitle = results.filter(r => r.title).length;
  const withImages = results.filter(r => (r.images || []).length > 0).length;
  console.log(`\n完成! ${results.length} 篇笔记`);
  console.log(`有标题: ${withTitle}篇, 有内容: ${withContent}篇, 有图片: ${withImages}篇`);
  console.log(`保存到 ${OUTPUT_FILE}`);

  await browser.close();
}

main().catch(err => { console.error('出错:', err); process.exit(1); });
