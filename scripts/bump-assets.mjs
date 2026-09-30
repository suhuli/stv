#!/usr/bin/env node
// 给 HTML 中引用的本地 js/css 加上版本参数（?v=xxx），用于让浏览器缓存失效。
// 用法：node scripts/bump-assets.mjs [版本号]   （默认使用当前时间 YYYYMMDDHHmm）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
const re = /((?:src|href)=")((?:js|css)\/[^"?]+)(\?v=[^"]*)?(")/g;
// libs/ 下的第三方库不加版本号：Cloudflare 会缓存 Early Hints，带版本号会在发版后一段时间内预加载到旧文件
for (const f of files) {
    const p = path.join(ROOT, f);
    const before = fs.readFileSync(p, 'utf8');
    const after = before.replace(re, (_, a, file, _v, d) => `${a}${file}?v=${version}${d}`);
    if (after !== before) { fs.writeFileSync(p, after); console.log(`updated ${f}`); }
}
// _headers 里的 Early Hints Link 头也同步版本号
{
    const hp = path.join(ROOT, '_headers');
    if (fs.existsSync(hp)) {
        const before = fs.readFileSync(hp, 'utf8');
        const after = before.replace(/(<\/(?:js|css)\/[^>?]+)\?v=[^>]*>/g, `$1?v=${version}>`);
        if (after !== before) { fs.writeFileSync(hp, after); console.log('updated _headers'); }
    }
}
console.log(`asset version = ${version}`);
