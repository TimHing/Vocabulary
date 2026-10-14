// 小測頁：#/s/:student/w/:wid/quiz/:mode
//   learn    Today 新詞首次學完 → 1 題選意思，答對才 Finished
//   review   Review 溫習 → 1 題（題型隨階段變難），答對才 Finished（推進階段 + 加分）
//   mastered 完全掌握 → 3 題不同題型，全對才標 Mastered；答錯任何一題就開始冷卻（見 scheduler.js MASTERED_COOLDOWN_MS）
//
// Review 單詞若已 Finished 過（canQuizDirectly），學習清單會直接連到這一頁、跳過學習卡，避免照抄答案；
// 答錯後的結果頁才提供「回學習卡再看看」。
// 沒通過就完全不寫入進度；通過才呼叫 saveAction。
import {
  loadWords, saveAction, recordQuiz, recordMasteredFail,
} from '../store.js';
import { toDateStr, masteredCooldownLeft, canQuizDirectly } from '../scheduler.js';
import { speak, canSpeak } from '../speech.js';
import {
  countDistractors, pickReviewType, buildQuestion, buildMasteredQuiz, checkAnswer,
} from '../quiz.js';
import { esc, $ } from '../util.js';

const MODES = ['learn', 'review', 'mastered'];
const TYPE_LABEL = {
  mcq: '選出正確的意思',
  spell: '看意思，拼出單詞',
  cloze: '例句填空，拼出單詞',
  dictation: '聽發音，拼出單詞',
  test: '理解測試，拼出單詞',
};

function buildQuestions(mode, word, pool, ctx) {
  if (mode === 'mastered') return buildMasteredQuiz(word, pool, ctx);
  const type = mode === 'learn' ? pickReviewType(0, word, ctx) : pickReviewType(word.reviewTimes, word, ctx);
  return type ? [buildQuestion(type, word, pool)] : [];
}

