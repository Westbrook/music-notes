import type { PlaybackPlan } from './playback-plan.js';

/** Portable brass-like synthesis. One rendered buffer serves playback and export. */
export async function renderPlayback(plan: PlaybackPlan): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === 'undefined') throw new Error('This browser does not support offline audio rendering.');
  const context = new OfflineAudioContext(1, Math.ceil((plan.duration + .12) * 44100), 44100);
  const real = new Float32Array(17);
  const imaginary = new Float32Array(17);
  for (let harmonic = 1; harmonic < imaginary.length; harmonic++) imaginary[harmonic] = 1 / harmonic ** 1.25;
  const wave = context.createPeriodicWave(real, imaginary);
  const master = context.createGain(); master.gain.value = .17; master.connect(context.destination);
  for (const note of plan.notes) {
    const oscillator = context.createOscillator(); oscillator.setPeriodicWave(wave);
    oscillator.frequency.value = note.frequency;
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = Math.min(6500, note.frequency * 9); filter.Q.value = .6;
    const envelope = context.createGain();
    const attack = Math.min(.018, (note.end - note.start) / 5);
    envelope.gain.setValueAtTime(0, note.start);
    envelope.gain.linearRampToValueAtTime(note.gain, note.start + attack);
    envelope.gain.linearRampToValueAtTime(note.gain * .85, note.end);
    envelope.gain.linearRampToValueAtTime(0, note.end + .035);
    oscillator.connect(filter); filter.connect(envelope); envelope.connect(master);
    oscillator.start(note.start); oscillator.stop(note.end + .04);
  }
  const buffer = await context.startRendering();
  // A single conservative peak limit preserves dynamics within the entire score.
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  if (peak > .8) for (let i = 0; i < data.length; i++) data[i] *= .8 / peak;
  return buffer;
}

export function encodeWav(buffer: Pick<AudioBuffer, 'numberOfChannels' | 'length' | 'sampleRate' | 'getChannelData'>): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string): void => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < buffer.length; frame++) for (let channel = 0; channel < channels; channel++) {
    const value = Math.max(-1, Math.min(1, samples[channel][frame]));
    view.setInt16(44 + (frame * channels + channel) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
