// 采集源健康状态（由 scripts/check-sources.mjs 定时生成 data/source-health.json）
//
// 状态含义：
//   ok       接口可用且 m3u8 可拉取
//   api_only 接口可用，但巡检节点无法拉取 m3u8（多为地域限制，国内用户可能正常）
//   down     接口不可用
//   unknown  没有巡检数据（自定义源 / 新增源 / 文件加载失败）
(function () {
    const STORAGE_KEY = 'sourceHealthCache';
    const MAX_AGE = 6 * 60 * 60 * 1000; // 本地缓存 6 小时，避免每次打开都请求

    let data = null;
    let loadPromise = null;

    function readLocal() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE) return null;
            return parsed.data;
        } catch (_) {
            return null;
        }
    }

    function writeLocal(d) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), data: d }));
        } catch (_) { /* 忽略配额错误 */ }
    }

    // 加载健康数据；timeoutMs 内没拿到就先返回 null，不阻塞页面
    function load(timeoutMs = 2500) {
        if (data) return Promise.resolve(data);
        if (!loadPromise) {
            const cached = readLocal();
            if (cached) {
                data = cached;
                loadPromise = Promise.resolve(cached);
            } else {
                loadPromise = fetch('data/source-health.json', { cache: 'no-cache' })
                    .then(r => (r.ok ? r.json() : null))
                    .then(d => {
                        if (d && d.sources) {
                            data = d;
                            writeLocal(d);
                        }
                        return data;
                    })
                    .catch(() => null);
            }
        }
        const timeout = new Promise(resolve => setTimeout(() => resolve(data), timeoutMs));
        return Promise.race([loadPromise, timeout]);
    }

    function entry(apiKey) {
        return data && data.sources ? data.sources[apiKey] : null;
    }

    function status(apiKey) {
        const e = entry(apiKey);
        if (!e) return 'unknown';
        if (e.play_ok) return 'ok';
        if (e.api_ok) return 'api_only';
        return 'down';
    }

    const RANK = { ok: 0, unknown: 1, api_only: 2, down: 3 };

    // 按健康度 + 延迟排序，用于决定搜索顺序（健康快的源先出结果）
    function sortByHealth(apiKeys) {
        return [...apiKeys].sort((a, b) => {
            const ra = RANK[status(a)], rb = RANK[status(b)];
            if (ra !== rb) return ra - rb;
            const la = (entry(a) || {}).latency ?? 99999;
            const lb = (entry(b) || {}).latency ?? 99999;
            return la - lb;
        });
    }

    // 推荐的默认源：可播放的源；不足 minCount 时用「仅接口可用」补齐
    function recommendedKeys(allKeys, minCount = 6) {
        const ok = sortByHealth(allKeys.filter(k => status(k) === 'ok'));
        if (ok.length >= minCount) return ok;
        const apiOnly = sortByHealth(allKeys.filter(k => status(k) === 'api_only'));
        return ok.concat(apiOnly).slice(0, Math.max(minCount, ok.length));
    }

    const LABEL = {
        ok: { text: '可用', cls: 'bg-green-500', title: '接口正常，播放地址可访问' },
        api_only: { text: '受限', cls: 'bg-yellow-500', title: '接口正常，但海外巡检节点无法访问其播放地址（国内网络可能正常）' },
        down: { text: '异常', cls: 'bg-red-500', title: '接口无响应或返回格式错误' },
        unknown: { text: '', cls: 'bg-gray-600', title: '暂无巡检数据' }
    };

    // 创建一个状态圆点元素
    function badge(apiKey) {
        const s = status(apiKey);
        const e = entry(apiKey);
        const span = document.createElement('span');
        span.className = `inline-block w-1.5 h-1.5 rounded-full ml-1 flex-shrink-0 ${LABEL[s].cls}`;
        let title = LABEL[s].title;
        if (e) {
            if (e.latency != null) title += `，响应 ${e.latency}ms`;
            if (e.error) title += `，${e.error}`;
            if (e.checked_at) title += `（${new Date(e.checked_at).toLocaleString()}）`;
        }
        span.title = title;
        span.setAttribute('aria-label', LABEL[s].text || '未知');
        return span;
    }

    function generatedAt() {
        return data && data.generated_at ? new Date(data.generated_at) : null;
    }

    window.SourceHealth = { load, status, entry, sortByHealth, recommendedKeys, badge, generatedAt, get data() { return data; } };
})();
