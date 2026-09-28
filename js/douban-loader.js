// 豆瓣模块按需加载器：默认不下载 douban.js（28KB），只有开关打开时才加载。
// douban.js 加载后会用同名函数覆盖这里的 updateDoubanVisibility / resetToHome。
(function () {
    let loadingPromise = null;
    window.ensureDoubanLoaded = function () {
        if (typeof window.initDouban === 'function') return Promise.resolve();
        if (loadingPromise) return loadingPromise;
        loadingPromise = new Promise((resolve, reject) => {
            const self = document.currentScript || document.querySelector('script[src*="douban-loader.js"]');
            const ver = self && /[?&]v=([^&]+)/.exec(self.src);
            const s = document.createElement('script');
            s.src = 'js/douban.js' + (ver ? '?v=' + ver[1] : '');
            s.onload = () => { try { window.initDouban(); } catch (e) { console.error(e); } resolve(); };
            s.onerror = () => { loadingPromise = null; reject(new Error('douban.js load failed')); };
            document.head.appendChild(s);
        });
        return loadingPromise;
    };
})();

function isDoubanEnabled() {
    return localStorage.getItem('doubanEnabled') === 'true';
}

// 未加载 douban.js 时的轻量实现：启用则触发加载，否则隐藏区域
function updateDoubanVisibility() {
    const area = document.getElementById('doubanArea');
    if (!area) return;
    if (isDoubanEnabled()) {
        ensureDoubanLoaded().catch(() => {});
    } else {
        area.classList.add('hidden');
    }
}

function resetToHome() {
    if (typeof resetSearchArea === 'function') resetSearchArea();
    updateDoubanVisibility();
}

document.addEventListener('DOMContentLoaded', function () {
    const toggle = document.getElementById('doubanToggle');
    if (toggle) {
        toggle.checked = isDoubanEnabled();
        toggle.addEventListener('change', function (e) {
            localStorage.setItem('doubanEnabled', e.target.checked);
            updateDoubanVisibility();
        });
    }
    if (isDoubanEnabled()) ensureDoubanLoaded().catch(() => {});
});
