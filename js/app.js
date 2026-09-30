// 全局变量
let selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || '["tyyszy","dyttzy", "bfzy", "ruyi"]'); // 默认选中资源
let customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

// 添加当前播放的集数索引
let currentEpisodeIndex = 0;
// 添加当前视频的所有集数
let currentEpisodes = [];
// 添加当前视频的标题
let currentVideoTitle = '';
// 全局变量用于倒序状态
let episodesReversed = false;

// 页面初始化
document.addEventListener('DOMContentLoaded', async function () {
    // 首页「继续观看」（不依赖网络，最先渲染）
    renderContinueWatching();
    // 从播放页返回（含 bfcache 恢复）时刷新进度
    window.addEventListener('pageshow', () => renderContinueWatching());

    // 先尝试加载采集源健康数据（最多等 2.5 秒，失败不影响后续流程）
    if (window.SourceHealth) {
        try { await SourceHealth.load(2500); } catch (_) { /* 忽略 */ }
    }

    // Migrate installs that lost their built-in source selection when the source list was emptied.
    if (!localStorage.getItem('builtinSourcesRestored') &&
        !selectedAPIs.some(apiKey => API_SITES[apiKey] && !API_SITES[apiKey].adult)) {
        selectedAPIs = Object.keys(API_SITES).filter(apiKey => !API_SITES[apiKey].adult);
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
    }
    localStorage.setItem('builtinSourcesRestored', 'true');

    // 初始化API复选框
    initAPICheckboxes();

    // 初始化自定义API列表
    renderCustomAPIsList();

    // 初始化显示选中的API数量
    updateSelectedApiCount();

    // 渲染搜索历史
    renderSearchHistory();

    // 设置默认API选择（如果是第一次加载）
    if (!localStorage.getItem('hasInitializedDefaults')) {
        // 默认选中资源：优先使用巡检可用的源，没有巡检数据时退回固定列表
        const builtinKeys = Object.keys(API_SITES).filter(k => !API_SITES[k].adult);
        const recommended = window.SourceHealth && SourceHealth.data ? SourceHealth.recommendedKeys(builtinKeys, 6) : [];
        selectedAPIs = recommended.length ? recommended : ["zy360", "hong", "mdzy", "iqiyi", "ikun", "xigua"].filter(k => API_SITES[k]);
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
        initAPICheckboxes();
        updateSelectedApiCount();

        // 默认选中过滤开关
        localStorage.setItem('yellowFilterEnabled', 'true');
        localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, 'true');

        // 默认启用豆瓣功能
        localStorage.setItem('doubanEnabled', 'true');

        // 标记已初始化默认值
        localStorage.setItem('hasInitializedDefaults', 'true');
    }

    // 设置黄色内容过滤器开关初始状态
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.checked = localStorage.getItem('yellowFilterEnabled') === 'true';
    }

    // 聚合开关初始状态
    const aggregateToggle = document.getElementById('aggregateToggle');
    if (aggregateToggle) {
        aggregateToggle.checked = isAggregateEnabled();
        aggregateToggle.addEventListener('change', function (e) {
            localStorage.setItem('aggregateResultsEnabled', e.target.checked ? 'true' : 'false');
            const resultsArea = document.getElementById('resultsArea');
            if (resultsArea && !resultsArea.classList.contains('hidden')) {
                rerenderSearchResults();
            }
        });
    }

    // 设置广告过滤开关初始状态
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.checked = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true
    }

    // 设置事件监听器
    setupEventListeners();

    // 初始检查成人API选中状态
    setTimeout(checkAdultAPIsSelected, 100);
});

// 初始化API复选框
function initAPICheckboxes() {
    const container = document.getElementById('apiCheckboxes');
    container.innerHTML = '';

    // 添加普通API组标题
    const normaldiv = document.createElement('div');
    normaldiv.id = 'normaldiv';
    normaldiv.className = 'grid grid-cols-2 gap-2';
    const normalTitle = document.createElement('div');
    normalTitle.className = 'api-group-title';
    normalTitle.textContent = '普通资源';
    normaldiv.appendChild(normalTitle);

    // 创建普通API源的复选框
    Object.keys(API_SITES).forEach(apiKey => {
        const api = API_SITES[apiKey];
        if (api.adult) return; // 跳过成人内容API，稍后添加

        const checked = selectedAPIs.includes(apiKey);

        const checkbox = document.createElement('div');
        checkbox.className = 'flex items-center min-w-0';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = `api_${apiKey}`;
        input.className = 'form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333] flex-shrink-0';
        input.checked = checked;
        input.dataset.api = apiKey;
        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.className = 'ml-1 text-xs text-gray-400 truncate';
        label.textContent = api.name;
        checkbox.appendChild(input);
        checkbox.appendChild(label);
        if (window.SourceHealth) checkbox.appendChild(SourceHealth.badge(apiKey));
        normaldiv.appendChild(checkbox);

        // 添加事件监听器
        checkbox.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
    container.appendChild(normaldiv);

    // 显示巡检时间
    const siteStatus = document.getElementById('siteStatus');
    if (siteStatus && window.SourceHealth) {
        const at = SourceHealth.generatedAt();
        siteStatus.textContent = at ? `源巡检：${at.toLocaleDateString()}` : '';
    }

    // 添加成人API列表
    addAdultAPI();

    // 初始检查成人内容状态
    checkAdultAPIsSelected();
}

// 添加成人API列表
function addAdultAPI() {
    // 仅在隐藏设置为false时添加成人API组
    if (!HIDE_BUILTIN_ADULT_APIS && (localStorage.getItem('yellowFilterEnabled') === 'false')) {
        const container = document.getElementById('apiCheckboxes');

        // 添加成人API组标题
        const adultdiv = document.createElement('div');
        adultdiv.id = 'adultdiv';
        adultdiv.className = 'grid grid-cols-2 gap-2';
        const adultTitle = document.createElement('div');
        adultTitle.className = 'api-group-title adult';
        adultTitle.innerHTML = `黄色资源采集站 <span class="adult-warning">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </span>`;
        adultdiv.appendChild(adultTitle);

        // 创建成人API源的复选框
        Object.keys(API_SITES).forEach(apiKey => {
            const api = API_SITES[apiKey];
            if (!api.adult) return; // 仅添加成人内容API

            const checked = selectedAPIs.includes(apiKey);

            const checkbox = document.createElement('div');
            checkbox.className = 'flex items-center';
            checkbox.innerHTML = `
                <input type="checkbox" id="api_${apiKey}" 
                       class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333] api-adult" 
                       ${checked ? 'checked' : ''} 
                       data-api="${apiKey}">
                <label for="api_${apiKey}" class="ml-1 text-xs text-pink-400 truncate">${api.name}</label>
            `;
            adultdiv.appendChild(checkbox);

            // 添加事件监听器
            checkbox.querySelector('input').addEventListener('change', function () {
                updateSelectedAPIs();
                checkAdultAPIsSelected();
            });
        });
        container.appendChild(adultdiv);
    }
}

// 检查是否有成人API被选中
function checkAdultAPIsSelected() {
    // 查找所有内置成人API复选框
    const adultBuiltinCheckboxes = document.querySelectorAll('#apiCheckboxes .api-adult:checked');

    // 查找所有自定义成人API复选框
    const customApiCheckboxes = document.querySelectorAll('#customApisList .api-adult:checked');

    const hasAdultSelected = adultBuiltinCheckboxes.length > 0 || customApiCheckboxes.length > 0;

    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    const yellowFilterContainer = yellowFilterToggle.closest('div').parentNode;
    const filterDescription = yellowFilterContainer.querySelector('p.filter-description');

    // 如果选择了成人API，禁用黄色内容过滤器
    if (hasAdultSelected) {
        yellowFilterToggle.checked = false;
        yellowFilterToggle.disabled = true;
        localStorage.setItem('yellowFilterEnabled', 'false');

        // 添加禁用样式
        yellowFilterContainer.classList.add('filter-disabled');

        // 修改描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '<strong class="text-pink-300">选中黄色资源站时无法启用此过滤</strong>';
        }

        // 移除提示信息（如果存在）
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    } else {
        // 启用黄色内容过滤器
        yellowFilterToggle.disabled = false;
        yellowFilterContainer.classList.remove('filter-disabled');

        // 恢复原来的描述文字
        if (filterDescription) {
            filterDescription.innerHTML = '过滤"伦理片"等黄色内容';
        }

        // 移除提示信息
        const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }
    }
}