export async function renderQuiz(app, studentId, wordId, mode) {
  if (!MODES.includes(mode)) throw new Error('未知的小測模式');
  const words = await loadWords(studentId);
  const word = words?.find((w) => w.id === wordId);
  if (!word) throw new Error('找不到這個單詞');

  const cardHref = `#/s/${encodeURIComponent(studentId)}/w/${encodeURIComponent(wordId)}`;
  const listHref = `#/s/${encodeURIComponent(studentId)}`;
  const action = mode === 'mastered' ? 'mastered' : 'finished';
  const ctx = { canSpeak: canSpeak(), distractors: countDistractors(word, words) };
  const questions = buildQuestions(mode, word, words, ctx);
  const title = { learn: '小測：確認認得', review: '溫習小測', mastered: '完全掌握小測' }[mode];

  const results = [];
  let index = 0;
  let saving = false;
  let failRecorded = false;

  // 直接從清單進來的 Review 小測：返回清單（不能繞去學習卡看答案）；其他情況返回學習卡
  const direct = mode === 'review' && canQuizDirectly(word);
  const header = (extra = '') => `
    <header class="top">
      <a class="back" href="${direct ? listHref : cardHref}">${direct ? '← 返回清單' : '← 返回學習卡'}</a>
      <h1>${esc(title)}</h1>
      ${extra}
    </header>`;

  // Mastered 冷卻中：不出題，直接告訴孩子還要等多久
  const cooldownLeft = mode === 'mastered' ? masteredCooldownLeft(word) : 0;
  if (cooldownLeft > 0) {
    const mins = Math.ceil(cooldownLeft / 60000);
    app.innerHTML = `
      ${header()}
      <article class="card result fail">
        <h2>先休息一下 ⏳</h2>
        <p>「${esc(word.word)}」的 Mastered 小測剛剛答錯了，還要等約 <b>${mins}</b> 分鐘才能再挑戰。</p>
        <p class="muted">趁這段時間再多看幾遍學習卡吧！</p>
      </article>
      <div class="actions two">
        <a class="btn btn-later" href="${cardHref}">看學習卡</a>
        <a class="btn btn-master" href="${listHref}">回清單</a>
      </div>`;
    return;
  }

  async function pass() {
    if (saving) return;
    saving = true;
    try {
      await saveAction(studentId, wordId, action, toDateStr());
      location.hash = listHref;
    } catch (err) {
      console.error(err);
      saving = false;
      $('#done')?.removeAttribute('disabled');
      $('#skip')?.removeAttribute('disabled');
      const msg = $('#msg');
      if (msg) {
        msg.textContent = `儲存失敗：${err.message}。請檢查網絡後再試一次。`;
        msg.hidden = false;
      }
    }
  }

  // 這個單詞缺少出題資料：不要卡住孩子，直接讓他確認完成。
  if (!questions.length) {
    app.innerHTML = `
      ${header()}
      <article class="card">
        <p class="row">「${esc(word.word)}」缺少出題用的資料（意思／例句等），暫時沒有小測可做。</p>
        <p class="muted">可以請家長在 Notion 補上 Meaning 或 Example。</p>
      </article>
      <div class="actions one"><button class="btn btn-finish" id="skip" type="button">直接完成</button></div>
      <p class="error" id="msg" hidden></p>`;
    $('#skip').addEventListener('click', (e) => { e.currentTarget.disabled = true; pass(); });
    return;
  }

  function renderResult() {
    const allOk = results.every((r) => r.ok);
    const rows = results.map((r, i) => `
      <li class="${r.ok ? 'ok' : 'bad'}">
        <b>${r.ok ? '✓' : '✗'} 第 ${i + 1} 題</b> <span class="muted">${esc(TYPE_LABEL[r.q.type])}</span><br>
        你的答案：${esc(r.input || '（空白）')}${r.ok ? '' : `<br>正確答案：<b>${esc(r.q.answer)}</b>`}
      </li>`).join('');

    if (allOk) {
      app.innerHTML = `
        ${header()}
        <article class="card result pass">
          <h2>🎉 全部答對！</h2>
          <p>${mode === 'mastered' ? `「${esc(word.word)}」標記為完全掌握。` : `「${esc(word.word)}」完成學習。`}</p>
          ${mode === 'mastered' ? `<ul class="result-list">${rows}</ul>` : ''}
        </article>
        <div class="actions one"><button class="btn btn-finish" id="done" type="button">確定</button></div>
        <p class="error" id="msg" hidden></p>`;
      $('#done').addEventListener('click', (e) => { e.currentTarget.disabled = true; pass(); });
      return;
    }

    const failText = mode === 'mastered'
      ? '還沒有全部答對，所以不標為完全掌握，這個單詞會照原來的安排繼續出現。'
      : '答錯了，這次不算完成，這個單詞會繼續留在清單裡。';
    app.innerHTML = `
      ${header()}
      <article class="card result fail">
        <h2>再加油 💪</h2>
        <p>${failText}</p>
        <ul class="result-list">${rows}</ul>
      </article>
      <div class="actions two">
        <a class="btn btn-later" href="${cardHref}">回學習卡再看看</a>
        <a class="btn btn-master" href="${listHref}">回清單</a>
      </div>`;
  }

  function renderQuestion() {
    const q = questions[index];
    const progress = questions.length > 1
      ? `<p class="muted">第 ${index + 1} / ${questions.length} 題</p>` : '';
    const speakBtn = canSpeak()
      ? '<button class="icon-btn" id="q-speak" type="button" aria-label="播放發音" title="播放發音">🔊</button>' : '';

    let body = '';
    if (q.type === 'mcq') {
      body = `
        <div class="q-word"><span class="q-big">${esc(q.prompt)}</span>${speakBtn}</div>
        <div class="options">${q.options.map((o, i) => `<button class="option" type="button" data-i="${i}">${esc(o)}</button>`).join('')}</div>`;
    } else {
      let prompt = '';
      if (q.type === 'spell') prompt = `<p class="q-big">${esc(q.prompt)}</p>`;
      else if (q.type === 'cloze') prompt = `<p class="q-text">${esc(q.prompt)}</p><p class="muted">意思：${esc(q.meaning)}</p>`;
      else if (q.type === 'dictation') prompt = `<div class="q-word">${speakBtn || '<span class="muted">此裝置不支援發音</span>'}<span class="muted">按 🔊 聽發音</span></div>`;
      else if (q.type === 'test') prompt = `<p class="q-text">${esc(q.prompt)}</p>`;
      const hint = q.type === 'spell' && mode !== 'mastered'
        ? `<button class="pill small" id="hint" type="button">提示：首字母</button><p class="muted" id="hint-text" hidden>首字母是「${esc(q.hint)}」</p>` : '';
      body = `
        ${prompt}
        <form id="answer-form" autocomplete="off">
          <input id="answer" class="answer-input" type="text" inputmode="text" autocapitalize="off"
                 autocorrect="off" spellcheck="false" placeholder="輸入英文單詞" aria-label="答案" />
          <button class="btn btn-master" id="submit" type="submit">確定</button>
        </form>
        ${hint}`;
    }

    app.innerHTML = `
      ${header(progress)}
      <article class="card quiz">
        <p class="q-type">${esc(TYPE_LABEL[q.type])}</p>
        ${body}
        <div class="feedback" id="feedback" hidden></div>
      </article>
      <div class="actions one"><button class="btn btn-finish" id="next" type="button" hidden>下一步</button></div>
      ${direct ? `<p class="hint"><a href="${cardHref}/quiz/mastered">已經完全掌握？挑戰 Mastered 小測</a></p>` : ''}`;

    $('#q-speak')?.addEventListener('click', () => speak(q.answer));
    $('#hint')?.addEventListener('click', (e) => {
      $('#hint-text').hidden = false;
      e.currentTarget.hidden = true;
    });

    let answered = false;
    const finishQuestion = (input) => {
      if (answered) return;
      answered = true;
      const ok = checkAnswer(q, input);
      results.push({ q, input, ok });
      recordQuiz(studentId, wordId, ok, toDateStr()); // 每答一題就記一次（對/錯都記），不阻塞畫面
      // Mastered 只要錯一題就算失敗，立刻開始冷卻（不等到結果頁，中途離開也逃不掉）
      if (mode === 'mastered' && !ok && !failRecorded) {
        failRecorded = true;
        recordMasteredFail(studentId, wordId);
      }

      const fb = $('#feedback');
      fb.className = `feedback ${ok ? 'ok' : 'bad'}`;
      fb.innerHTML = ok
        ? '✓ 答對了！'
        : `✗ 答錯了。正確答案：<b>${esc(q.answer)}</b>`;
      fb.hidden = false;

      $('#answer')?.setAttribute('disabled', '');
      $('#submit')?.setAttribute('disabled', '');
      document.querySelectorAll('.option').forEach((b) => {
        b.disabled = true;
        if (b.textContent === q.answer) b.classList.add('correct');
        else if (b.textContent === input) b.classList.add('wrong');
      });

      const last = index === questions.length - 1;
      const next = $('#next');
      next.textContent = last ? '看結果' : '下一題';
      next.hidden = false;
      next.focus();
    };

    document.querySelectorAll('.option').forEach((b) => {
      b.addEventListener('click', () => finishQuestion(b.textContent));
    });
    $('#answer-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      finishQuestion($('#answer').value);
    });
    $('#next').addEventListener('click', () => {
      if (index === questions.length - 1) renderResult();
      else { index += 1; renderQuestion(); }
    });

    $('#answer')?.focus();
    if (q.type === 'dictation') speak(q.answer);
  }

  renderQuestion();
}
