import { getStudents, loadWords, store } from '../store.js';
import { studentStats, toDateStr, MAX_SCORE_PER_WORD } from '../scheduler.js';
import { esc } from '../util.js';

export async function renderHome(app) {
  const today = toDateStr();
  const students = getStudents();
  const wordsList = await Promise.all(students.map((s) => loadWords(s.id)));

  const cards = students.map((s, i) => {
    const st = studentStats(wordsList[i], today);
    return `
      <a class="student-card" href="#/s/${encodeURIComponent(s.id)}">
        <div class="student-head">
          <h2>${esc(s.name)}</h2>
          <div class="score"><span class="score-num">${st.percent}</span><span class="score-unit">分</span></div>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${st.percent}%"></div></div>
        <p class="muted">累計 ${st.score} / ${st.maxScore} 分（每個單詞滿分 ${MAX_SCORE_PER_WORD}）</p>
        <ul class="stat-grid">
          <li><b>${st.total}</b><span>總單詞</span></li>
          <li><b>${st.new}</b><span>New</span></li>
          <li><b>${st.learning}</b><span>Learning</span></li>
          <li><b>${st.finished}</b><span>Finished</span></li>
        </ul>
        <p class="todo">今天：<b>${st.today}</b> 個新詞 · <b>${st.review}</b> 個要溫習</p>
      </a>`;
  }).join('');

  app.innerHTML = `
    <header class="top"><h1>📖 單詞學習</h1><p class="muted">選擇同學開始學習</p></header>
    ${store.offline ? '<p class="warn">目前無法連線到雲端，顯示的是 Notion 快照。</p>' : ''}
    <main class="students">${cards}</main>`;
}