// 渲染自定义API列表
function renderCustomAPIsList() {
    const container = document.getElementById('customApisList');
    if (!container) return;

    if (customAPIs.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 text-center my-2">未添加自定义API</p>';
        return;
    }

    container.innerHTML = '';
    customAPIs.forEach((api, index) => {
        const apiItem = document.createElement('div');
        apiItem.className = 'flex items-center justify-between p-1 mb-1 bg-[#222] rounded';
        const textColorClass = api.isAdult ? 'text-pink-400' : 'text-white';
        const adultTag = api.isAdult ? '<span class="text-xs text-pink-400 mr-1">(18+)</span>' : '';
        // 新增 detail 地址显示
        const detailLine = api.detail ? `<div class="text-xs text-gray-400 truncate">detail: ${escapeHtml(api.detail)}</div>` : '';
        apiItem.innerHTML = `
            <div class="flex items-center flex-1 min-w-0">
                <input type="checkbox" id="custom_api_${index}" 
                       class="form-checkbox h-3 w-3 text-blue-600 mr-1 ${api.isAdult ? 'api-adult' : ''}" 
                       ${selectedAPIs.includes('custom_' + index) ? 'checked' : ''} 
                       data-custom-index="${index}">
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium ${textColorClass} truncate">
                        ${adultTag}${escapeHtml(api.name)}
                    </div>
                    <div class="text-xs text-gray-500 truncate">${escapeHtml(api.url)}</div>
                    ${detailLine}
                </div>
            </div>
            <div class="flex items-center">
                <button class="text-blue-500 hover:text-blue-700 text-xs px-1" onclick="editCustomApi(${index})">✎</button>
                <button class="text-red-500 hover:text-red-700 text-xs px-1" onclick="removeCustomApi(${index})">✕</button>
            </div>
        `;
        container.appendChild(apiItem);
        apiItem.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
}

// 编辑自定义API
function editCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const api = customAPIs[index];
    document.getElementById('customApiName').value = api.name;
    document.getElementById('customApiUrl').value = api.url;
    document.getElementById('customApiDetail').value = api.detail || '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = api.isAdult || false;
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
        const buttonContainer = form.querySelector('div:last-child');
        buttonContainer.innerHTML = `
            <button onclick="updateCustomApi(${index})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">更新</button>
            <button onclick="cancelEditCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
        `;
    }
}

// 更新自定义API
function updateCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);
    // 保存 detail 字段
    customAPIs[index] = { name, url, detail, isAdult };
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    renderCustomAPIsList();
    checkAdultAPIsSelected();
    restoreAddCustomApiButtons();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已更新自定义API: ' + name, 'success');
}

// 取消编辑自定义API
function cancelEditCustomApi() {
    // 清空表单
    document.getElementById('customApiName').value = '';
    document.getElementById('customApiUrl').value = '';
    document.getElementById('customApiDetail').value = '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = false;

    // 隐藏表单
    document.getElementById('addCustomApiForm').classList.add('hidden');

    // 恢复添加按钮
    restoreAddCustomApiButtons();
}

// 恢复自定义API添加按钮
function restoreAddCustomApiButtons() {
    const form = document.getElementById('addCustomApiForm');
    const buttonContainer = form.querySelector('div:last-child');
    buttonContainer.innerHTML = `
        <button onclick="addCustomApi()" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">添加</button>
        <button onclick="cancelAddCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
    `;
}

// 更新选中的API列表
function updateSelectedAPIs() {
    // 获取所有内置API复选框
    const builtInApiCheckboxes = document.querySelectorAll('#apiCheckboxes input:checked');

    // 获取选中的内置API
    const builtInApis = Array.from(builtInApiCheckboxes).map(input => input.dataset.api);

    // 获取选中的自定义API
    const customApiCheckboxes = document.querySelectorAll('#customApisList input:checked');
    const customApiIndices = Array.from(customApiCheckboxes).map(input => 'custom_' + input.dataset.customIndex);

    // 合并内置和自定义API
    selectedAPIs = [...builtInApis, ...customApiIndices];

    // 保存到localStorage
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 更新显示选中的API数量
    updateSelectedApiCount();
}

// 更新选中的API数量显示
function updateSelectedApiCount() {
    const countEl = document.getElementById('selectedApiCount');
    if (countEl) {
        countEl.textContent = selectedAPIs.length;
    }
}

// 全选或取消全选API
// 只勾选巡检可用的内置源（保留已勾选的自定义源）
function selectHealthyAPIs() {
    if (!window.SourceHealth || !SourceHealth.data) {
        showToast('暂无巡检数据，请稍后再试', 'warning');
        return;
    }
    const builtinKeys = Object.keys(API_SITES).filter(k => !API_SITES[k].adult);
    const healthy = SourceHealth.recommendedKeys(builtinKeys, 6);
    const custom = selectedAPIs.filter(k => k.startsWith('custom_'));
    document.querySelectorAll('#apiCheckboxes input[type="checkbox"]').forEach(cb => {
        if (cb.dataset.api) cb.checked = healthy.includes(cb.dataset.api);
    });
    selectedAPIs = healthy.concat(custom);
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
    updateSelectedApiCount();
    checkAdultAPIsSelected();
    const at = SourceHealth.generatedAt();
    showToast(`已选择 ${healthy.length} 个可用源${at ? `（巡检于 ${at.toLocaleDateString()}）` : ''}`, 'success');
}

