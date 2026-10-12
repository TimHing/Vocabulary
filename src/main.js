import './style.css';
import { renderHome } from './pages/home.js';
import { renderStudy } from './pages/study.js';
import { renderCard } from './pages/card.js';
import { esc } from './util.js';

const app = document.getElementById('app');

// 路由（hash）：#/ → 首頁；#/s/:student → 學習頁；#/s/:student/w/:wordId → 學習卡
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  app.innerHTML = '<p class="loading">載入中…</p>';
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 's' && parts[1] && parts[2] === 'w' && parts[3]) {
      await renderCard(app, parts[1], parts[3]);
    } else if (parts[0] === 's' && parts[1]) {
      await renderStudy(app, parts[1]);
    } else {
      await renderHome(app);
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<p class="error">出錯了：${esc(err.message)}</p><p><a href="#/">回首頁</a></p>`;
  }
}

window.addEventListener('hashchange', route);
route();
