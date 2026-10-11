"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Web Audio API synth — no external sound files needed
// Generates retro/arcade sounds programmatically

interface SoundState {
  enabled: boolean;
  toggle: () => void;
  playRoll: () => void;
  playCellHit: () => void;
  playCellComplete: () => void;
  playCombo: () => void;
  playLevelUp: () => void;
  playRugPull: () => void;
  playWildCard: () => void;
  playBoardComplete: () => void;
}

const SoundContext = createContext<SoundState>({
  enabled: true,
  toggle: () => {},
  playRoll: () => {},
  playCellHit: () => {},
  playCellComplete: () => {},
  playCombo: () => {},
  playLevelUp: () => {},
  playRugPull: () => {},
  playWildCard: () => {},
  playBoardComplete: () => {},
});

export function useSound() {
  return useContext(SoundContext);
}

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "square", volume = 0.15) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

function playNoise(duration: number, volume = 0.08) {
  try {
    const ctx = getAudioCtx();
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
  } catch {}
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);

  const toggle = useCallback(() => setEnabled((e) => !e), []);

  const playRoll = useCallback(() => {
    if (!enabled) return;
    // Dice tumble: quick descending tones
    playNoise(0.08, 0.1);
    setTimeout(() => playTone(400, 0.05, "square", 0.08), 30);
    setTimeout(() => playTone(350, 0.05, "square", 0.08), 60);
    setTimeout(() => playTone(300, 0.05, "square", 0.08), 90);
  }, [enabled]);

  const playCellHit = useCallback(() => {
    if (!enabled) return;
    playTone(220, 0.1, "triangle", 0.1);
  }, [enabled]);

  const playCellComplete = useCallback(() => {
    if (!enabled) return;
    // Ascending arpeggio
    playTone(440, 0.15, "square", 0.12);
    setTimeout(() => playTone(554, 0.15, "square", 0.12), 80);
    setTimeout(() => playTone(659, 0.2, "triangle", 0.15), 160);
  }, [enabled]);

  const playCombo = useCallback(() => {
    if (!enabled) return;
    // Fanfare
    playTone(523, 0.15, "square", 0.15);
    setTimeout(() => playTone(659, 0.15, "square", 0.15), 100);
    setTimeout(() => playTone(784, 0.15, "square", 0.15), 200);
    setTimeout(() => playTone(1047, 0.3, "triangle", 0.18), 300);
  }, [enabled]);

  const playLevelUp = useCallback(() => {
    if (!enabled) return;
    // Big fanfare
    [523, 587, 659, 784, 880, 1047].forEach((f, i) => {
      setTimeout(() => playTone(f, 0.2, "triangle", 0.12), i * 80);
    });
  }, [enabled]);

  const playRugPull = useCallback(() => {
    if (!enabled) return;
    // Descending sad tones
    playTone(400, 0.15, "sawtooth", 0.1);
    setTimeout(() => playTone(300, 0.15, "sawtooth", 0.1), 100);
    setTimeout(() => playTone(200, 0.3, "sawtooth", 0.08), 200);
  }, [enabled]);

  const playWildCard = useCallback(() => {
    if (!enabled) return;
    // Sparkle
    playTone(800, 0.1, "sine", 0.1);
    setTimeout(() => playTone(1200, 0.1, "sine", 0.1), 60);
    setTimeout(() => playTone(1600, 0.15, "sine", 0.12), 120);
  }, [enabled]);

  const playBoardComplete = useCallback(() => {
    if (!enabled) return;
    // Victory melody
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((f, i) => {
      setTimeout(() => playTone(f, 0.25, "triangle", 0.15), i * 120);
    });
  }, [enabled]);

  return (
    <SoundContext.Provider value={{
      enabled, toggle, playRoll, playCellHit, playCellComplete,
      playCombo, playLevelUp, playRugPull, playWildCard, playBoardComplete,
    }}>
      {children}
    </SoundContext.Provider>
  );
}
