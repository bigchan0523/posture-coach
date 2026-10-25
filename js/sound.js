// 효과음(삐 소리)과 음성 안내
import { store } from "./store.js";

let ctx = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = "sine", gain = 0.25, at = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  /** 사용자 터치 직후 호출 → 이후 소리가 막히지 않게 */
  unlock() { audio(); unlockSpeech(); },
  count() { if (store.settings.sounds) tone(660, 0.12); },
  go() { if (store.settings.sounds) { tone(880, 0.12); tone(1320, 0.25, { at: 0.12 }); } },
  rep() { if (store.settings.sounds) tone(1000, 0.06, { type: "triangle", gain: 0.18 }); },
  warn() { if (store.settings.sounds) tone(300, 0.15, { type: "square", gain: 0.08 }); },
  setDone() {
    if (!store.settings.sounds) return;
    [523, 659, 784].forEach((f, i) => tone(f, 0.22, { at: i * 0.1 }));
  },
};

// ---------- 음성 ----------
let nativeTTS = null;
if (window.Capacitor?.isNativePlatform?.() || window.androidBridge) {
  import("./vendor/capacitor-core.js")
    .then(({ registerPlugin }) => { nativeTTS = registerPlugin("TextToSpeech"); })
    .catch((e) => console.warn("음성 플러그인 없음", e));
}

function unlockSpeech() {
  if (!store.settings.voice || nativeTTS || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  speechSynthesis.speak(u);
}

const lastSaid = new Map();
/** interrupt: 앞 말을 끊고 바로 말하기 (횟수 등) / onceKey: 같은 말은 5초에 한 번 */
export function say(text, { interrupt = false, onceKey = null } = {}) {
  if (!store.settings.voice || !text?.trim()) return;
  if (onceKey) {
    const now = performance.now();
    if (now - (lastSaid.get(onceKey) ?? -1e9) < 5000) return;
    lastSaid.set(onceKey, now);
  }
  if (nativeTTS) {
    nativeTTS.speak({ text, lang: "ko-KR", rate: 1.1, queueStrategy: interrupt ? 0 : 1 }).catch(() => {});
    return;
  }
  if (!("speechSynthesis" in window)) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 1.1;
  speechSynthesis.speak(u);
}
