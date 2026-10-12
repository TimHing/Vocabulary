import { getStudents, loadWords, store } from '../store.js';
import { todayList, reviewList, toDateStr } from '../scheduler.js';
import { esc } from '../util.js';

function listHtml(studentId, words, today, kind) {
  if (!words.length) {
    return `<p class="empty">${kind === 'today' ? '今天沒有新詞要學 🎉' : '目前沒有要溫習的單詞 🎉'}</p>`;
  }
  return `<ul class="word-list">${words.map((w) => {
    const overdue = kind === 'review' && !w.defer && w.nextReviewDate && w.nextReviewDate < today;
    const tags = [
      w.defer ? '<span class="tag tag-later">下次再學</span>' : '',
      overdue ? '<span class="tag tag-overdue">已逾期</span>' : '',
    ].join('');
    return `
      <li>
        <a class="word-item" href="#/s/${encodeURIComponent(studentId)}/w/${encodeURIComponent(w.id)}">
          <span class="w-word">${esc(w.word)}</span>
          <span class="w-meaning">${esc(w.meaning)}</span>
          ${tags}
        </a>
      </li>`;
  }).join('')}</ul>`;
}

export async function renderStudy(app, studentId) {
  const student = getStudents().find((s) => s.id === studentId);
  if (!student) throw new Error('找不到這位同學');
  const words = await loadWords(studentId);
  const today = toDateStr();
  const todays = todayList(words, today);
  const reviews = reviewList(words, today);

  app.innerHTML = `
    <header class="top">
      <a class="back" href="#/">← 返回</a>
      <h1>${esc(student.name)}</h1>
    </header>
    ${store.offline ? '<p class="warn">目前無法連線到雲端，顯示的是 Notion 快照。</p>' : ''}
    <section>
      <h2 class="section-title">Today <span class="count">${todays.length}</span></h2>
      ${listHtml(studentId, todays, today, 'today')}
    </section>
    <section>
      <h2 class="section-title">Review <span class="count">${reviews.length}</span></h2>
      ${listHtml(studentId, reviews, today, 'review')}
    </section>`;
}
