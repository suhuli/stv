// functions/proxy/[[path]].js
//
// Cloudflare Pages Function：通用 HTTP 代理 + M3U8 重写
//
// 路径格式：/proxy/<encodeURIComponent(目标URL)>
//
// 可选环境变量：
//   API_CACHE_TTL     采集站搜索 JSON / 普通文本的缓存秒数，默认 600
//   DETAIL_CACHE_TTL  采集站详情（?ac=videolist&ids=）的缓存秒数，默认 1800
//
// 两级缓存：
//   L1 = Cache API（caches.default，本机房，命中最快）
//   L2 = fetch 的 cf.cacheTtl（Cloudflare CDN 主缓存，配合 Smart Tiered Cache 跨机房共享）
//   响应头 X-Proxy-Cache 表示 L1，X-Upstream-Cache 表示 L2（cf-cache-status）。
//   MEDIA_CACHE_TTL   图片等二进制资源的边缘缓存秒数，默认 86400
//   M3U8_CACHE_TTL    重写后的 m3u8 缓存秒数，默认 300
//   UPSTREAM_TIMEOUT  回源超时毫秒，默认 10000
//   MAX_RECURSION     m3u8 主列表递归层数，默认 5（仅 M3U8_FLATTEN=true 时使用）
//   M3U8_FLATTEN      'true' 时把主列表压平为最高码率的子列表（旧行为）；默认 false，
//                     保留所有码率让播放器自适应切换
//   USER_AGENTS_JSON  JSON 字符串数组，随机选用 UA
//   DEBUG             'true' 时输出调试日志
//
// 缓存使用 Cloudflare Cache API（caches.default），不需要 KV 绑定。

const MEDIA_FILE_EXTENSIONS = [
    '.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.f4v', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts',
    '.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.wma', '.alac', '.aiff', '.opus',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.avif', '.heic',
    '.key'
];
const MEDIA_CONTENT_TYPES = ['video/', 'audio/', 'image/', 'application/octet-stream'];
const M3U8_CONTENT_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl'];

const DEFAULT_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

// 透传给客户端的上游响应头（白名单）
const PASSTHROUGH_HEADERS = [
    'content-type', 'content-length', 'content-range', 'accept-ranges',
    'etag', 'last-modified', 'content-disposition'
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-Proxy-Cache, X-Upstream-Cache'
};

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' }
    });
}