function selectAllAPIs(selectAll = true, excludeAdult = false) {
    const checkboxes = document.querySelectorAll('#apiCheckboxes input[type="checkbox"]');

    checkboxes.forEach(checkbox => {
        if (excludeAdult && checkbox.classList.contains('api-adult')) {
            checkbox.checked = false;
        } else {
            checkbox.checked = selectAll;
        }
    });

    updateSelectedAPIs();
    checkAdultAPIsSelected();
}

// 显示添加自定义API表单
function showAddCustomApiForm() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
    }
}

// 取消添加自定义API - 修改函数来重用恢复按钮逻辑
function cancelAddCustomApi() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.add('hidden');
        document.getElementById('customApiName').value = '';
        document.getElementById('customApiUrl').value = '';
        document.getElementById('customApiDetail').value = '';
        const isAdultInput = document.getElementById('customApiIsAdult');
        if (isAdultInput) isAdultInput.checked = false;

        // 确保按钮是添加按钮
        restoreAddCustomApiButtons();
    }
}

// 添加自定义API
function addCustomApi() {
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    // 保存 detail 字段
    customAPIs.push({ name, url, detail, isAdult });
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    const newApiIndex = customAPIs.length - 1;
    selectedAPIs.push('custom_' + newApiIndex);
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();
    updateSelectedApiCount();
    checkAdultAPIsSelected();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已添加自定义API: ' + name, 'success');
}

// 移除自定义API
function removeCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;

    const apiName = customAPIs[index].name;

    // 从列表中移除API
    customAPIs.splice(index, 1);
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

    // 从选中列表中移除此API
    const customApiId = 'custom_' + index;
    selectedAPIs = selectedAPIs.filter(id => id !== customApiId);

    // 更新大于此索引的自定义API索引
    selectedAPIs = selectedAPIs.map(id => {
        if (id.startsWith('custom_')) {
            const currentIndex = parseInt(id.replace('custom_', ''));
            if (currentIndex > index) {
                return 'custom_' + (currentIndex - 1);
            }
        }
        return id;
    });

    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();

    // 更新选中的API数量
    updateSelectedApiCount();

    // 重新检查成人API选中状态
    checkAdultAPIsSelected();

    showToast('已移除自定义API: ' + apiName, 'info');
}

function toggleSettings(e) {
    const settingsPanel = document.getElementById('settingsPanel');
    if (!settingsPanel) return;

    if (settingsPanel.classList.contains('show')) {
        settingsPanel.classList.remove('show');
    } else {
        settingsPanel.classList.add('show');
    }

    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
}

// 设置事件监听器
function setupEventListeners() {
    // 回车搜索
    document.getElementById('searchInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            search();
        }
    });

    // 点击外部关闭设置面板和历史记录面板
    document.addEventListener('click', function (e) {
        // 关闭设置面板
        const settingsPanel = document.querySelector('#settingsPanel.show');
        const settingsButton = document.querySelector('#settingsPanel .close-btn');

        if (settingsPanel && settingsButton &&
            !settingsPanel.contains(e.target) &&
            !settingsButton.contains(e.target)) {
            settingsPanel.classList.remove('show');
        }

        // 关闭历史记录面板
        const historyPanel = document.querySelector('#historyPanel.show');
        const historyButton = document.querySelector('#historyPanel .close-btn');

        if (historyPanel && historyButton &&
            !historyPanel.contains(e.target) &&
            !historyButton.contains(e.target)) {
            historyPanel.classList.remove('show');
        }
    });

    // 黄色内容过滤开关事件绑定
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem('yellowFilterEnabled', e.target.checked);

            // 控制黄色内容接口的显示状态
            const adultdiv = document.getElementById('adultdiv');
            if (adultdiv) {
                if (e.target.checked === true) {
                    adultdiv.style.display = 'none';
                } else if (e.target.checked === false) {
                    adultdiv.style.display = ''
                }
            } else {
                // 添加成人API列表
                addAdultAPI();
            }
        });
    }

    // 广告过滤开关事件绑定
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, e.target.checked);
        });
    }
}

// 重置搜索区域
function resetSearchArea() {
    // 清理搜索结果
    document.getElementById('results').innerHTML = '';
    document.getElementById('searchInput').value = '';

    // 恢复搜索区域的样式
    document.getElementById('searchArea').classList.add('flex-1');
    document.getElementById('searchArea').classList.remove('mb-8');
    document.getElementById('resultsArea').classList.add('hidden');

    // 确保页脚正确显示，移除相对定位
    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.position = '';
    }

    renderContinueWatching();

    // 如果有豆瓣功能，检查是否需要显示豆瓣推荐区域
    if (typeof updateDoubanVisibility === 'function') {
        updateDoubanVisibility();
    }

    // 重置URL为主页
    try {
        window.history.pushState(
            {},
            `私人TV - 私人视频查看系统`,
            `/`
        );
        // 更新页面标题
        document.title = `私人TV - 私人视频查看系统`;
    } catch (e) {
        console.error('更新浏览器历史失败:', e);
    }
}

// 获取自定义API信息
function getCustomApiInfo(customApiIndex) {
    const index = parseInt(customApiIndex);
    if (isNaN(index) || index < 0 || index >= customAPIs.length) {
        return null;
    }
    return customAPIs[index];
}

// 搜索取消控制
let currentSearchAbortController = null;
let currentSearchToken = 0;
let lastSearchTriggeredAt = 0;

// ===================== 搜索结果渲染（同名聚合 + DOM 构建） =====================
// 不再用字符串拼接 HTML：所有来自采集站的字段都通过 textContent 写入，杜绝 XSS。

let searchResultItems = [];       // 本次搜索收到的全部原始结果
let searchGroups = new Map();     // 聚合键 -> group
let searchBannedKeywords = null;  // 黄色内容过滤词（搜索开始时确定）
let searchQueryKey = '';          // 当前搜索词的归一化形式，用于相关度排序

// 相关度：0 完全匹配，1 以搜索词开头，2 包含搜索词，3 其他
function relevanceRank(name) {
    if (!searchQueryKey) return 3;
    const key = normalizeTitleKey(name);
    if (key === searchQueryKey) return 0;
    if (key.startsWith(searchQueryKey)) return 1;
    if (key.includes(searchQueryKey)) return 2;
    return 3;
}

