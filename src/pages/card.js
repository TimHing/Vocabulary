import { loadWords, saveAction } from '../store.js';
import { toDateStr, masteredCooldownLeft } from '../scheduler.js';
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
    <p class="hint">Finished 和 Mastered 都要先通過小測；Mastered = 3 題全對才算完全學會，之後不再出現在清單</p>
    <p class="error" id="msg" hidden></p>`;

  $('#speak')?.addEventListener('click', () => speak(word.word));
  $('#speak-example')?.addEventListener('click', () => speak(word.example));

  $('#toggle-answer')?.addEventListener('click', (e) => {
    const answer = $('#answer');
    answer.hidden = !answer.hidden;
    e.currentTarget.textContent = answer.hidden ? '顯示答案' : '隱藏答案';
  });

  // Learn Next Time 直接存；Finished / Mastered 要先通過小測（見 pages/quiz.js），通過後才寫入進度。
  const quizBase = `${back}/w/${encodeURIComponent(wordId)}/quiz`;
  const finishMode = word.status === 'New' && word.reviewTimes == null ? 'learn' : 'review';
  $('#later').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await saveAction(studentId, wordId, 'later', toDateStr());
      location.hash = back;
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      const msg = $('#msg');
      msg.textContent = `儲存失敗：${err.message}。請檢查網絡後再試一次。`;
      msg.hidden = false;
    }
  });
  // Mastered 小測答錯後冷卻中：按鈕停用並顯示還要等多久
  const cooldownLeft = masteredCooldownLeft(word);
  if (cooldownLeft > 0) {
    const m = $('#mastered');
    m.disabled = true;
    m.textContent = `Mastered（${Math.ceil(cooldownLeft / 60000)} 分鐘後）`;
  }
  $('#finished').addEventListener('click', () => { location.hash = `${quizBase}/${finishMode}`; });
  $('#mastered').addEventListener('click', () => { location.hash = `${quizBase}/mastered`; });
}
