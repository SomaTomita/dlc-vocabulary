import manifest from '../content/audio.json';

const clips: Record<string, string> = manifest.clips;
let current: HTMLAudioElement | undefined;
let done: (() => void) | undefined;

export function stopAudio() {
  current?.pause();
  current = undefined;
  window.speechSynthesis?.cancel();
  done?.();
  done = undefined;
}

export function playDutch(text: string): Promise<void> {
  stopAudio();
  return new Promise((resolve, reject) => {
    done = resolve;
    const browserVoice = () => {
      const speech = window.speechSynthesis;
      const voice = speech?.getVoices().find(item => item.lang.toLowerCase().replace('_', '-') === 'nl-be');
      if (!voice) { done = undefined; reject(new Error('Belgian Dutch audio is unavailable.')); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = 'nl-BE';
      utterance.onend = () => { done = undefined; resolve(); };
      utterance.onerror = reject;
      speech.speak(utterance);
    };
    const clip = clips[text];
    if (!clip) { browserVoice(); return; }
    const audio = new Audio(import.meta.env.BASE_URL + 'audio/' + clip);
    current = audio;
    audio.onended = () => { current = undefined; done = undefined; resolve(); };
    void audio.play().catch(error => {
      if (current !== audio) { resolve(); return; }
      current = undefined;
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        done = undefined;
        reject(error);
      } else browserVoice();
    });
  });
}