// 按相关度把卡片插到正确位置（同相关度按到达顺序）
function insertCardByRank(resultsDiv, card, rank) {
    card.dataset.rank = String(rank);
    const children = resultsDiv.children;
    for (let i = 0; i < children.length; i++) {
        if (Number(children[i].dataset.rank || 3) > rank) {
            resultsDiv.insertBefore(card, children[i]);
            return;
        }
    }
    resultsDiv.appendChild(card);
}

function isAggregateEnabled() {
    return localStorage.getItem('aggregateResultsEnabled') !== 'false';
}

// 生成聚合键：去空白、去标点、去括号内容、去常见画质/语言后缀
function normalizeTitleKey(name) {
    let t = String(name || '').toLowerCase();
    const stripped = t.replace(/[(（\[【][^)）\]】]*[)）\]】]/g, '');
    if (stripped.trim()) t = stripped;
    t = t
        .replace(/[\s\u3000]+/g, '')
        .replace(/[·\-—_:：!！?？,，。.、'"“”‘’()（）\[\]【】《》<>/\\|~～]/g, '')
        .replace(/(国语|粤语|中字|台配|日语|英语|原声)?(hd|bd|tc|ts|4k|1080p|720p|高清|蓝光|抢先|完整|正片|修复|重制|未删减|加长)?版?$/, '');
    return t || String(name || '').trim().toLowerCase();
}

function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
}

function resetSearchResults() {
    searchResultItems = [];
    searchGroups = new Map();
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) resultsDiv.textContent = '';
    updateSearchResultsCount();
}

function updateSearchResultsCount() {
    const el = document.getElementById('searchResultsCount');
    if (!el) return;
    if (isAggregateEnabled()) {
        el.textContent = `${searchGroups.size}`;
        const suffix = document.getElementById('searchResultsSuffix');
        if (suffix) suffix.textContent = searchResultItems.length > searchGroups.size ? `（来自 ${searchResultItems.length} 条源数据）` : '';
    } else {
        el.textContent = `${searchResultItems.length}`;
        const suffix = document.getElementById('searchResultsSuffix');
        if (suffix) suffix.textContent = '';
    }
}

function pickCover(items) {
    for (const it of items) {
        const pic = String(it.vod_pic || '');
        if (/^https?:\/\//i.test(pic)) return pic.replace(/^http:\/\//i, 'https://');
    }
    return '';
}

// 构建一张结果卡片（对应一个 group）
function buildResultCard(group) {
    const first = group.items[0];
    const cover = pickCover(group.items);

    const card = h('div', 'card-hover search-card bg-[#111] rounded-lg overflow-hidden cursor-pointer h-full shadow-sm');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    const open = () => openResultGroup(group);
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

    const row = h('div', 'flex h-full');
    card.appendChild(row);

    if (cover) {
        const imgWrap = h('div', 'relative flex-shrink-0 search-card-img-container');
        const img = h('img', 'h-full w-full object-cover transition-transform hover:scale-110');
        img.src = cover;
        img.alt = first.vod_name || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.setAttribute('fetchpriority', 'low');   // 海报让位于接口请求和脚本
        img.width = 100; img.height = 150;            // 与 .search-card-img-container 一致，避免布局跳动
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => {
            img.style.display = 'none';
            imgWrap.classList.add('bg-[#222]');
        }, { once: true });
        imgWrap.appendChild(img);
        imgWrap.appendChild(h('div', 'absolute inset-0 bg-gradient-to-r from-black/30 to-transparent'));
        row.appendChild(imgWrap);
    }

    const body = h('div', 'p-2 flex flex-col flex-grow');
    const grow = h('div', 'flex-grow');
    const title = h('h3', `font-semibold mb-2 break-words line-clamp-2 ${cover ? '' : 'text-center'}`, first.vod_name || '');
    title.title = first.vod_name || '';
    grow.appendChild(title);

    const tags = h('div', `flex flex-wrap ${cover ? '' : 'justify-center'} gap-1 mb-2`);
    group.typeEl = h('span', 'text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-blue-500 text-blue-300');
    group.yearEl = h('span', 'text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-purple-500 text-purple-300');
    tags.appendChild(group.typeEl);
    tags.appendChild(group.yearEl);
    grow.appendChild(tags);

    group.remarksEl = h('p', `text-gray-400 line-clamp-2 overflow-hidden ${cover ? '' : 'text-center'} mb-2`);
    grow.appendChild(group.remarksEl);
    body.appendChild(grow);

    const footer = h('div', 'flex justify-between items-center mt-1 pt-1 border-t border-gray-800 gap-1');
    group.sourceWrap = h('div', 'flex flex-wrap gap-1 min-w-0');
    group.countEl = h('span', 'text-xs text-gray-500 flex-shrink-0');
    footer.appendChild(group.sourceWrap);
    footer.appendChild(group.countEl);
    body.appendChild(footer);
    row.appendChild(body);

    group.el = card;
    refreshResultCard(group);
    return card;
}

// 用 group 内的全部条目刷新卡片上的可变信息
function refreshResultCard(group) {
    const items = group.items;
    const first = items[0];
    const typeName = items.map(i => i.type_name).find(Boolean) || '';
    const year = items.map(i => i.vod_year).find(Boolean) || '';
    const remarks = items.map(i => i.vod_remarks).find(Boolean) || '暂无介绍';

    group.typeEl.textContent = typeName;
    group.typeEl.style.display = typeName ? '' : 'none';
    group.yearEl.textContent = year;
    group.yearEl.style.display = year ? '' : 'none';
    group.remarksEl.textContent = remarks;

    group.sourceWrap.textContent = '';
    const names = [];
    const seen = new Set();
    for (const it of items) {
        if (it.source_name && !seen.has(it.source_name)) { seen.add(it.source_name); names.push(it.source_name); }
    }
    const MAX_CHIPS = 3;
    names.slice(0, MAX_CHIPS).forEach(n => {
        group.sourceWrap.appendChild(h('span', 'bg-[#222] text-xs px-1.5 py-0.5 rounded-full truncate max-w-[7rem]', n));
    });
    if (names.length > MAX_CHIPS) {
        group.sourceWrap.appendChild(h('span', 'bg-[#333] text-xs px-1.5 py-0.5 rounded-full', `+${names.length - MAX_CHIPS}`));
    }
    group.countEl.textContent = items.length > 1 ? `${items.length} 个源` : '';
    void first;
}

// 点击卡片：单源直接进详情，多源弹出选择
function openResultGroup(group) {
    if (group.items.length === 1 || !isAggregateEnabled()) {
        const it = group.items[0];
        showDetails(it.vod_id, it.vod_name, it.source_code);
        return;
    }
    showSourcePicker(group);
}

