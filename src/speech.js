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

export function speak(text) {
  if (!canSpeak() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-GB';
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.rate = 0.85;
  synth.speak(utter);
}
