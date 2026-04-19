/**
 * tsc 不复制非 TS 资源；生产启动依赖 dist 下的 sql/json。
 * 在 `npm run build` 中于 tsc 之后执行。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function copyPair(relSrc, relDest) {
  const src = path.join(root, relSrc);
  const dest = path.join(root, relDest);
  if (!fs.existsSync(src)) {
    console.error(`copyBuildAssets: missing source ${relSrc}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const pairs = [
  ['src/db/schema.sql', 'dist/db/schema.sql'],
  ['src/db/migration-phase2.sql', 'dist/db/migration-phase2.sql'],
  ['src/scheduler/holidays.json', 'dist/scheduler/holidays.json'],
];

for (const [from, to] of pairs) {
  copyPair(from, to);
}

console.log('copyBuildAssets: copied schema.sql, migration-phase2.sql, holidays.json → dist');
