// 将关键笔记图片转为base64，输出到JSON文件供分析
import fs from 'fs';
import path from 'path';

const screenshotsDir = './scripts/screenshots';
const outputFile = './scripts/images-base64.json';

// 要分析的关键笔记文件夹
const keyNotes = [
  '29_深度分析：贵州茅台',
  '33_深度分析：中国中免',
  '00_深度分析：资生堂',
  '16_金融IT龙头：恒生电子',
  '21_如何预判中国中免的暴跌',
  '36_豆粕ETF，三年翻倍',
  '28_白银基金无风险套利',
  '42_黄金康波周期才刚刚开始',
  '30_现阶段仍然低估的基金',
  '00_老钱投资系列1：香料',
  '00_老钱投资系列2：奢侈品',
  '00_老钱投资系列3：酒',
  '00_全球TOP100核心资产',
  '00_全球医美龙头：高德美',
  '00_两个字：抄底',
  '00_创新药：清仓',
  '00_半导体：何时抄底？',
  '00_哪些板块里全是散户？',
  '00_大A本周即是"黄金坑"',
  '01_灵魂画师：大A未来走势',
];

const result = {};
let totalImages = 0;

for (const note of keyNotes) {
  const noteDir = path.join(screenshotsDir, note);
  if (!fs.existsSync(noteDir)) {
    console.log(`跳过不存在的目录: ${note}`);
    continue;
  }
  
  const files = fs.readdirSync(noteDir)
    .filter(f => f.endsWith('.png'))
    .sort((a, b) => parseInt(a) - parseInt(b));
  
  // 每篇笔记最多取前5张图（控制大小）
  const selected = files.slice(0, 5);
  
  result[note] = selected.map(f => {
    const filePath = path.join(noteDir, f);
    const buffer = fs.readFileSync(filePath);
    totalImages++;
    return {
      file: f,
      base64: buffer.toString('base64'),
      size: buffer.length
    };
  });
  
  console.log(`${note}: ${selected.length}/${files.length} 张图片`);
}

console.log(`\n总计: ${totalImages} 张图片`);

// 太大了，分批输出
// 先输出每篇笔记的图片数量和大小统计
const stats = {};
let totalSize = 0;
for (const [note, images] of Object.entries(result)) {
  const noteSize = images.reduce((sum, img) => sum + img.size, 0);
  stats[note] = { count: images.length, totalSize: noteSize, avgSize: Math.round(noteSize / images.length) };
  totalSize += noteSize;
}
console.log('\n图片统计:');
console.log(JSON.stringify(stats, null, 2));
console.log(`\n总大小: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