function showSourcePicker(group) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    if (!modal || !modalTitle || !modalContent) return;

    modalTitle.textContent = '';
    modalTitle.appendChild(h('span', 'break-words', group.items[0].vod_name || ''));
    modalTitle.appendChild(h('span', 'text-sm font-normal text-gray-400 ml-2', `选择播放源（${group.items.length}）`));

    modalContent.textContent = '';
    const tip = h('p', 'text-xs text-gray-500 mb-3', '同一部影片在多个源都有收录，请选择一个源查看剧集。绿点表示巡检可用，黄点表示海外巡检受限（国内网络可能正常）。');
    modalContent.appendChild(tip);

    const list = h('div', 'grid grid-cols-1 sm:grid-cols-2 gap-2');
    const ordered = window.SourceHealth
        ? [...group.items].sort((a, b) => {
            const rank = { ok: 0, unknown: 1, api_only: 2, down: 3 };
            return rank[SourceHealth.status(a.source_code)] - rank[SourceHealth.status(b.source_code)];
        })
        : group.items;

    ordered.forEach(it => {
        const btn = h('button', 'text-left p-3 bg-[#1a1a1a] hover:bg-[#252525] border border-[#333] hover:border-[#555] rounded-lg transition-colors');
        const head = h('div', 'flex items-center justify-between gap-2');
        const nameWrap = h('div', 'flex items-center min-w-0');
        nameWrap.appendChild(h('span', 'font-medium truncate', it.source_name || it.source_code || '未知源'));
        if (window.SourceHealth) nameWrap.appendChild(SourceHealth.badge(it.source_code));
        head.appendChild(nameWrap);
        if (it.vod_year) head.appendChild(h('span', 'text-xs text-gray-500 flex-shrink-0', it.vod_year));
        btn.appendChild(head);
        const meta = [it.type_name, it.vod_remarks].filter(Boolean).join(' · ');
        if (meta) btn.appendChild(h('div', 'text-xs text-gray-400 mt-1 truncate', meta));
        if (it.vod_name && it.vod_name !== group.items[0].vod_name) {
            btn.appendChild(h('div', 'text-xs text-gray-500 mt-0.5 truncate', it.vod_name));
        }
        btn.addEventListener('click', () => showDetails(it.vod_id, it.vod_name, it.source_code));
        list.appendChild(btn);
    });
    modalContent.appendChild(list);
    modal.classList.remove('hidden');
}

// 追加一批结果（搜索过程中每页调用一次）
function appendSearchBatch(results) {
    let filtered = results;
    if (searchBannedKeywords) {
        filtered = results.filter(item => {
            const typeName = item.type_name || '';
            return !searchBannedKeywords.some(keyword => typeName.includes(keyword));
        });
    }
    if (filtered.length === 0) return;

    const resultsDiv = document.getElementById('results');
    const aggregate = isAggregateEnabled();
    const touched = new Set();

    for (const item of filtered) {
        // 同源同 id 完全重复的条目直接丢弃
        const dupKey = `${item.source_code}:${item.vod_id}`;
        if (searchResultItems.some(x => `${x.source_code}:${x.vod_id}` === dupKey)) continue;
        searchResultItems.push(item);

        const key = aggregate ? normalizeTitleKey(item.vod_name) : dupKey;
        let group = searchGroups.get(key);
        if (!group) {
            group = { key, items: [item] };
            searchGroups.set(key, group);
            insertCardByRank(resultsDiv, buildResultCard(group), relevanceRank(item.vod_name));
        } else {
            group.items.push(item);
            touched.add(group);
        }
    }
    touched.forEach(refreshResultCard);
    updateSearchResultsCount();
}

// 切换聚合开关后，用已有数据重新渲染
function rerenderSearchResults() {
    const items = searchResultItems.slice();
    searchResultItems = [];
    searchGroups = new Map();
    const resultsDiv = document.getElementById('results');
    if (resultsDiv) resultsDiv.textContent = '';
    if (items.length) appendSearchBatch(items);
    updateSearchResultsCount();
}

function renderEmptySearchState() {
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = `
        <div class="col-span-full text-center py-16">
            <svg class="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 class="mt-2 text-lg font-medium text-gray-400">没有找到匹配的结果</h3>
            <p class="mt-1 text-sm text-gray-500">请尝试其他关键词或更换数据源</p>
        </div>
    `;
}

