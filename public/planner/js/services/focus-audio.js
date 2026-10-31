const audioModes = new Set(["ambient", "pink", "brown"]);

let context;
let masterGain;
let sources = [];
let nodes = [];
let playing = false;

function getAudioContext() {
  const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextType) throw new Error("Focus audio is not supported by this browser.");
  context ||= new AudioContextType();
  return context;
}

function makeNoiseBuffer(audioContext, color) {
  const durationSeconds = 4;
  const buffer = audioContext.createBuffer(1, audioContext.sampleRate * durationSeconds, audioContext.sampleRate);
  const channel = buffer.getChannelData(0);
  let brown = 0;
  let pink0 = 0;
  let pink1 = 0;
  let pink2 = 0;
  let pink3 = 0;
  let pink4 = 0;
  let pink5 = 0;
  let pink6 = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (color === "brown") {
      brown = (brown + 0.02 * white) / 1.02;
      channel[index] = brown * 3.5;
    } else {
      pink0 = 0.99886 * pink0 + white * 0.0555179;
      pink1 = 0.99332 * pink1 + white * 0.0750759;
      pink2 = 0.969 * pink2 + white * 0.153852;
      pink3 = 0.8665 * pink3 + white * 0.3104856;
      pink4 = 0.55 * pink4 + white * 0.5329522;
      pink5 = -0.7616 * pink5 - white * 0.016898;
      const pink = pink0 + pink1 + pink2 + pink3 + pink4 + pink5 + pink6 + white * 0.5362;
      pink6 = white * 0.115926;
      channel[index] = pink * 0.11;
    }
  }
  return buffer;
}

function stopSources() {
  for (const source of sources) {
    try {
      source.stop();
    } catch (error) {
      if (error.name !== "InvalidStateError") throw error;
    }
  }
  for (const node of nodes) node.disconnect();
  sources = [];
  nodes = [];
  playing = false;
}

export function isFocusAudioPlaying() {
  return playing;
}

export function setFocusAudioVolume(volume) {
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error("Choose a volume between 0 and 100.");
  if (masterGain && context) masterGain.gain.setTargetAtTime(volume / 100 * 0.25, context.currentTime, 0.04);
}

export async function playFocusAudio(mode, volume = 25) {
  if (!audioModes.has(mode)) throw new Error("Choose an available focus sound.");
  if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error("Choose a volume between 0 and 100.");

  const audioContext = getAudioContext();
  await audioContext.resume();
  stopSources();
  if (!masterGain) {
    masterGain = audioContext.createGain();
    masterGain.connect(audioContext.destination);
  }
  setFocusAudioVolume(volume);

  if (mode === "ambient") {
    for (const frequency of [220, 277.18, 329.63]) {
      const oscillator = audioContext.createOscillator();
      const voiceGain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      voiceGain.gain.value = 0.22;
      oscillator.connect(voiceGain);
      voiceGain.connect(masterGain);
      oscillator.start();
      sources.push(oscillator);
      nodes.push(oscillator, voiceGain);
    }
  } else {
    const noise = audioContext.createBufferSource();
    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = mode === "pink" ? 1_200 : 450;
    noise.buffer = makeNoiseBuffer(audioContext, mode);
    noise.loop = true;
    noise.connect(filter);
    filter.connect(masterGain);
    noise.start();
    sources.push(noise);
    nodes.push(noise, filter);
  }
  playing = true;
}

export function stopFocusAudio() {
  stopSources();
  if (masterGain && context) masterGain.gain.setValueAtTime(0, context.currentTime);
}
