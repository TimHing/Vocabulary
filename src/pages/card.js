import { loadWords, saveAction } from '../store.js';
import { toDateStr } from '../scheduler.js';
import { speak, canSpeak } from '../speech.js';
import { esc, $ } from '../util.js';

const row = (label, value) => (value
  ? `<p class="row"><b>${label}：</b> ${esc(value)}</p>`
  : '');

export async function renderCard(app, studentId, wordId) {
  const words = await loadWords(studentId);
  const word = words?.find((w) => w.id === wordId);
  if (!word) throw new Error('找不到這個單詞');

  const back = `#/s/${encodeURIComponent(studentId)}`;
  const speakBtn = canSpeak()
    ? '<button class="icon-btn" id="speak" aria-label="發音" title="發音">🔊</button>'
    : '';
  const exampleSpeak = canSpeak() && word.example
    ? '<button class="icon-btn small" id="speak-example" aria-label="朗讀例句" title="朗讀例句">🔊</button>'
    : '';

  app.innerHTML = `
    <header class="top"><a class="back" href="${back}">← 返回清單</a></header>
    <article class="card">
      <div class="card-meta">${word.type ? `<span>${esc(word.type)}</span>` : ''}${word.source ? `<span> · ${esc(word.source)}</span>` : ''}</div>
      <div class="card-title">
        <h1>${esc(word.word)}</h1>
        ${speakBtn}
      </div>
      <p class="phonetic">${esc(word.pronunciation)}</p>
      ${row('意思', word.meaning)}
      ${row('用法', word.collocation)}
      ${word.example ? `<p class="row"><b>例句：</b> ${esc(word.example)} ${exampleSpeak}</p>` : ''}
      ${row('同義詞', word.synonyms)}
      ${row('反義詞', word.antonyms)}
      ${word.test ? `
        <p class="row"><b>理解測試：</b> ${esc(word.test)}</p>
        <button class="pill" id="toggle-answer" type="button">顯示答案</button>
        <div class="answer" id="answer" hidden><b>答案：</b>${esc(word.answer)}</div>` : ''}
    </article>
    <div class="actions">
      <button class="btn btn-later" id="later" type="button">Learn Next Time</button>
      <button class="btn btn-finish" id="finished" type="button">Finished</button>
      <button class="btn btn-master" id="mastered" type="button">Mastered</button>
    </div>
    <p class="hint">Mastered = 已經完全學會，之後不再出現在清單</p>
    <p class="error" id="msg" hidden></p>`;

  $('#speak')?.addEventListener('click', () => speak(word.word));
  $('#speak-example')?.addEventListener('click', () => speak(word.example));

  $('#toggle-answer')?.addEventListener('click', (e) => {
    const answer = $('#answer');
    answer.hidden = !answer.hidden;
    e.currentTarget.textContent = answer.hidden ? '顯示答案' : '隱藏答案';
  });

  const buttons = ['later', 'finished', 'mastered'].map((id) => $(`#${id}`));
  const run = async (action) => {
    if (action === 'mastered' && !window.confirm(`確定「${word.word}」已經完全掌握了嗎？\n之後不會再出現在 Today / Review。`)) return;
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await saveAction(studentId, wordId, action, toDateStr());
      location.hash = back;
    } catch (err) {
      console.error(err);
      buttons.forEach((b) => { b.disabled = false; });
      const msg = $('#msg');
      msg.textContent = `儲存失敗：${err.message}。請檢查網絡後再試一次。`;
      msg.hidden = false;
    }
  };
  $('#later').addEventListener('click', () => run('later'));
  $('#finished').addEventListener('click', () => run('finished'));
  $('#mastered').addEventListener('click', () => run('mastered'));
}
