// 单个采集源的关键词搜索
//
// 性能策略：
//   1. 第一页一到就通过 onBatch 回调交给页面渲染，不等待后续分页；
//   2. 后续分页数量受 API_CONFIG.search.maxPages 限制，并且按 pageConcurrency 分批拉取，
//      避免一次搜索对单个源发出几十个并发请求；
//   3. 同源内按 vod_id 去重，防止采集站分页重叠导致重复卡片。
//
// 兼容旧调用方式：不传 onBatch 时，函数返回该源的全部结果数组。
async function searchByAPIAndKeyWord(apiId, query, externalSignal, onBatch) {
    const collected = [];
    const emit = (items) => {
        if (!items || items.length === 0) return;
        if (typeof onBatch === 'function') {
            onBatch(items);
        } else {
            collected.push(...items);
        }
    };

    try {
        let apiBaseUrl, apiName, apiUrlOfCustom;

        if (apiId.startsWith('custom_')) {
            const customApi = getCustomApiInfo(apiId.replace('custom_', ''));
            if (!customApi) return collected;
            apiBaseUrl = customApi.url;
            apiName = customApi.name;
            apiUrlOfCustom = customApi.url;
        } else {
            if (!API_SITES[apiId]) return collected;
            apiBaseUrl = API_SITES[apiId].api;
            apiName = API_SITES[apiId].name;
        }

        const searchCfg = API_CONFIG.search;
        const perRequestTimeout = searchCfg.timeout || 10000;
        const maxPages = Math.max(1, searchCfg.maxPages || 1);
        const pageConcurrency = Math.max(1, searchCfg.pageConcurrency || 2);
        const seenIds = new Set();

        const decorate = (list) => {
            const out = [];
            for (const item of list) {
                const key = item && item.vod_id != null ? String(item.vod_id) : null;
                if (key) {
                    if (seenIds.has(key)) continue;
                    seenIds.add(key);
                }
                out.push({
                    ...item,
                    source_name: apiName,
                    source_code: apiId,
                    api_url: apiUrlOfCustom
                });
            }
            return out;
        };

        // 单页请求：把外部取消信号与本地超时联动
        const fetchPage = async (page) => {
            const controller = new AbortController();
            const onAbort = () => controller.abort();
            if (externalSignal) {
                if (externalSignal.aborted) return null;
                externalSignal.addEventListener('abort', onAbort, { once: true });
            }
            const timeoutId = setTimeout(() => controller.abort(), perRequestTimeout);
            try {
                const target = page === 1
                    ? apiBaseUrl + searchCfg.path + encodeURIComponent(query)
                    : apiBaseUrl + searchCfg.pagePath
                        .replace('{query}', encodeURIComponent(query))
                        .replace('{page}', page);
                const response = await fetch(PROXY_URL + encodeURIComponent(target), {
                    headers: searchCfg.headers,
                    signal: controller.signal
                });
                if (!response.ok) return null;
                const data = await response.json();
                if (!data || !Array.isArray(data.list)) return null;
                return data;
            } catch (error) {
                if (!(error && error.name === 'AbortError')) {
                    console.warn(`API ${apiId} 第${page}页搜索失败:`, error);
                }
                return null;
            } finally {
                clearTimeout(timeoutId);
                if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
            }
        };

        // 第一页：立即渲染
        const first = await fetchPage(1);
        if (!first || first.list.length === 0) return collected;
        emit(decorate(first.list));

        // 后续分页：有上限、有并发限制、逐批渲染
        const pageCount = parseInt(first.pagecount, 10) || 1;
        const lastPage = Math.min(pageCount, maxPages);
        if (lastPage <= 1) return collected;

        let nextPage = 2;
        const pageWorker = async () => {
            while (nextPage <= lastPage) {
                if (externalSignal && externalSignal.aborted) return;
                const page = nextPage++;
                const data = await fetchPage(page);
                if (externalSignal && externalSignal.aborted) return;
                if (data && data.list.length > 0) {
                    emit(decorate(data.list));
                } else if (!data) {
                    // 该页失败/为空，通常意味着后面也没有内容，提前结束
                    return;
                }
            }
        };
        const workers = [];
        for (let i = 0; i < Math.min(pageConcurrency, lastPage - 1); i++) {
            workers.push(pageWorker());
        }
        await Promise.all(workers);

        return collected;
    } catch (error) {
        if (!(error && error.name === 'AbortError')) {
            console.warn(`API ${apiId} 搜索失败:`, error);
        }
        return collected;
    }
}
