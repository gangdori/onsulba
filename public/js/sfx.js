// 작은 효과음 (파일 없이 WebAudio 로 합성)
let ctx = null;

/** 사용자의 첫 터치/클릭에서 호출해 오디오를 깨운다 */
export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    /* 오디오 미지원 환경 */
  }
  return ctx;
}

function tone(freq, start, dur, gain = 0.08, type = 'sine') {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  clink() {
    tone(2093, 0, 0.5, 0.06);
    tone(2637, 0.03, 0.6, 0.05);
    tone(3520, 0.05, 0.35, 0.025);
  },
  pop() {
    tone(660, 0, 0.12, 0.05, 'triangle');
  },
  seated() {
    tone(523, 0, 0.18, 0.06, 'triangle');
    tone(784, 0.12, 0.3, 0.06, 'triangle');
  },
  ring() {
    tone(880, 0, 0.18, 0.07);
    tone(1175, 0.2, 0.18, 0.07);
    tone(880, 0.4, 0.18, 0.07);
    tone(1175, 0.6, 0.25, 0.07);
  },
  hangup() {
    tone(440, 0, 0.15, 0.06);
    tone(330, 0.14, 0.25, 0.06);
  },
};
