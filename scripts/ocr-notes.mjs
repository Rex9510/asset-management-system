// OCR提取笔记图片中的中文文字 - 边跑边存
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';

const screenshotsDir = './scripts/screenshots';
const outputFile = './scripts/notes-text-extracted.json';

// 如果已有部分结果，加载继续
let result = {};
if (fs.existsSync(outputFile)) {
  try { result = JSON.parse(fs.readFileSync(outputFile, 'utf-8')); } catch(e) {}
}

// 动态扫描所有子目录
const keyNotes = fs.readdirSync(screenshotsDir)
  .filter(f => fs.statSync(path.join(screenshotsDir, f)).isDirectory())
  .sort();

const worker = await Tesseract.createWorker('chi_sim+eng');
let total = 0;

for (const note of keyNotes) {
  // 跳过已处理的
  if (result[note]) {
    console.log(`已有: ${note} (${result[note].length}页)`);
    continue;
  }

  const noteDir = path.join(screenshotsDir, note);
  if (!fs.existsSync(noteDir)) continue;

  const files = fs.readdirSync(noteDir)
    .filter(f => f.endsWith('.png'))
    .sort((a, b) => parseInt(a) - parseInt(b));

  console.log(`处理: ${note} (${files.length}张)`);
  const noteTexts = [];

  for (const f of files) {
    try {
      const { data: { text } } = await worker.recognize(path.join(noteDir, f));
      const cleaned = text.trim();
      if (cleaned.length > 10) {
        noteTexts.push({ page: parseInt(f), text: cleaned });
        total++;
      }
      process.stdout.write('.');
    } catch(e) {
      process.stdout.write('x');
    }
  }

  if (noteTexts.length > 0) {
    result[note] = noteTexts;
    // 每处理完一篇就保存
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
  }
  console.log(` ${noteTexts.length}页`);
}

await worker.terminate();
console.log(`完成! 新增${total}张`);