// 搜索功能 - 渐进式渲染，每个源返回后立即显示，限制并发并支持取消
async function search() {
    const query = document.getElementById('searchInput').value.trim();

    if (!query) {
        showToast('请输入搜索内容', 'info');
        return;
    }

    if (selectedAPIs.length === 0) {
        showToast('请至少选择一个API源', 'warning');
        return;
    }

    // Rocket Loader or IMEs can trigger the same search twice in quick succession.
    const now = Date.now();
    if (now - lastSearchTriggeredAt < 500) return;
    lastSearchTriggeredAt = now;

    // 取消上一次未完成的搜索
    if (currentSearchAbortController) {
        currentSearchAbortController.abort();
    }
    currentSearchAbortController = new AbortController();
    const signal = currentSearchAbortController.signal;
    const thisToken = ++currentSearchToken;

    showLoading();

    try {
        saveSearchHistory(query);

        // 显示结果区域，调整搜索区域
        document.getElementById('searchArea').classList.remove('flex-1');
        document.getElementById('searchArea').classList.add('mb-8');
        document.getElementById('resultsArea').classList.remove('hidden');
        hideContinueWatching();

        // 隐藏豆瓣推荐区域（如果存在）
        const doubanArea = document.getElementById('doubanArea');
        if (doubanArea) {
            doubanArea.classList.add('hidden');
        }

        resetSearchResults();
        searchQueryKey = normalizeTitleKey(query);

        // 更新URL和标题（只设置一次）
        try {
            const encodedQuery = encodeURIComponent(query);
            window.history.pushState(
                { search: query },
                `搜索: ${query} - 私人TV`,
                `/s=${encodedQuery}`
            );
            document.title = `搜索: ${query} - 私人TV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }

        // 黄色内容过滤
        const yellowFilterEnabled = localStorage.getItem('yellowFilterEnabled') === 'true';
        searchBannedKeywords = yellowFilterEnabled ?
            ['伦理片', '福利', '里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒', 'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'SWAG', '网红主播', '色情片', '同性片', '福利视频', '福利片'] : null;

        // 健康、响应快的源排在前面，让首屏更快出现结果
        const orderedAPIs = window.SourceHealth ? SourceHealth.sortByHealth(selectedAPIs) : selectedAPIs.slice();

        // 并发限制的多源搜索；每个源的每一页结果到达后立即渲染
        const MAX_CONCURRENT = (typeof AGGREGATED_SEARCH_CONFIG !== 'undefined' && AGGREGATED_SEARCH_CONFIG.sourceConcurrency) || 6;
        let nextIndex = 0;
        const onBatch = (results) => {
            if (signal.aborted) return;
            if (Array.isArray(results) && results.length > 0) {
                appendSearchBatch(results);
            }
        };

        async function worker() {
            while (nextIndex < orderedAPIs.length) {
                if (signal.aborted) return;
                const apiId = orderedAPIs[nextIndex++];
                try {
                    await searchByAPIAndKeyWord(apiId, query, signal, onBatch);
                } catch (err) {
                    if (!signal.aborted) {
                        console.warn(`API ${apiId} 搜索失败:`, err);
                    }
                }
            }
        }

        const workerCount = Math.min(MAX_CONCURRENT, orderedAPIs.length);
        const workers = [];
        for (let i = 0; i < workerCount; i++) {
            workers.push(worker());
        }
        await Promise.all(workers);

        if (signal.aborted) return;

        // 全部源完成后如果没有结果，显示空状态
        if (searchResultItems.length === 0) {
            renderEmptySearchState();
        }
    } catch (error) {
        if (!signal.aborted) {
            console.error('搜索错误:', error);
            if (error.name === 'AbortError') {
                showToast('搜索请求超时，请检查网络连接', 'error');
            } else {
                showToast('搜索请求失败，请稍后重试', 'error');
            }
        }
    } finally {
        if (thisToken === currentSearchToken) {
            hideLoading();
        }
    }
}

// 切换清空按钮的显示状态
function toggleClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearButton = document.getElementById('clearSearchInput');
    if (searchInput.value !== '') {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// 清空搜索框内容
function clearSearchInput() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    const clearButton = document.getElementById('clearSearchInput');
    clearButton.classList.add('hidden');
}

// 劫持搜索框的value属性以检测外部修改
function hookInput() {
    const input = document.getElementById('searchInput');
    const existingDescriptor = Object.getOwnPropertyDescriptor(input, 'value');
    if (existingDescriptor && existingDescriptor.get && existingDescriptor.set) {
        return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // 重写 value 属性的 getter 和 setter
    Object.defineProperty(input, 'value', {
        get: function () {
            // 确保读取时返回字符串（即使原始值为 undefined/null）
            const originalValue = descriptor.get.call(this);
            return originalValue != null ? String(originalValue) : '';
        },
        set: function (value) {
            // 显式将值转换为字符串后写入
            const strValue = String(value);
            descriptor.set.call(this, strValue);
            this.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // 初始化输入框值为空字符串（避免初始值为 undefined）
    input.value = '';
}
document.addEventListener('DOMContentLoaded', hookInput);

// 显示详情 - 修改为支持自定义API
async function showDetails(id, vod_name, sourceCode) {
    if (!id) {
        showToast('视频ID无效', 'error');
        return;
    }

    showLoading();
    try {
        // 构建API参数
        let apiParams = '';

        // 处理自定义API源
        if (sourceCode.startsWith('custom_')) {
            const customIndex = sourceCode.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                showToast('自定义API配置无效', 'error');
                hideLoading();
                return;
            }
            // 传递 detail 字段
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            // 内置API
            apiParams = '&source=' + sourceCode;
        }

        // Add a timestamp to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        const response = await fetch(`/api/detail?id=${encodeURIComponent(id)}${apiParams}${cacheBuster}`);

        const data = await response.json();

        const modal = document.getElementById('modal');
        const modalTitle = document.getElementById('modalTitle');
        const modalContent = document.getElementById('modalContent');

        // 显示来源信息
        const sourceName = data.videoInfo && data.videoInfo.source_name ?
            ` <span class="text-sm font-normal text-gray-400">(${escapeHtml(data.videoInfo.source_name)})</span>` : '';

        // 不对标题进行截断处理，允许完整显示
        modalTitle.innerHTML = `<span class="break-words">${escapeHtml(vod_name || '未知视频')}</span>${sourceName}`;
        // 记录当前详情上下文，供剧集按钮使用（避免把数据拼进内联 JS）
        currentDetailContext = { sourceCode, vodId: id };
        currentVideoTitle = vod_name || '未知视频';

        if (data.episodes && data.episodes.length > 0) {
            // 构建详情信息HTML
            let detailInfoHtml = '';
            if (data.videoInfo) {
                // Prepare description text, strip HTML and trim whitespace
                const descriptionText = data.videoInfo.desc ? escapeHtml(decodeHtmlEntities(data.videoInfo.desc.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()) : '';
                const info = {};
                ['type', 'year', 'area', 'director', 'actor', 'remarks'].forEach(k => { info[k] = escapeHtml(data.videoInfo[k] || ''); });

                // Check if there's any actual grid content
                const hasGridContent = data.videoInfo.type || data.videoInfo.year || data.videoInfo.area || data.videoInfo.director || data.videoInfo.actor || data.videoInfo.remarks;

                if (hasGridContent || descriptionText) { // Only build if there's something to show
                    detailInfoHtml = `
                <div class="modal-detail-info">
                    ${hasGridContent ? `
                    <div class="detail-grid">
                        ${info.type ? `<div class="detail-item"><span class="detail-label">类型:</span> <span class="detail-value">${info.type}</span></div>` : ''}
                        ${info.year ? `<div class="detail-item"><span class="detail-label">年份:</span> <span class="detail-value">${info.year}</span></div>` : ''}
                        ${info.area ? `<div class="detail-item"><span class="detail-label">地区:</span> <span class="detail-value">${info.area}</span></div>` : ''}
                        ${info.director ? `<div class="detail-item"><span class="detail-label">导演:</span> <span class="detail-value">${info.director}</span></div>` : ''}
                        ${info.actor ? `<div class="detail-item"><span class="detail-label">主演:</span> <span class="detail-value">${info.actor}</span></div>` : ''}
                        ${info.remarks ? `<div class="detail-item"><span class="detail-label">备注:</span> <span class="detail-value">${info.remarks}</span></div>` : ''}
                    </div>` : ''}
                    ${descriptionText ? `
                    <div class="detail-desc">
                        <p class="detail-label">简介:</p>
                        <p class="detail-desc-content">${descriptionText}</p>
                    </div>` : ''}
                </div>
                `;
                }
            }

            currentEpisodes = data.episodes;
            currentEpisodeIndex = 0;

            modalContent.innerHTML = `
                ${detailInfoHtml}
                <div class="flex flex-wrap items-center justify-between mb-4 gap-2">
                    <div class="flex items-center gap-2">
                        <button onclick="toggleEpisodeOrder(${jsAttr(sourceCode)}, ${jsAttr(id)})" 
                                class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                            <svg class="w-4 h-4 transform ${episodesReversed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                            </svg>
                            <span>${episodesReversed ? '正序排列' : '倒序排列'}</span>
                        </button>
                        <span class="text-gray-400 text-sm">共 ${data.episodes.length} 集</span>
                    </div>
                    <button onclick="copyLinks()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                        复制链接
                    </button>
                </div>
                <div id="episodesGrid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    ${renderEpisodes(vod_name, sourceCode, id)}
                </div>
            `;
        } else {
            modalContent.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-red-400 mb-2">❌ 未找到播放资源</div>
                    <div class="text-gray-500 text-sm">该视频可能暂时无法播放，请尝试其他视频</div>
                </div>
            `;
        }

        modal.classList.remove('hidden');
    } catch (error) {
        console.error('获取详情错误:', error);
        showToast('获取详情失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}

// 更新播放视频函数，修改为使用/watch路径而不是直接打开player.html
// ================= 首页「继续观看」 =================
const CONTINUE_WATCHING_MAX = 8;

function hideContinueWatching() {
    const wrap = document.getElementById('continueWatching');
    if (wrap) wrap.classList.add('hidden');
}

function renderContinueWatching() {
    const wrap = document.getElementById('continueWatching');
    const list = document.getElementById('continueWatchingList');
    if (!wrap || !list) return;

    // 搜索结果展示中不显示
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea && !resultsArea.classList.contains('hidden')) {
        wrap.classList.add('hidden');
        return;
    }

    const history = (typeof getViewingHistory === 'function' ? getViewingHistory() : [])
        .filter(it => it && it.title && it.url)
        .slice(0, CONTINUE_WATCHING_MAX);
    if (history.length === 0) {
        wrap.classList.add('hidden');
        return;
    }

    list.textContent = '';
    history.forEach(item => {
        const card = h('button', 'cw-card');
        card.type = 'button';
        card.appendChild(h('div', 'cw-title', item.title));

        const total = Array.isArray(item.episodes) ? item.episodes.length : 0;
        const epText = Number.isInteger(item.episodeIndex) && total > 1
            ? `第 ${item.episodeIndex + 1}${total ? '/' + total : ''} 集`
            : (total > 1 ? `共 ${total} 集` : '');
        const meta = [epText, item.sourceName || ''].filter(Boolean).join(' · ');
        card.appendChild(h('div', 'cw-meta', meta || '\u00a0'));

        const pos = Number(item.playbackPosition) || 0;
        const dur = Number(item.duration) || 0;
        const bar = h('div', 'cw-bar');
        const fill = h('div', '');
        const pct = dur > 0 ? Math.min(100, Math.max(0, Math.round(pos / dur * 100))) : 0;
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
        card.title = dur > 0 && pos > 0
            ? `${item.title} · 已看 ${pct}%，点击继续`
            : `${item.title} · 点击继续`;

        card.addEventListener('click', () => {
            playFromHistory(item.url, item.title, Number(item.episodeIndex) || 0, pos);
        });
        list.appendChild(card);
    });
    wrap.classList.remove('hidden');
}

function playVideo(url, vod_name, sourceCode, episodeIndex = 0, vodId = '') {
    // 返回地址：当前页面（含搜索参数）
    const returnUrl = window.location.href;
    PlaySession.setReturnUrl(returnUrl);

    // 剧集列表：优先当前详情弹窗的列表；若点击的 URL 不在其中，则以该 URL 单独成会话
    let episodes = Array.isArray(currentEpisodes) && currentEpisodes.length ? currentEpisodes : [url];
    let index = episodeIndex;
    if (!episodes.includes(url)) {
        episodes = [url];
        index = 0;
    }

    const session = PlaySession.create({
        title: vod_name || '未知视频',
        sourceCode: sourceCode || '',
        vodId: vodId || '',
        episodes,
        index
    });

    // 直接进入播放器（不再经过 watch.html 的 3 秒中转页）
    window.location.href = PlaySession.buildPlayerUrl(session, { index, returnUrl });
}

// 弹出播放器页面
function showVideoPlayer(url) {
    // 在打开播放器前，隐藏详情弹窗
    const detailModal = document.getElementById('modal');
    if (detailModal) {
        detailModal.classList.add('hidden');
    }
    // 临时隐藏搜索结果和豆瓣区域，防止高度超出播放器而出现滚动条
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('doubanArea').classList.add('hidden');
    // 在框架中打开播放页面
    videoPlayerFrame = document.createElement('iframe');
    videoPlayerFrame.id = 'VideoPlayerFrame';
    videoPlayerFrame.className = 'fixed w-full h-screen z-40';
    videoPlayerFrame.src = url;
    document.body.appendChild(videoPlayerFrame);
    // 将焦点移入iframe
    videoPlayerFrame.focus();
}

// 关闭播放器页面
function closeVideoPlayer(home = false) {
    videoPlayerFrame = document.getElementById('VideoPlayerFrame');
    if (videoPlayerFrame) {
        videoPlayerFrame.remove();
        // 恢复搜索结果显示
        document.getElementById('resultsArea').classList.remove('hidden');
        // 关闭播放器时也隐藏详情弹窗
        const detailModal = document.getElementById('modal');
        if (detailModal) {
            detailModal.classList.add('hidden');
        }
        // 如果启用豆瓣区域则显示豆瓣区域
        if (localStorage.getItem('doubanEnabled') === 'true') {
            document.getElementById('doubanArea').classList.remove('hidden');
        }
    }
    if (home) {
        // 刷新主页
        window.location.href = '/'
    }
}

// 播放上一集
function playPreviousEpisode(sourceCode) {
    if (currentEpisodeIndex > 0) {
        const prevIndex = currentEpisodeIndex - 1;
        const prevUrl = currentEpisodes[prevIndex];
        playVideo(prevUrl, currentVideoTitle, sourceCode, prevIndex);
    }
}

// 播放下一集
function playNextEpisode(sourceCode) {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        const nextIndex = currentEpisodeIndex + 1;
        const nextUrl = currentEpisodes[nextIndex];
        playVideo(nextUrl, currentVideoTitle, sourceCode, nextIndex);
    }
}

// 处理播放器加载错误
function handlePlayerError() {
    hideLoading();
    showToast('视频播放加载失败，请尝试其他视频源', 'error');
}

// 辅助函数用于渲染剧集按钮（使用当前的排序状态）
// 当前详情弹窗的上下文（源、影片 id），由 showDetails 设置
let currentDetailContext = { sourceCode: '', vodId: '' };

// 剧集按钮点击入口：只传索引，数据从内存状态取，避免把 URL/片名拼进内联 JS
function playEpisodeFromDetail(realIndex) {
    const url = currentEpisodes[realIndex];
    if (!url) return;
    // 即时反馈：按钮进入 loading 态，并防止重复点击
    const btn = document.getElementById(`episode-${realIndex}`);
    if (btn) {
        if (btn.dataset.loading) return;
        btn.dataset.loading = '1';
        btn.classList.add('episode-btn-loading');
    }
    playVideo(url, currentVideoTitle, currentDetailContext.sourceCode, realIndex, currentDetailContext.vodId);
}

function renderEpisodes(vodName, sourceCode, vodId) {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    const watched = window.WatchedEpisodes ? WatchedEpisodes.get(vodName) : new Set();
    return episodes.map((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isWatched = watched.has(realIndex);
        return `
            <button id="episode-${realIndex}" onclick="playEpisodeFromDetail(${realIndex})" ${isWatched ? 'title="已看过"' : ''}
                    class="px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn${isWatched ? ' episode-watched' : ''}">
                ${realIndex + 1}
            </button>
        `;
    }).join('');
}

// 复制视频链接到剪贴板
function copyLinks() {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    const linkList = episodes.join('\r\n');
    navigator.clipboard.writeText(linkList).then(() => {
        showToast('播放链接已复制', 'success');
    }).catch(err => {
        showToast('复制失败，请检查浏览器权限', 'error');
    });
}

// 切换排序状态的函数
function toggleEpisodeOrder(sourceCode, vodId) {
    episodesReversed = !episodesReversed;
    // 重新渲染剧集区域，使用 currentVideoTitle 作为视频标题
    const episodesGrid = document.getElementById('episodesGrid');
    if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
    }

    // 更新按钮文本和箭头方向
    const toggleBtn = document.querySelector(`button[onclick="toggleEpisodeOrder('${sourceCode}', '${vodId}')"]`);
    if (toggleBtn) {
        toggleBtn.querySelector('span').textContent = episodesReversed ? '正序排列' : '倒序排列';
        const arrowIcon = toggleBtn.querySelector('svg');
        if (arrowIcon) {
            arrowIcon.style.transform = episodesReversed ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
}

// 从URL导入配置
async function importConfigFromUrl() {
    // 创建模态框元素
    let modal = document.getElementById('importUrlModal');
    if (modal) {
        document.body.removeChild(modal);
    }

    modal = document.createElement('div');
    modal.id = 'importUrlModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';

    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeUrlModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold mb-4">从URL导入配置</h3>
            
            <div class="mb-4">
                <input type="text" id="configUrl" placeholder="输入配置文件URL" 
                       class="w-full px-3 py-2 bg-[#222] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-2">
                <button id="confirmUrlImport" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">导入</button>
                <button id="cancelUrlImport" class="bg-[#444] hover:bg-[#555] text-white px-4 py-2 rounded">取消</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // 关闭按钮事件
    document.getElementById('closeUrlModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 取消按钮事件
    document.getElementById('cancelUrlImport').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 确认导入按钮事件
    document.getElementById('confirmUrlImport').addEventListener('click', async () => {
        const url = document.getElementById('configUrl').value.trim();
        if (!url) {
            showToast('请输入配置文件URL', 'warning');
            return;
        }

        // 验证URL格式
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                showToast('URL必须以http://或https://开头', 'warning');
                return;
            }
        } catch (e) {
            showToast('URL格式不正确', 'warning');
            return;
        }

        showLoading('正在从URL导入配置...');

        try {
            // 获取配置文件 - 直接请求URL
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw '获取配置文件失败';

            // 验证响应内容类型
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw '响应不是有效的JSON格式';
            }

            const config = await response.json();
            if (config.name !== '私人TV-Settings') throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置
            for (let item in config.data) {
                localStorage.setItem(item, config.data[item]);
            }

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '导入配置失败';
            showToast(`从URL导入配置出错 (${message})`, 'error');
        } finally {
            hideLoading();
            document.body.removeChild(modal);
        }
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

// 配置文件导入功能
async function importConfig() {
    showImportBox(async (file) => {
        try {
            // 检查文件类型
            if (!(file.type === 'application/json' || file.name.endsWith('.json'))) throw '文件类型不正确';

            // 检查文件大小
            if (file.size > 1024 * 1024 * 10) throw new Error('文件大小超过 10MB');

            // 读取文件内容
            const content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject('文件读取失败');
                reader.readAsText(file);
            });

            // 解析并验证配置
            const config = JSON.parse(content);
            if (config.name !== '私人TV-Settings') throw '配置文件格式不正确';

            // 验证哈希
            const dataHash = await sha256(JSON.stringify(config.data));
            if (dataHash !== config.hash) throw '配置文件哈希值不匹配';

            // 导入配置
            for (let item in config.data) {
                localStorage.setItem(item, config.data[item]);
            }

            showToast('配置文件导入成功，3 秒后自动刷新本页面。', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 3000);
        } catch (error) {
            const message = typeof error === 'string' ? error : '配置文件格式错误';
            showToast(`配置文件读取出错 (${message})`, 'error');
        }
    });
}

// 配置文件导出功能
async function exportConfig() {
    // 存储配置数据
    const config = {};
    const items = {};

    const settingsToExport = [
        'selectedAPIs',
        'customAPIs',
        'yellowFilterEnabled',
        'adFilteringEnabled',
        'doubanEnabled',
        'hasInitializedDefaults'
    ];

    // 导出设置项
    settingsToExport.forEach(key => {
        const value = localStorage.getItem(key);
        if (value !== null) {
            items[key] = value;
        }
    });

    // 导出历史记录
    const viewingHistory = localStorage.getItem('viewingHistory');
    if (viewingHistory) {
        items['viewingHistory'] = viewingHistory;
    }

    const searchHistory = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (searchHistory) {
        items[SEARCH_HISTORY_KEY] = searchHistory;
    }

    const times = Date.now().toString();
    config['name'] = '私人TV-Settings';  // 配置文件名，用于校验
    config['time'] = times;               // 配置文件生成时间
    config['cfgVer'] = '1.0.0';           // 配置文件版本
    config['data'] = items;               // 配置文件数据
    config['hash'] = await sha256(JSON.stringify(config['data']));  // 计算数据的哈希值，用于校验

    // 将配置数据保存为 JSON 文件
    saveStringAsFile(JSON.stringify(config), '私人TV-Settings_' + times + '.json');
}

// 将字符串保存为文件
function saveStringAsFile(content, fileName) {
    // 创建Blob对象并指定类型
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    // 生成临时URL
    const url = window.URL.createObjectURL(blob);
    // 创建<a>标签并触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    // 清理临时对象
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// 移除Node.js的require语句，因为这是在浏览器环境中运行的
