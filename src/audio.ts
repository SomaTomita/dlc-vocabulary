import manifest from '../content/audio.json';

const clips: Record<string, string> = manifest.clips;
const practiceRate = 0.85;
let cancelPlayback: (() => void) | undefined;

export function stopAudio() {
  cancelPlayback?.();
}

export function playDutch(text: string): Promise<void> {
  if (cancelPlayback) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let player: HTMLAudioElement | undefined;
    let utterance: SpeechSynthesisUtterance | undefined;
    let active = true;

    function stopPlayer() {
      if (!player) return;
      player.onended = null;
      player.onerror = null;
      player.pause();
      player = undefined;
    }

    function settle(error?: Error) {
      if (!active) return;
      active = false;
      clearTimeout(timeout);
      stopPlayer();
      if (utterance) {
        utterance.onend = null;
        utterance.onerror = null;
        window.speechSynthesis.cancel();
      }
      cancelPlayback = undefined;
      if (error) reject(error);
      else resolve();
    }

    function browserVoice() {
      if (!active) return;
      const speech = window.speechSynthesis;
      const voice = speech?.getVoices().find(item => item.lang.toLowerCase().replace('_', '-') === 'nl-be');
      if (!voice) {
        settle(new Error('Belgian Dutch audio is unavailable.'));
        return;
      }
      utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = 'nl-BE';
      utterance.rate = practiceRate;
      utterance.onend = () => settle();
      utterance.onerror = () => settle(new Error('Speech playback failed.'));
      speech.speak(utterance);
    }

    const timeout = window.setTimeout(() => settle(new Error('Audio playback timed out.')), 25_000);
    cancelPlayback = () => settle();

    const clip = clips[text];
    if (!clip) {
      browserVoice();
      return;
    }

    const audio = new Audio(import.meta.env.BASE_URL + 'audio/' + clip);
    player = audio;
    audio.playbackRate = practiceRate;
    audio.preservesPitch = true;
    audio.onended = () => settle();
    const fallback = () => {
      if (player !== audio) return;
      stopPlayer();
      browserVoice();
    };
    audio.onerror = fallback;
    void audio.play().catch(error => {
      if (player !== audio) return;
      if (error instanceof DOMException && error.name === 'NotAllowedError') settle(error);
      else fallback();
    });
  });
}
