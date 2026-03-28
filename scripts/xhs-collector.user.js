// ==UserScript==
// @name         小红书笔记收集器
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  在小红书笔记详情页添加"保存"按钮，一键收集标题、正文、图片到本地
// @match        https://www.xiaohongshu.com/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// ==/UserScript==

(function() {
  'use strict';

  const SERVER = 'http://localhost:3001';
  let btnAdded = false;

  function createButton() {
    if (document.getElementById('xhs-save-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'xhs-save-btn';
    btn.innerHTML = '📥 保存笔记';
    btn.style.cssText = `
      position: fixed; top: 80px; right: 20px; z-index: 99999;
      background: linear-gradient(135deg, #ff2442, #ff6b81);
      color: white; padding: 12px 20px; border-radius: 25px;
      cursor: pointer; font-size: 15px; font-weight: bold;
      box-shadow: 0 4px 15px rgba(255,36,66,0.4);
      transition: all 0.3s; user-select: none;
    `;
    btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; };
    btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };
    btn.onclick = saveNote;
    document.body.appendChild(btn);

    // 计数器
    const counter = document.createElement('div');
    counter.id = 'xhs-counter';
    counter.style.cssText = `
      position: fixed; top: 130px; right: 20px; z-index: 99999;
      background: rgba(0,0,0,0.7); color: #0f0; padding: 6px 14px;
      border-radius: 12px; font-size: 12px; font-family: monospace;
    `;
    counter.textContent = '加载中...';
    document.body.appendChild(counter);
    updateCounter();
  }

  async function updateCounter() {
    try {
      const resp = await fetch(`${SERVER}/status`);
      const data = await resp.json();
      const el = document.getElementById('xhs-counter');
      if (el) el.textContent = `已保存: ${data.count} 篇`;
    } catch {
      const el = document.getElementById('xhs-counter');
      if (el) el.textContent = '服务器未启动';
    }
  }

  function extractNote() {
    const url = window.location.href.split('?')[0];

    // 标题
    let title = '';
    const titleSels = ['#detail-title', '.note-text .title', '.title', 'h1'];
    for (const s of titleSels) {
      const el = document.querySelector(s);
      if (el && el.innerText.trim()) { title = el.innerText.trim(); break; }
    }

    // 正文
    let content = '';
    const contentSels = [
      '#detail-desc .note-text',
      '#detail-desc',
      '.note-text .desc',
      '.note-text',
      '.desc',
    ];
    for (const s of contentSels) {
      const el = document.querySelector(s);
      if (el && el.innerText.trim().length > 5) { content = el.innerText.trim(); break; }
    }

    // 日期
    let date = '';
    const dateSels = ['.date', '[class*="date"]', 'time'];
    for (const s of dateSels) {
      const el = document.querySelector(s);
      if (el && el.innerText.trim()) { date = el.innerText.trim(); break; }
    }

    // 标签
    let tags = [];
    const tagEls = document.querySelectorAll('a[href*="/search_result/"], .tag a, [class*="tag"] a');
    tags = [...tagEls].map(e => e.innerText.trim()).filter(t => t.startsWith('#'));

    // 图片 - 笔记轮播图
    let images = [];
    const seen = new Set();
    const imgSels = [
      '.swiper-slide img',
      '[class*="slide"] img',
      '[class*="swiper"] img',
      '.carousel img',
      '.note-image img',
      'img[src*="xhscdn"]',
      'img[src*="sns-img"]',
      'img[src*="ci.xiaohongshu"]',
    ];
    for (const s of imgSels) {
      document.querySelectorAll(s).forEach(img => {
        const src = img.src || img.dataset.src || '';
        if (src && !seen.has(src) && !src.includes('avatar') && !src.includes('emoji') && src.length > 30) {
          seen.add(src);
          images.push(src);
        }
      });
    }
    // background-image
    document.querySelectorAll('[style*="background-image"]').forEach(el => {
      const m = el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (m && m[1] && !seen.has(m[1]) && (m[1].includes('xhscdn') || m[1].includes('sns-img'))) {
        seen.add(m[1]);
        images.push(m[1]);
      }
    });

    return { url, title, content, date, tags, images };
  }

  async function saveNote() {
    const btn = document.getElementById('xhs-save-btn');
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ 保存中...';
    btn.style.pointerEvents = 'none';

    try {
      const data = extractNote();

      if (!data.title && !data.content) {
        btn.innerHTML = '❌ 没找到内容';
        btn.style.background = '#999';
        setTimeout(() => {
          btn.innerHTML = origText;
          btn.style.background = 'linear-gradient(135deg, #ff2442, #ff6b81)';
          btn.style.pointerEvents = 'auto';
        }, 2000);
        return;
      }

      const resp = await fetch(`${SERVER}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await resp.json();

      if (result.ok) {
        btn.innerHTML = `✅ 已保存 (${result.count}篇)`;
        btn.style.background = '#22c55e';
        updateCounter();
      } else {
        btn.innerHTML = '❌ 保存失败';
        btn.style.background = '#ef4444';
      }
    } catch (e) {
      btn.innerHTML = '❌ 服务器未启动';
      btn.style.background = '#ef4444';
    }

    setTimeout(() => {
      btn.innerHTML = origText;
      btn.style.background = 'linear-gradient(135deg, #ff2442, #ff6b81)';
      btn.style.pointerEvents = 'auto';
    }, 2000);
  }

  // 监听页面变化，确保按钮一直在
  const observer = new MutationObserver(() => { createButton(); });
  observer.observe(document.body, { childList: true, subtree: true });

  // 初始化
  setTimeout(createButton, 1000);
})();
