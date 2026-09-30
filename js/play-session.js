// 播放会话：把"正在播什么"的状态从一组全局 localStorage 键改为按会话 ID 隔离的对象。
//
// 背景：旧实现把片名 / 剧集列表 / 当前源写在 currentVideoTitle、currentEpisodes 等全局键里，
// 多个标签页同时播放不同影片时会互相覆盖（A 标签页点"下一集"跳到 B 的剧）。
//
// 设计：
//   - 每次进入播放器都生成一个会话 { id, title, sourceCode, vodId, episodes, index, createdAt }
//   - 会话同时写入 sessionStorage（本标签页最快路径）和 localStorage 的 LRU 表（跨标签页 / 刷新 / 历史记录恢复）
//   - 播放页通过 URL 参数 sid 找回会话；找不到时退回旧的 URL 参数方式，保证旧链接可用
(function () {
    const LRU_KEY = 'playSessions';
    const LRU_MAX = 30;
    const SS_PREFIX = 'ps:';

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function readLru() {
        try {
            const raw = localStorage.getItem(LRU_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function writeLru(arr) {
        try {
            localStorage.setItem(LRU_KEY, JSON.stringify(arr.slice(0, LRU_MAX)));
        } catch (e) {
            // 配额不足时丢弃最旧的一半再试一次
            try { localStorage.setItem(LRU_KEY, JSON.stringify(arr.slice(0, Math.ceil(LRU_MAX / 2)))); } catch (_) { /* 放弃 */ }
        }
    }

    function persist(session) {
        try { sessionStorage.setItem(SS_PREFIX + session.id, JSON.stringify(session)); } catch (_) { /* 忽略 */ }
        const arr = readLru().filter(s => s && s.id !== session.id);
        arr.unshift(session);
        writeLru(arr);
    }

    function normalize(input) {
        return {
            id: input.id || genId(),
            title: String(input.title || '未知视频'),
            sourceCode: String(input.sourceCode || ''),
            vodId: input.vodId != null ? String(input.vodId) : '',
            episodes: Array.isArray(input.episodes) ? input.episodes.filter(Boolean).map(String) : [],
            index: Number.isInteger(input.index) && input.index >= 0 ? input.index : 0,
            createdAt: input.createdAt || Date.now(),
            updatedAt: Date.now()
        };
    }

    // 创建并保存会话，返回会话对象
    function create(input) {
        const session = normalize(input);
        persist(session);
        return session;
    }

    // 按 id 取会话（先本标签页，再全局 LRU）
    function get(id) {
        if (!id) return null;
        try {
            const raw = sessionStorage.getItem(SS_PREFIX + id);
            if (raw) return JSON.parse(raw);
        } catch (_) { /* 继续 */ }
        return readLru().find(s => s && s.id === id) || null;
    }

    // 局部更新（如切集后更新 index）
    function update(id, patch) {
        const cur = get(id);
        if (!cur) return null;
        const next = normalize({ ...cur, ...patch, id: cur.id, createdAt: cur.createdAt });
        persist(next);
        return next;
    }

    // 生成播放页地址。除了 sid 之外仍带上 url/title/source/id/index，
    // 这样链接可分享、可收藏，且在会话被淘汰后仍能按旧方式播放。
    function buildPlayerUrl(session, options = {}) {
        const index = Number.isInteger(options.index) ? options.index : session.index;
        const url = session.episodes[index] || session.episodes[0] || '';
        const params = new URLSearchParams();
        params.set('sid', session.id);
        params.set('url', url);
        params.set('title', session.title);
        params.set('index', String(index));
        if (session.sourceCode) params.set('source', session.sourceCode);
        if (session.vodId) params.set('id', session.vodId);
        if (options.position > 0) params.set('position', String(Math.floor(options.position)));
        if (options.returnUrl) params.set('returnUrl', options.returnUrl);
        return 'player?' + params.toString();
    }

    // 返回地址按标签页保存（不再用 localStorage，避免多标签互相干扰）
    function setReturnUrl(url) {
        try { if (url) sessionStorage.setItem('returnUrl', url); } catch (_) { /* 忽略 */ }
    }
    function getReturnUrl() {
        try { return sessionStorage.getItem('returnUrl') || ''; } catch (_) { return ''; }
    }

    // 一次性清理旧版遗留的全局键
    function cleanupLegacyKeys() {
        ['currentVideoTitle', 'currentEpisodes', 'currentEpisodeIndex', 'currentSourceCode', 'lastPlayTime',
            'currentPlayingId', 'currentPlayingSource', 'lastSearchPage', 'cameFromSearch', 'searchPageUrl', 'lastPageUrl']
            .forEach(k => { try { localStorage.removeItem(k); } catch (_) { /* 忽略 */ } });
    }

    window.PlaySession = { create, get, update, buildPlayerUrl, setReturnUrl, getReturnUrl, cleanupLegacyKeys };
})();


// ================= 已看剧集标记 =================
// localStorage 'watchedEpisodes' = { <标题键>: [集索引...] }，跨源共用（按片名归一）。
(function () {
    const KEY = 'watchedEpisodes';
    const MAX_TITLES = 300;
    function titleKey(title) {
        return String(title || '').replace(/\s+/g, '').toLowerCase();
    }
    function readAll() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; }
    }
    function writeAll(obj) {
        try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (_) { /* 配额满时忽略 */ }
    }
    function get(title) {
        const list = readAll()[titleKey(title)];
        return new Set(Array.isArray(list) ? list : []);
    }
    function mark(title, index) {
        const k = titleKey(title);
        if (!k || !Number.isInteger(index) || index < 0) return;
        const all = readAll();
        const set = new Set(Array.isArray(all[k]) ? all[k] : []);
        if (set.has(index)) return;
        set.add(index);
        // 删除后重插，保证最近使用的在末尾；超量时淘汰最早的
        delete all[k];
        all[k] = [...set].sort((a, b) => a - b);
        const keys = Object.keys(all);
        if (keys.length > MAX_TITLES) keys.slice(0, keys.length - MAX_TITLES).forEach(x => delete all[x]);
        writeAll(all);
    }
    function isWatched(title, index) {
        return get(title).has(index);
    }
    window.WatchedEpisodes = { get, mark, isWatched, titleKey };
})();
