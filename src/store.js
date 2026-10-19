// 資料層：Notion 快照（words.json）＋ Firestore 即時進度。
//
// 學習進度先存 Firestore（vocab_students/{student}/words/{notionPageId}，dirty:true），
// 由 GitHub Actions 的 push-notion 定時寫回 Notion。前端合併規則：
// Firestore 文件若 dirty 為 true，或 updatedAt 比快照的 generatedAt 新，就覆蓋快照狀態；
// 否則以快照（= Notion 現況）為準，這樣老師直接在 Notion 手動修改也不會被舊的 Firestore 記錄蓋掉。
import {
  collection, doc, getDocs, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase.js';
import snapshot from './data/words.json';
import { applyAction, recordQuizResult, wordPoints } from './scheduler.js';

const PROGRESS_FIELDS = ['status', 'reviewTimes', 'nextReviewDate', 'lastReviewDate', 'defer'];
// 小測記錄與累計分（points），跟學習進度分開寫
const QUIZ_FIELDS = ['quizCorrect', 'quizWrong', 'lastQuizDate', 'points'];
const WRITE_TIMEOUT_MS = 6000;
const READ_TIMEOUT_MS = 5000;

const cache = new Map(); // studentId → Word[]（已合併 Firestore）

export const store = { offline: false };

export function getStudents() {
  return snapshot.students.map(({ id, name }) => ({ id, name }));
}

function clone(words) {
  return words.map((w) => ({ ...w }));
}

function applyProgress(words, docs) {
  const byId = new Map(words.map((w) => [w.id, w]));
  for (const d of docs) {
    const word = byId.get(d.id);
    if (!word) continue;
    const data = d.data();
    // Mastered 冷卻時間戳不走 Notion 同步，不論 dirty 與否都套用（取最近的一次）
    if (typeof data.masteredFailAt === 'number') {
      word.masteredFailAt = Math.max(word.masteredFailAt || 0, data.masteredFailAt);
    }
    const updatedMs = data.updatedAt?.toMillis?.() ?? 0;
    if (data.dirty === true || updatedMs > snapshot.generatedAt) {
      for (const f of [...PROGRESS_FIELDS, ...QUIZ_FIELDS]) {
        if (f in data) word[f] = data[f];
      }
    }
  }
}

/** 取得某位學生已合併 Firestore 進度的單詞列表（有快取；force 重新讀取）。 */
export async function loadWords(studentId, force = false) {
  if (!force && cache.has(studentId)) return cache.get(studentId);
  const student = snapshot.students.find((s) => s.id === studentId);
  if (!student) return null;

  const words = clone(student.words);
  try {
    // Firestore 慢或連不上時不要讓畫面一直卡在「載入中」，逾時就退回 Notion 快照。
    const snap = await Promise.race([
      getDocs(collection(db, 'vocab_students', studentId, 'words')),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('讀取逾時')), READ_TIMEOUT_MS); }),
    ]);
    applyProgress(words, snap.docs);
    store.offline = false;
  } catch (err) {
    console.error('讀取 Firestore 失敗，改用 Notion 快照：', err);
    store.offline = true;
  }
  cache.set(studentId, words);
  return words;
}

/** 套用學習動作：先更新記憶體，再存 Firestore（dirty:true，等 Actions 推回 Notion）。 */
/**
 * pointsDelta：這次完成要加的分數（一起寫進同一份文件，進度與分數不會只存到一半）。
 */
export async function saveAction(studentId, wordId, action, today, pointsDelta = 0) {
  const words = cache.get(studentId);
  const word = words?.find((w) => w.id === wordId);
  if (!word) throw new Error('找不到單詞');

  const before = { ...word };
  // 起始分數要在套用動作「之前」取：沒有 points 的單詞用舊公式（依 Review Times）當起始值，
  // 動作之後 Review Times 變了，再算就會多算
  const basePoints = wordPoints(word);
  Object.assign(word, applyAction(word, action, today));
  if (pointsDelta) word.points = basePoints + pointsDelta;

  // progressDirty：這份文件裡的學習進度還沒推回 Notion（push-notion 只在它不為 false 時才寫進度欄位）
  const payload = { dirty: true, progressDirty: true, updatedAt: serverTimestamp() };
  for (const f of PROGRESS_FIELDS) payload[f] = word[f] ?? null;
  payload.defer = word.defer === true;
  if (pointsDelta) payload.points = word.points;

  try {
    const write = setDoc(doc(db, 'vocab_students', studentId, 'words', wordId), payload, { merge: true });
    // 離線時 Firestore 會一直排隊不 resolve；逾時就先放行，不卡住孩子的操作。
    await Promise.race([
      write,
      new Promise((resolve) => { setTimeout(resolve, WRITE_TIMEOUT_MS); }),
    ]);
  } catch (err) {
    Object.assign(word, before); // 存檔失敗就還原，避免畫面與雲端不一致
    throw err;
  }
}

/**
 * 記錄一題小測的結果（答對/答錯次數、最後小測日期）。
 * 只寫小測欄位，不碰學習進度；失敗不影響小測本身（只記 log），所以不用 await。
 */
export function recordQuiz(studentId, wordId, ok, today) {
  const word = cache.get(studentId)?.find((w) => w.id === wordId);
  if (!word) return Promise.resolve();
  Object.assign(word, recordQuizResult(word, ok, today));

  const payload = { dirty: true, updatedAt: serverTimestamp() };
  // Firestore 不接受 undefined：單詞還沒有 points（例如快照是新欄位上線前產生的）就先不寫它
  for (const f of QUIZ_FIELDS) if (word[f] !== undefined) payload[f] = word[f];
  return setDoc(doc(db, 'vocab_students', studentId, 'words', wordId), payload, { merge: true })
    .catch((err) => { console.error('記錄小測結果失敗（不影響小測）：', err); });
}

/**
 * 記錄 Mastered 小測答錯的時間（開始冷卻）。只存 Firestore，不標 dirty、不寫回 Notion；
 * 失敗不影響小測本身，但仍會在記憶體裡生效。
 */
export function recordMasteredFail(studentId, wordId, now = Date.now()) {
  const word = cache.get(studentId)?.find((w) => w.id === wordId);
  if (word) word.masteredFailAt = now;
  return setDoc(doc(db, 'vocab_students', studentId, 'words', wordId), { masteredFailAt: now }, { merge: true })
    .catch((err) => { console.error('記錄 Mastered 冷卻失敗：', err); });
}

/**
 * 調整單詞累計分（例如選擇題答錯 -1）。只寫分數欄位，不碰學習進度；
 * 失敗不影響小測本身（只記 log），所以呼叫端不用 await。
 */
export function adjustPoints(studentId, wordId, delta) {
  const word = cache.get(studentId)?.find((w) => w.id === wordId);
  if (!word || !delta) return Promise.resolve();
  word.points = wordPoints(word) + delta;

  return setDoc(
    doc(db, 'vocab_students', studentId, 'words', wordId),
    { points: word.points, dirty: true, updatedAt: serverTimestamp() },
    { merge: true },
  ).catch((err) => { console.error('記錄分數失敗（不影響小測）：', err); });
}
