// WebRTC full mesh for voice + video ("perfect negotiation" pattern).
export class Mesh extends EventTarget {
  constructor(net) {
    super();
    this.net = net;
    this.myId = null;
    this.iceServers = [];
    this.localStream = null;
    this.peers = new Map(); // id -> { pc, polite, makingOffer, ignoreOffer, stream }
    net.addEventListener('signal', (e) => this.onSignal(e.detail.from, e.detail.data));
  }

  async getMedia() {
    if (this.localStream) return this.localStream;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
      });
    } catch (err) {
      // Try audio only, then give up
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err2) {
        this.localStream = null;
        throw err;
      }
    }
    for (const p of this.peers.values()) this.addLocalTracks(p.pc);
    return this.localStream;
  }

  setEnabled(kind, on) {
    if (!this.localStream) return;
    for (const tr of this.localStream.getTracks()) if (tr.kind === kind) tr.enabled = on;
  }

  hasTrack(kind) {
    return !!this.localStream && this.localStream.getTracks().some((t) => t.kind === kind);
  }

  start(myId, iceServers, peers) {
    this.myId = myId;
    this.iceServers = iceServers || [];
    for (const id of peers) this.ensurePeer(id);
  }

  addLocalTracks(pc) {
    if (!this.localStream) return;
    const senders = pc.getSenders();
    for (const track of this.localStream.getTracks()) {
      if (!senders.some((s) => s.track === track)) pc.addTrack(track, this.localStream);
    }
  }

  ensurePeer(id) {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    p = { pc, polite: this.myId > id, makingOffer: false, ignoreOffer: false, stream: null };
    this.peers.set(id, p);

    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        await pc.setLocalDescription();
        this.send(id, { description: pc.localDescription });
      } catch (err) {
        console.warn('negotiation failed', err);
      } finally {
        p.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send(id, { candidate });
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || p.stream || new MediaStream();
      if (!ev.streams[0]) stream.addTrack(ev.track);
      p.stream = stream;
      this.dispatchEvent(new CustomEvent('stream', { detail: { id, stream } }));
      ev.track.onunmute = () => this.dispatchEvent(new CustomEvent('stream', { detail: { id, stream } }));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.dispatchEvent(new CustomEvent('state', { detail: { id, state: pc.connectionState } }));
    };
    this.addLocalTracks(pc);
    return p;
  }

  send(to, data) {
    this.net.send({ t: 'signal', to, data });
  }

  async onSignal(from, data) {
    if (!data) return;
    const p = this.ensurePeer(from);
    const pc = p.pc;
    try {
      if (data.description) {
        const desc = data.description;
        const collision = desc.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          this.send(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!p.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('signal error', err);
    }
  }

  removePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
    this.dispatchEvent(new CustomEvent('left', { detail: { id } }));
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }
}
