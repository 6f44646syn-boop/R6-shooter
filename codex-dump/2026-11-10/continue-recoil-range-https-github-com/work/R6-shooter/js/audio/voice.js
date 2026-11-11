// Bots' radio voices, spoken by the browser's built-in speech (Web Speech API).
// Only voices installed on this computer are used (localService), never online voices, so
// nothing leaves the PC. Each bot keeps its own voice and pitch. Lines do not pile up: when
// the radio is busy a new line waits for at most one other, older ones are dropped.
export class Voices {
  constructor() {
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
    this.enabled = true;
    this.volume = 0.8;
    this.list = [];
    if (this.ok) {
      this._load();
      speechSynthesis.addEventListener?.('voiceschanged', () => this._load());
    }
  }
  _load() {
    const local = speechSynthesis.getVoices().filter((v) => v.localService);
    const en = local.filter((v) => /^en/i.test(v.lang));
    this.list = en.length ? en : local;
  }
  get available() { return this.ok && this.list.length > 0; }
  // who: a name (picks the voice and pitch, the same every time for that name).
  say(text, who = '') {
    if (!this.enabled || !this.ok) return false;
    if (!this.list.length) this._load();
    if (!this.list.length) return false;
    let h = 0;
    for (const ch of who) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    if (speechSynthesis.pending) speechSynthesis.cancel();      // keep the radio current
    const u = new SpeechSynthesisUtterance(text.replace(/\bby the\b/g, 'by the').replace(/-/g, ' '));
    u.voice = this.list[h % this.list.length];
    u.lang = u.voice.lang;
    u.pitch = 0.7 + (h % 7) * 0.08;
    u.rate = 1.12 + (h % 3) * 0.05;
    u.volume = Math.max(0, Math.min(1, this.volume));
    speechSynthesis.speak(u);
    return true;
  }
  stop() { if (this.ok) speechSynthesis.cancel(); }
}
