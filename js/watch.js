// 兼容旧版 watch.html 链接：把参数原样转交给 player.html，立即跳转（不再人为等待 3 秒）
(function () {
    const params = new URLSearchParams(window.location.search);
    const playerUrl = new URL('player.html', window.location.origin);
    params.forEach((value, key) => {
        if (key === 'back') {
            playerUrl.searchParams.set('returnUrl', value);
        } else {
            playerUrl.searchParams.set(key, value);
        }
    });
    if (!playerUrl.searchParams.has('returnUrl') && document.referrer && !/player\.html|watch\.html/.test(document.referrer)) {
        playerUrl.searchParams.set('returnUrl', document.referrer);
    }
    const manual = document.getElementById('manual-redirect');
    if (manual) manual.href = playerUrl.toString();
    window.location.replace(playerUrl.toString());
})();
