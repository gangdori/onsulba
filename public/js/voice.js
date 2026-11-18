// 옆자리 손님과의 1:1 음성 통화 (WebRTC, 서버는 연결 신호만 중계)
// 상태: idle → calling(거는 중) | ringing(받는 중) → connecting → active

const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };

export class Voice extends EventTarget {
  constructor(net, audioEl) {
    super();
    this.net = net;
    this.audioEl = audioEl;
    this.iceServers = [];
    this.state = 'idle';
    this.peerId = null;
    this.muted = false;
    this.startedAt = 0;
    net.on('call', (m) => this.#onCall(m));
    net.on('rtc', (m) => this.#onRtc(m));
    net.on('status', (s) => {
      // 연결된 통화는 P2P라 서버 연결이 잠깐 끊겨도 유지한다
      if (!s.connected && this.state !== 'idle' && this.state !== 'active') this.#finish('disconnected');
    });
    net.on('welcome', (m) => {
      // 다시 연결됐는데 서버가 이 통화를 모르면(자리 만료·서버 재시작) 정리
      if (this.state === 'active' && m.callPeer !== this.peerId) this.#finish('disconnected');
    });
  }

  #set(state, extra = {}) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('change', { detail: { state, peerId: this.peerId, ...extra } }));
  }

  async #mic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error('insecure'), { userMessage: '통화는 HTTPS(보안 연결)로 접속했을 때만 쓸 수 있어요.' });
    }
    try {
      return await navigator.mediaDevices.getUserMedia(MIC);
    } catch (err) {
      const denied = err.name === 'NotAllowedError' || err.name === 'SecurityError';
      throw Object.assign(err, {
        userMessage: denied ? '마이크 권한이 필요해요. 브라우저 설정에서 마이크를 허용해 주세요.' : '마이크를 찾을 수 없어요.',
      });
    }
  }

  /** 전화 걸기 */
  async invite(peerId) {
    if (this.state !== 'idle') return;
    this.peerId = peerId;
    this.#set('calling');
    try {
      const stream = await this.#mic();
      if (this.state !== 'calling' || this.peerId !== peerId) return stream.getTracks().forEach((t) => t.stop());
      this.local = stream;
    } catch (err) {
      return this.#finish('mic', err.userMessage);
    }
    this.net.send({ type: 'call', action: 'invite', to: peerId });
  }

  /** 걸려 온 전화 받기 */
  async accept() {
    if (this.state !== 'ringing') return;
    const peerId = this.peerId;
    this.#set('connecting');
    try {
      const stream = await this.#mic();
      if (this.state !== 'connecting' || this.peerId !== peerId) return stream.getTracks().forEach((t) => t.stop());
      this.local = stream;
    } catch (err) {
      this.net.send({ type: 'call', action: 'decline', to: peerId });
      return this.#finish('mic', err.userMessage);
    }
    this.#createPeer();
    this.net.send({ type: 'call', action: 'accept', to: peerId });
  }

  decline() {
    if (this.state !== 'ringing') return;
    this.net.send({ type: 'call', action: 'decline', to: this.peerId });
    this.#finish('declined-by-me');
  }

  hangup() {
    if (this.state === 'idle') return;
    this.net.send({ type: 'call', action: 'end' });
    this.#finish('hangup-by-me');
  }

  toggleMute() {
    this.muted = !this.muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    this.#set(this.state);
    return this.muted;
  }

  #createPeer() {
    const pc = (this.pc = new RTCPeerConnection({ iceServers: this.iceServers }));
    this.pendingIce = [];
    for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.net.send({ type: 'rtc', to: this.peerId, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      this.remote = e.streams[0] || new MediaStream([e.track]);
      this.audioEl.srcObject = this.remote;
      this.audioEl.play().catch(() => {});
      this.#meter();
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'connected' && this.state === 'connecting') {
        this.startedAt = Date.now();
        this.#set('active');
      } else if (pc.connectionState === 'failed') {
        this.net.send({ type: 'call', action: 'end' });
        this.#finish('failed', '통화 연결에 실패했어요. 네트워크 환경을 확인해 주세요.');
      }
    };
    return pc;
  }

  async #onCall(m) {
    switch (m.action) {
      case 'invite':
        // 서버가 통화 중이 아닐 때만 보내 준다
        this.peerId = m.from;
        this.#set('ringing');
        break;
      case 'accept': {
        if (this.state !== 'calling' || m.from !== this.peerId) return;
        this.#set('connecting');
        const pc = this.#createPeer();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.net.send({ type: 'rtc', to: this.peerId, data: { sdp: pc.localDescription } });
        break;
      }
      case 'decline':
        if (m.from === this.peerId) this.#finish('declined');
        break;
      case 'busy':
        if (m.from === this.peerId) this.#finish('busy');
        break;
      case 'unavailable':
        if (m.from === this.peerId) this.#finish('unavailable');
        break;
      case 'end':
        if (m.from === this.peerId) this.#finish(m.reason || 'hangup');
        break;
    }
  }

  async #onRtc(m) {
    const pc = this.pc;
    if (!pc || m.from !== this.peerId) return;
    try {
      if (m.data.sdp) {
        await pc.setRemoteDescription(m.data.sdp);
        if (m.data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.net.send({ type: 'rtc', to: this.peerId, data: { sdp: pc.localDescription } });
        }
        for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c);
      } else if (m.data.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(m.data.candidate);
        else this.pendingIce.push(m.data.candidate);
      }
    } catch (err) {
      console.warn('rtc signal error', err);
    }
  }

  /** 말하는 중 표시를 위한 음량 측정 */
  #meter() {
    try {
      this.audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      this.audioCtx.resume?.();
      const make = (stream) => {
        const an = this.audioCtx.createAnalyser();
        an.fftSize = 256;
        this.audioCtx.createMediaStreamSource(stream).connect(an);
        return an;
      };
      const meters = { local: make(this.local), remote: make(this.remote) };
      const buf = new Uint8Array(128);
      const level = (an) => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) sum += (b - 128) ** 2;
        return Math.sqrt(sum / buf.length) / 128;
      };
      clearInterval(this.meterTimer);
      this.meterTimer = setInterval(() => {
        this.dispatchEvent(
          new CustomEvent('level', { detail: { local: !this.muted && level(meters.local) > 0.03, remote: level(meters.remote) > 0.03 } }),
        );
      }, 120);
    } catch {
      /* 음량 표시는 없어도 통화에는 지장 없음 */
    }
  }

  #finish(reason, message) {
    const peerId = this.peerId;
    clearInterval(this.meterTimer);
    this.meterTimer = null;
    if (this.pc) {
      this.pc.onicecandidate = this.pc.ontrack = this.pc.onconnectionstatechange = null;
      this.pc.close();
    }
    this.pc = null;
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = this.remote = null;
    this.audioEl.srcObject = null;
    this.muted = false;
    this.peerId = null;
    this.startedAt = 0;
    this.#set('idle', { reason, message, lastPeer: peerId });
  }
}
