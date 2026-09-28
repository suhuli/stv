#!/usr/bin/env node
// 采集源健康巡检
//
// 对 js/config.js 中的每个内置源：
//   1. 搜索一个固定关键词，记录耗时 / 是否返回合法 JSON / 结果数
//   2. 取第一条结果的 m3u8 地址，验证能否拉到以 #EXTM3U 开头的播放列表
// 结果写入 data/source-health.json，前端据此排序、标注和挑选默认源。
//
// 用法：node scripts/check-sources.mjs [--keyword 关键词] [--concurrency 6] [--timeout 10000]

import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'data', 'source-health.json');

const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => {
        if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
        return acc;
    }, [])
);
const KEYWORDS = (args.keyword || '爱情,三体,狂飙').split(',').map(s => s.trim()).filter(Boolean);
const CONCURRENCY = parseInt(args.concurrency || '6', 10);
const TIMEOUT = parseInt(args.timeout || '10000', 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---- 从 config.js 里读出 API_SITES（该文件依赖 window 全局，用 vm 沙箱执行） ----
async function loadSites() {
    const code = await fs.readFile(path.join(ROOT, 'js', 'config.js'), 'utf8');
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return ctx.window.API_SITES;
}

async function fetchWithTimeout(url, init = {}) {
    const started = Date.now();
    const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, 'Accept': '*/*', ...(init.headers || {}) },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT)
    });
    return { res, elapsed: Date.now() - started };
}

function firstM3u8(list) {
    for (const item of list || []) {
        const m = String(item.vod_play_url || '').match(/https?:\/\/[^#$\s"']+?\.m3u8[^#$\s"']*/i);
        if (m) return m[0];
    }
    return null;
}

async function checkOne(key, site) {
    const result = {
        name: site.name,
        api_ok: false,
        play_ok: false,
        latency: null,
        results: 0,
        error: null,
        checked_at: new Date().toISOString()
    };
    try {
        // 逐个关键词尝试，直到有结果
        let data = null;
        for (const kw of KEYWORDS) {
            const url = `${site.api}?ac=videolist&wd=${encodeURIComponent(kw)}`;
            const { res, elapsed } = await fetchWithTimeout(url);
            result.latency = result.latency == null ? elapsed : Math.min(result.latency, elapsed);
            if (!res.ok) { result.error = `HTTP ${res.status}`; continue; }
            const text = await res.text();
            try { data = JSON.parse(text); } catch { result.error = '非 JSON 响应'; continue; }
            if (!data || !Array.isArray(data.list)) { result.error = '缺少 list 字段'; data = null; continue; }
            result.api_ok = true;
            result.results = data.list.length;
            result.error = null;
            if (data.list.length > 0) break;
        }
        if (!result.api_ok) return result;

        const m3u8 = firstM3u8(data.list);
        if (!m3u8) { result.error = '结果中没有 m3u8 地址'; return result; }
        const { res } = await fetchWithTimeout(m3u8, { headers: { Referer: new URL(m3u8).origin + '/' } });
        if (!res.ok) { result.error = `m3u8 HTTP ${res.status}`; return result; }
        const head = (await res.text()).slice(0, 64);
        result.play_ok = head.trim().startsWith('#EXTM3U');
        if (!result.play_ok) result.error = 'm3u8 内容无效';
    } catch (e) {
        result.error = e.name === 'TimeoutError' ? '超时' : (e.message || String(e)).slice(0, 80);
    }
    return result;
}

async function main() {
    const sites = await loadSites();
    const keys = Object.keys(sites).filter(k => !sites[k].adult && !/example\.com/.test(sites[k].api));
    const out = {};
    let next = 0;
    const worker = async () => {
        while (next < keys.length) {
            const key = keys[next++];
            out[key] = await checkOne(key, sites[key]);
            const r = out[key];
            const mark = r.play_ok ? '✅' : r.api_ok ? '⚠️ ' : '❌';
            console.log(`${mark} ${key.padEnd(8)} ${String(r.latency ?? '-').padStart(5)}ms  ${r.results} 条  ${r.error || ''}`);
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));

    // 稳定的键顺序，减少无意义 diff
    const sorted = Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
    const summary = {
        generated_at: new Date().toISOString(),
        keywords: KEYWORDS,
        total: keys.length,
        healthy: Object.values(sorted).filter(r => r.play_ok).length,
        api_only: Object.values(sorted).filter(r => r.api_ok && !r.play_ok).length,
        down: Object.values(sorted).filter(r => !r.api_ok).length,
        sources: sorted
    };
    await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
    await fs.writeFile(OUT_FILE, JSON.stringify(summary, null, 2) + '\n');
    console.log(`\n共 ${summary.total} 个源：可播放 ${summary.healthy}，仅接口可用 ${summary.api_only}，不可用 ${summary.down}`);
    console.log(`已写入 ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
