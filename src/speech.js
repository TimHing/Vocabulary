// 發聲：瀏覽器內建 Web Speech API，優先英式（en-GB），沒有就退回任何 en-* 語音。
let voices = [];

function refreshVoices() {
  if (!('speechSynthesis' in window)) return;
  voices = window.speechSynthesis.getVoices();
}

if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

function pickVoice() {
  const norm = (v) => v.lang.replace('_', '-').toLowerCase();
  return voices.find((v) => norm(v) === 'en-gb')
    || voices.find((v) => norm(v).startsWith('en'))
    || null;
}

export function canSpeak() {
  return 'speechSynthesis' in window;
}

// 每次新的朗讀（speak / speakTwice）都會取消尚未開始的後續朗讀（例如離開頁面後不要再讀第二次）。
let session = 0;

function utterance(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-GB';
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.rate = 0.85;
  return utter;
}

export function speak(text) {
  if (!canSpeak() || !text) return;
  session += 1;
  const synth = window.speechSynthesis;
  synth.cancel();
  synth.speak(utterance(text));
}

/** 自動朗讀兩次（兩次之間停頓 PAUSE_MS），給 Finished / Review 小測進入時用。 */
const PAUSE_MS = 900;
export function speakTwice(text) {
  if (!canSpeak() || !text) return;
  session += 1;
  const mine = session;
  const synth = window.speechSynthesis;
  synth.cancel();
  const first = utterance(text);
  let secondQueued = false;
  const playSecond = () => {
    if (secondQueued || mine !== session) return;
    secondQueued = true;
    setTimeout(() => {
      if (mine === session) synth.speak(utterance(text));
    }, PAUSE_MS);
  };
  first.onend = playSecond;
  first.onerror = playSecond;
  synth.speak(first);
  // 有些瀏覽器沒有發音語音時不會觸發 onend，保底：3 秒後仍然照常讀第二次
  setTimeout(playSecond, 3000);
}
