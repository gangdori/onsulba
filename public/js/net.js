// 서버와의 WebSocket 연결 (끊기면 자동 재연결)
export class Net extends EventTarget {
  constructor() {
    super();
    this.session = sessionStorage.getItem('onsulba.session');
    if (!this.session) {
      this.session = crypto.randomUUID();
      sessionStorage.setItem('onsulba.session', this.session);
    }
    // 지갑(코인)은 기기 단위: 기기 ID 와, 서버가 서명해 준 지갑 사본을 보관한다
    this.device = localStorage.getItem('onsulba.device');
    if (!this.device) {
      this.device = crypto.randomUUID();
      localStorage.setItem('onsulba.device', this.device);
    }
    this.on('wallet', (m) => {
      try {
        localStorage.setItem('onsulba.wallet', JSON.stringify(m.token));
      } catch {
        /* 저장 불가(시크릿 모드 등) */
      }
    });
    this.retry = 0;
    this.connected = false;
    this.outbox = []; // 재연결 중에 보낸 메시지는 잠시 모아 둔다
    this.#open();
  }

  #open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws`));
    ws.onopen = () => {
      this.retry = 0;
      let wallet = null;
      try {
        wallet = JSON.parse(localStorage.getItem('onsulba.wallet') || 'null');
      } catch {
        /* 깨진 사본은 보내지 않는다 */
      }
      ws.send(JSON.stringify({ type: 'hello', session: this.session, device: this.device, wallet }));
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        this.connected = true;
        this.dispatchEvent(new CustomEvent('status', { detail: { connected: true } }));
      }
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
      if (msg.type === 'welcome') for (const m of this.outbox.splice(0)) this.send(m);
    };
    ws.onclose = (e) => {
      const was = this.connected;
      this.connected = false;
      if (e.code === 4001) {
        // 같은 세션이 다른 탭에서 열림 → 이 탭은 재연결하지 않는다
        this.dispatchEvent(new CustomEvent('status', { detail: { connected: false, replaced: true } }));
        return;
      }
      if (was || this.retry === 0) this.dispatchEvent(new CustomEvent('status', { detail: { connected: false } }));
      const delay = this.retry === 0 ? 150 : Math.min(8000, 400 * 2 ** this.retry);
      this.retry++;
      setTimeout(() => this.#open(), delay);
    };
  }

  on(type, fn) {
    this.addEventListener(type, (e) => fn(e.detail));
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN && this.connected) this.ws.send(JSON.stringify(msg));
    else if (['chat', 'rtc', 'order', 'call'].includes(msg.type) && this.outbox.length < 30) this.outbox.push(msg);
  }
}