export async function onRequest(context) {
    const { request, env, waitUntil } = context;

    if (request.method === 'OPTIONS') return onRequestOptions();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return errorResponse('Method Not Allowed', 405);
    }

    const cfg = readConfig(env);
    const log = cfg.debug ? (msg) => console.log(`[Proxy] ${msg}`) : () => {};

    const url = new URL(request.url);
    const targetUrl = getTargetUrlFromPath(url.pathname);
    if (!targetUrl) {
        return errorResponse('无效的代理请求。路径应为 /proxy/<经过编码的URL>', 400);
    }
    const blocked = isBlockedTarget(targetUrl);
    if (blocked) {
        return errorResponse(`拒绝代理该地址: ${blocked}`, 403);
    }

    // ---- 边缘缓存查询 ----
    // 缓存键只包含目标 URL，忽略前端附加的 ?v=xx 之类的参数
    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/proxy/${encodeURIComponent(targetUrl)}`, { method: 'GET' });
    const rangeHeader = request.headers.get('Range');

    if (!rangeHeader) {
        const hit = await cache.match(cacheKey);
        if (hit) {
            log(`缓存命中: ${targetUrl}`);
            return withHeaders(hit, { 'X-Proxy-Cache': 'HIT' }, request.method === 'HEAD');
        }
    }

    // ---- 回源（L2：Cloudflare CDN 缓存，跨机房共享）----
    try {
        const upstreamPath = new URL(targetUrl).pathname.toLowerCase();
        const l2Ttl = rangeHeader ? 0 : guessTtl(targetUrl, upstreamPath, cfg);
        const upstream = await fetchUpstream(targetUrl, cfg, { range: rangeHeader, cacheTtl: l2Ttl });
        const upstreamCacheStatus = upstream.headers.get('cf-cache-status') || 'NONE';

        if (!upstream.ok && upstream.status !== 206) {
            const body = await upstream.text().catch(() => '');
            log(`上游 ${upstream.status}: ${targetUrl} ${body.slice(0, 120)}`);
            return errorResponse(`上游返回 ${upstream.status}`, upstream.status === 404 ? 404 : 502);
        }

        const contentType = (upstream.headers.get('Content-Type') || '').toLowerCase();
        const pathname = upstreamPath;

        // ---- M3U8：读文本、重写、缓存 ----
        if (looksLikeM3u8(pathname, contentType)) {
            const text = await upstream.text();
            if (text.trim().startsWith('#EXTM3U')) {
                const processed = await processM3u8(targetUrl, text, 0, cfg, log);
                const resp = new Response(processed, {
                    status: 200,
                    headers: {
                        ...CORS_HEADERS,
                        'Content-Type': 'application/vnd.apple.mpegurl',
                        'Cache-Control': `public, max-age=${cfg.m3u8Ttl}`,
                        'X-Proxy-Cache': 'MISS',
                        'X-Upstream-Cache': upstreamCacheStatus
                    }
                });
                waitUntil(cache.put(cacheKey, resp.clone()));
                return finalize(resp, request.method === 'HEAD');
            }
            // 扩展名像 m3u8 但内容不是，按普通文本返回
            const textResp = new Response(text, { status: upstream.status, headers: upstream.headers });
            return finalize(buildPassthrough(textResp, cfg.apiTtl, cache, cacheKey, waitUntil, upstreamCacheStatus), request.method === 'HEAD');
        }

        // ---- 其他内容：流式透传 ----
        const isBinary = MEDIA_CONTENT_TYPES.some(t => contentType.startsWith(t)) ||
            MEDIA_FILE_EXTENSIONS.some(ext => pathname.endsWith(ext));
        const ttl = isBinary ? cfg.mediaTtl : (isDetailRequest(targetUrl) ? cfg.detailTtl : cfg.apiTtl);
        return finalize(buildPassthrough(upstream, ttl, cache, cacheKey, waitUntil, upstreamCacheStatus), request.method === 'HEAD');

    } catch (error) {
        const timeout = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        log(`代理失败: ${targetUrl} - ${error.message}`);
        return errorResponse(timeout ? '上游请求超时' : `代理处理错误: ${error.message}`, timeout ? 504 : 502);
    }

    // ============ 内部函数 ============

    async function processM3u8(sourceUrl, content, depth, cfg, log) {
        const isMaster = content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA:');
        if (!isMaster) return processMediaPlaylist(sourceUrl, content);
        if (cfg.flatten) return processMasterPlaylist(sourceUrl, content, depth, cfg, log);
        // 默认：保留全部码率 / 音轨 / 字幕，只把地址改写为代理地址，由播放器自适应选择
        log(`主列表按多码率重写: ${sourceUrl}`);
        return rewriteMasterPlaylist(sourceUrl, content);
    }

    async function processMasterPlaylist(sourceUrl, content, depth, cfg, log) {
        if (depth > cfg.maxRecursion) {
            throw new Error(`m3u8 递归层数过多 (${cfg.maxRecursion}): ${sourceUrl}`);
        }
        const baseUrl = getBaseUrl(sourceUrl);
        const lines = content.split('\n');
        let bestBandwidth = -1;
        let bestVariantUrl = '';

        for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
            const m = lines[i].match(/BANDWIDTH=(\d+)/);
            const bw = m ? parseInt(m[1], 10) : 0;
            for (let j = i + 1; j < lines.length; j++) {
                const l = lines[j].trim();
                if (l && !l.startsWith('#')) {
                    if (bw >= bestBandwidth) {
                        bestBandwidth = bw;
                        bestVariantUrl = resolveUrl(baseUrl, l);
                    }
                    i = j;
                    break;
                }
            }
        }
        if (!bestVariantUrl) {
            const first = lines.map(l => l.trim()).find(l => l && !l.startsWith('#') && /\.m3u8(\?|$)/.test(l));
            if (first) bestVariantUrl = resolveUrl(baseUrl, first);
        }
        if (!bestVariantUrl) {
            log(`主列表未找到子列表，按媒体列表处理: ${sourceUrl}`);
            return processMediaPlaylist(sourceUrl, content);
        }

        // 子列表也走边缘缓存
        const variantKey = new Request(`${url.origin}/proxy/${encodeURIComponent(bestVariantUrl)}`, { method: 'GET' });
        const cached = await cache.match(variantKey);
        if (cached) {
            log(`子列表缓存命中: ${bestVariantUrl}`);
            return cached.text();
        }

        log(`选择子列表 (bandwidth=${bestBandwidth}): ${bestVariantUrl}`);
        const resp = await fetchUpstream(bestVariantUrl, cfg, { cacheTtl: cfg.m3u8Ttl });
        if (!resp.ok) throw new Error(`子列表请求失败 ${resp.status}: ${bestVariantUrl}`);
        const variantText = await resp.text();
        if (!variantText.trim().startsWith('#EXTM3U')) {
            return processMediaPlaylist(bestVariantUrl, variantText);
        }
        const processed = await processM3u8(bestVariantUrl, variantText, depth + 1, cfg, log);
        waitUntil(cache.put(variantKey, new Response(processed, {
            headers: {
                ...CORS_HEADERS,
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Cache-Control': `public, max-age=${cfg.m3u8Ttl}`
            }
        })));
        return processed;
    }
}

// ============ 模块级纯函数 ============

function readConfig(env) {
    const int = (v, d) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n >= 0 ? n : d;
    };
    let userAgents = DEFAULT_USER_AGENTS;
    try {
        const parsed = env.USER_AGENTS_JSON ? JSON.parse(env.USER_AGENTS_JSON) : null;
        if (Array.isArray(parsed) && parsed.length) userAgents = parsed;
    } catch (_) { /* 使用默认 */ }
    return {
        debug: env.DEBUG === 'true',
        apiTtl: int(env.API_CACHE_TTL, 600),
        detailTtl: int(env.DETAIL_CACHE_TTL, 1800),
        mediaTtl: int(env.MEDIA_CACHE_TTL, int(env.CACHE_TTL, 86400)),
        m3u8Ttl: int(env.M3U8_CACHE_TTL, 300),
        upstreamTimeout: int(env.UPSTREAM_TIMEOUT, 10000),
        maxRecursion: int(env.MAX_RECURSION, 5),
        flatten: env.M3U8_FLATTEN === 'true',
        userAgents
    };
}

function getTargetUrlFromPath(pathname) {
    const encoded = pathname.replace(/^\/proxy\//, '');
    if (!encoded) return null;
    let decoded;
    try {
        decoded = decodeURIComponent(encoded);
    } catch (_) {
        decoded = encoded;
    }
    if (/^https?:\/\//i.test(decoded)) return decoded;
    if (/^https?:\/\//i.test(encoded)) return encoded;
    return null;
}

// 拒绝明显的内网 / 环回 / 云元数据地址，避免被当作 SSRF 跳板
function isBlockedTarget(targetUrl) {
    let host;
    try {
        host = new URL(targetUrl).hostname.toLowerCase();
    } catch (_) {
        return '无效 URL';
    }
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
        return '本地地址';
    }
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return '元数据地址';
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
        if (a === 10 || a === 127 || a === 0 ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 169 && b === 254) ||
            (a === 100 && b >= 64 && b <= 127)) {
            return '私有网段';
        }
    }
    if (host.startsWith('[')) {
        const v6 = host.slice(1, -1);
        if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return '私有 IPv6';
    }
    return null;
}

function pickReferer(targetUrl) {
    const u = new URL(targetUrl);
    const host = u.hostname.toLowerCase();
    // 豆瓣接口和图片的防盗链需要 douban 来源
    if (host.endsWith('douban.com') || host.endsWith('doubanio.com')) {
        return 'https://movie.douban.com/';
    }
    return `${u.origin}/`;
}

async function fetchUpstream(targetUrl, cfg, { range, cacheTtl = 0 } = {}) {
    const headers = new Headers({
        'User-Agent': cfg.userAgents[Math.floor(Math.random() * cfg.userAgents.length)],
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': pickReferer(targetUrl)
    });
    if (range) headers.set('Range', range);
    const init = {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(cfg.upstreamTimeout)
    };
    // L2：让子请求走 Cloudflare CDN 缓存（按上游 URL 作键；Range 请求不缓存）
    if (cacheTtl > 0 && !range) {
        init.cf = { cacheTtl, cacheEverything: true };
    }
    return fetch(targetUrl, init);
}

// 采集站详情请求：?ac=videolist&ids=… / ?ac=detail&ids=…
function isDetailRequest(targetUrl) {
    try {
        const sp = new URL(targetUrl).searchParams;
        return sp.has('ids') || sp.get('ac') === 'detail';
    } catch (_) { return false; }
}

// 回源前按 URL 形态估算 L2 TTL（此时还没有 Content-Type）
function guessTtl(targetUrl, pathname, cfg) {
    if (/\.m3u8$/.test(pathname)) return cfg.m3u8Ttl;
    if (MEDIA_FILE_EXTENSIONS.some(ext => pathname.endsWith(ext))) return cfg.mediaTtl;
    return isDetailRequest(targetUrl) ? cfg.detailTtl : cfg.apiTtl;
}

function looksLikeM3u8(pathname, contentType) {
    if (M3U8_CONTENT_TYPES.some(t => contentType.includes(t))) return true;
    return /\.m3u8$/.test(pathname);
}

// 构造流式透传响应；200 响应异步写入边缘缓存
function buildPassthrough(upstream, ttl, cache, cacheKey, waitUntil, upstreamCacheStatus) {
    const headers = new Headers(CORS_HEADERS);
    for (const name of PASSTHROUGH_HEADERS) {
        const v = upstream.headers.get(name);
        if (v) headers.set(name, v);
    }
    headers.set('Cache-Control', `public, max-age=${ttl}`);
    headers.set('X-Proxy-Cache', 'MISS');
    if (upstreamCacheStatus) headers.set('X-Upstream-Cache', upstreamCacheStatus);

    const resp = new Response(upstream.body, { status: upstream.status, headers });
    if (upstream.status === 200 && ttl > 0) {
        waitUntil(cache.put(cacheKey, resp.clone()));
    }
    return resp;
}

function withHeaders(resp, extra, headOnly) {
    const headers = new Headers(resp.headers);
    for (const k of Object.keys(CORS_HEADERS)) headers.set(k, CORS_HEADERS[k]);
    for (const k of Object.keys(extra)) headers.set(k, extra[k]);
    return new Response(headOnly ? null : resp.body, { status: resp.status, headers });
}

function finalize(resp, headOnly) {
    return headOnly ? new Response(null, { status: resp.status, headers: resp.headers }) : resp;
}

function errorResponse(message, status) {
    return new Response(message, {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

function getBaseUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        if (!u.pathname || u.pathname === '/') return `${u.origin}/`;
        const parts = u.pathname.split('/');
        parts.pop();
        return `${u.origin}${parts.join('/')}/`;
    } catch (_) {
        const i = urlStr.lastIndexOf('/');
        return i > urlStr.indexOf('://') + 2 ? urlStr.substring(0, i + 1) : urlStr + '/';
    }
}

function resolveUrl(baseUrl, relativeUrl) {
    if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
    try {
        return new URL(relativeUrl, baseUrl).toString();
    } catch (_) {
        if (relativeUrl.startsWith('/')) return `${new URL(baseUrl).origin}${relativeUrl}`;
        return `${baseUrl.replace(/\/[^/]*$/, '/')}${relativeUrl}`;
    }
}

function rewriteUrlToProxy(targetUrl) {
    return `/proxy/${encodeURIComponent(targetUrl)}`;
}

function rewriteUriAttribute(line, baseUrl) {
    return line.replace(/URI="([^"]+)"/, (_, uri) => `URI="${rewriteUrlToProxy(resolveUrl(baseUrl, uri))}"`);
}

// 主列表：重写 variant 地址与各类 URI= 属性，保留结构不变
function rewriteMasterPlaylist(sourceUrl, content) {
    const baseUrl = getBaseUrl(sourceUrl);
    const lines = content.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (i === lines.length - 1) out.push('');
            continue;
        }
        if (line.startsWith('#')) {
            // #EXT-X-MEDIA / #EXT-X-I-FRAME-STREAM-INF / #EXT-X-SESSION-KEY 等带 URI 的标签
            out.push(/URI="/.test(line) ? rewriteUriAttribute(line, baseUrl) : line);
        } else {
            out.push(rewriteUrlToProxy(resolveUrl(baseUrl, line)));
        }
    }
    return out.join('\n');
}

function processMediaPlaylist(sourceUrl, content) {
    const baseUrl = getBaseUrl(sourceUrl);
    const lines = content.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            if (i === lines.length - 1) out.push('');
            continue;
        }
        if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
            out.push(rewriteUriAttribute(line, baseUrl));
        } else if (line.startsWith('#')) {
            out.push(line);
        } else {
            out.push(rewriteUrlToProxy(resolveUrl(baseUrl, line)));
        }
    }
    return out.join('\n');
}
