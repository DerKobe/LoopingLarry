// WebSocket connection + server clock synchronisation.
export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.offset = 0; // serverTime - clientTime (seconds)
    this.rtt = 0.1;
    this.samples = [];
    this.pingTimer = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws.onopen = () => {
        this.startPings();
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = () => {
        clearTimeout(this.pingTimer);
        this.dispatchEvent(new CustomEvent('close'));
      };
      this.ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === 'pong') {
          this.onPong(msg);
          return;
        }
        this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  static clientNow() {
    return performance.now() / 1000;
  }

  serverNow() {
    return Net.clientNow() + this.offset;
  }

  startPings() {
    let n = 0;
    const tick = () => {
      this.send({ t: 'ping', c: Net.clientNow() });
      n++;
      this.pingTimer = setTimeout(tick, n < 8 ? 150 : 2000);
    };
    tick();
  }

  onPong({ c, s }) {
    const now = Net.clientNow();
    const rtt = now - c;
    const offset = s + rtt / 2 - now;
    this.samples.push({ rtt, offset });
    if (this.samples.length > 12) this.samples.shift();
    // Trust the samples with the lowest round trip time
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    const target = best.reduce((a, b) => a + b.offset, 0) / best.length;
    if (this.samples.length < 4 || Math.abs(target - this.offset) > 0.25) this.offset = target;
    else this.offset += (target - this.offset) * 0.3;
    this.rtt = best[0].rtt;
  }
}
