#!/usr/bin/env node
// 给 HTML 中引用的本地 js/css 加上版本参数（?v=xxx），用于让浏览器缓存失效。
// 用法：node scripts/bump-assets.mjs [版本号]   （默认使用当前时间 YYYYMMDDHHmm）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const re = /((?:src|href)=")((?:js|css|libs)\/[^"?]+)(\?v=[^"]*)?(")/g;
for (const f of files) {
    const p = path.join(ROOT, f);
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(re, (_, a, file, _v, d) => `${a}${file}?v=${version}${d}`);
    if (after !== before) { fs.writeFileSync(p, after); console.log(`updated ${f}`); }
}
console.log(`asset version = ${version}`);
