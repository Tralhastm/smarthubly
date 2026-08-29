/**
 * Alerta sonoro de novo pedido — gerado via Web Audio API (sem arquivo de áudio externo).
 * Modo "alto": toca repetido até parar. Modo discreto: um bip curto.
 */

let audioContext: AudioContext | null = null;
let alertTimer: number | null = null;
let isPlaying = false;
const listeners = new Set<(playing: boolean) => void>();
const notify = () => listeners.forEach(l => { try { l(isPlaying); } catch {} });

export function subscribeAlert(cb: (playing: boolean) => void) {
  listeners.add(cb);
  cb(isPlaying);
  return () => listeners.delete(cb);
}

const getCtx = (): AudioContext => {
  if (!audioContext) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    audioContext = new Ctx();
  }
  return audioContext;
};

/** Bip único — usado no modo discreto */
function playBeep(freq = 880, duration = 0.15, volume = 0.4) {
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio playback failed:', e);
  }
}

/** Sequência estilo "iFood" — 3 bips altos seguidos */
function playLoudSequence() {
  playBeep(1200, 0.18, 0.7);
  setTimeout(() => playBeep(900, 0.18, 0.7), 220);
  setTimeout(() => playBeep(1200, 0.25, 0.7), 440);
}

/**
 * Inicia alarme repetido (estilo iFood) — toca a cada 2.5s até stopAlert() ou interação do usuário.
 */
export function startLoudAlert() {
  if (isPlaying) return;
  isPlaying = true;
  playLoudSequence();
  alertTimer = window.setInterval(playLoudSequence, 2500);
  notify();
}

/** Bip curto único (modo discreto) */
export function playShortBeep() {
  playBeep(1000, 0.2, 0.5);
}

export function stopAlert() {
  if (alertTimer != null) {
    clearInterval(alertTimer);
    alertTimer = null;
  }
  if (isPlaying) {
    isPlaying = false;
    notify();
  }
}

export const isAlertPlaying = () => isPlaying;

/**
 * Pré-aquecer o AudioContext.
 * Browsers exigem interação do usuário antes de tocar áudio.
 * Chame isso no primeiro clique/touch da página.
 */
export function unlockAudio() {
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* ignore */ }
}
