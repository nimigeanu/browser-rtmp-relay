// Shared state + UI helpers + watchdog + error mapping + OLK init + traps + 401 sniffer + RTMP validator

export const store = {
  olk: null,
  devicesReady: false,
  currentStream: null,
  audioContext: null,
  analyser: null,
  meterRAF: 0,
  connectTimer: null,
  lastWhipUrl: '',
  els: {
    preview: null, status: null, httpsWarn: null, publishUrl: null,
    cameraSelect: null, micSelect: null, micBar: null, micDb: null,
    audioState: null, enableBtn: null, startBtn: null, stopBtn: null, connInfo: null,
  },
};

export function initDomRefs() {
  const byId = (id) => document.getElementById(id);
  store.els = {
    preview: byId('preview'),
    status: byId('status'),
    httpsWarn: byId('httpsWarn'),
    publishUrl: byId('publishUrl'),
    cameraSelect: byId('cameraSelect'),
    micSelect: byId('micSelect'),
    micBar: byId('micBar'),
    micDb: byId('micDb'),
    audioState: byId('audioState'),
    enableBtn: byId('enableBtn'),
    startBtn: byId('startBtn'),
    stopBtn: byId('stopBtn'),
    connInfo: byId('connInfo'),
  };
}

export function setStatus(msg, kind) {
  const el = store.els.status;
  if (!el) return;
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}
export function setConnInfo(msg, kind) {
  const el = store.els.connInfo;
  if (!el) return;
  el.textContent = msg;
  el.className = 'footer' + (kind ? ' ' + kind : '');
}
export function updateUiForState(state) {
  const { publishUrl, cameraSelect, micSelect, startBtn, stopBtn } = store.els;
  const busy = (state === 'connecting' || state === 'live');
  publishUrl.disabled = busy;
  cameraSelect.disabled = busy;
  micSelect.disabled = busy;
  startBtn.disabled = busy;
  stopBtn.disabled = !busy;
  document.body.dataset.state = state;
}

// Watchdog
export function armWatchdog(finalUrl) {
  disarmWatchdog();
  store.connectTimer = setTimeout(() => {
    setStatus(
      `No response from WHIP (timeout).\n• Check rtmprelay auth/allowlist\n• Verify CORS/HTTPS\n• Ensure RTMP is permitted\n(${finalUrl})`,
      'err'
    );
    setConnInfo('Not connected', 'warn');
    updateUiForState('idle');
  }, 8000);
}
export function disarmWatchdog() {
  if (store.connectTimer) {
    clearTimeout(store.connectTimer);
    store.connectTimer = null;
  }
}

// Friendly error messages
export function humanizeWhipError(err, urlTried) {
  const status = err?.status || err?.code || err?.statusCode;
  const msg = (err?.message || '').toLowerCase();

  if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return `Network/URL failed: The browser couldn’t broadcast to WHIP.
• Verify your RTMP URL is correct.
• Verify the host is reachable.
• Page and endpoint must be HTTPS/WSS.
(${urlTried})`;
  }
  if (status === 401 || msg.includes('401')) {
    return `401 Unauthorized: The WHIP endpoint rejected the request.
• Check rtmprelay auth/allowlist and WHIP prefix.
• Verify your RTMP URL is permitted.
(${urlTried})`;
  }
  if (status === 403 || msg.includes('403')) {
    return `403 Forbidden: Endpoint reachable but access is denied.
• Check token/allowlist/permissions.
(${urlTried})`;
  }
  if (status === 404 || msg.includes('404')) {
    return `404 Not Found: The WHIP path may be incorrect on rtmprelay.
(${urlTried})`;
  }
  if (status === 405 || msg.includes('405')) {
    return `405 Method Not Allowed: rtmprelay may not accept this method at that path.
(${urlTried})`;
  }
  if (typeof status === 'number') {
    return `HTTP ${status}: ${err?.statusText || 'Request failed'}
(${urlTried})`;
  }
  return `Start failed: ${err?.message || err}
(${urlTried})`;
}

// --- Stop helpers ---
export function userStop() {
  disarmWatchdog();
  try { store.olk?.stopStreaming?.(); } catch {}
  setStatus('Stopped');
  setConnInfo('Not connected', 'warn');
  updateUiForState('idle');
}
export function stopSilently() {
  disarmWatchdog();
  try { store.olk?.stopStreaming?.(); } catch {}
  setConnInfo('Not connected', 'warn');
  updateUiForState('idle');
}

// OvenLiveKit init
export function initOvenLiveKit() {
  store.olk = OvenLiveKit.create({
    callbacks: {
      error: (err) => {
        const friendly = humanizeWhipError(err, 'WHIP');
        setStatus(friendly, 'err');
        stopSilently();
      },
      connected: (evt) => {
        disarmWatchdog();
        const state =
          typeof evt === 'string'
            ? evt
            : (evt?.target?.iceConnectionState || evt?.iceConnectionState || 'connected');
        setConnInfo(`Connected (ICE: ${state})`, 'ok');
        setStatus('Live — streaming');
        updateUiForState('live');
      },
      connectionClosed: (type, evt) => {
        disarmWatchdog();
        const state =
          typeof evt === 'string'
            ? evt
            : (evt?.target?.iceConnectionState || evt?.iceConnectionState || 'closed');
        setConnInfo(`Connection closed (${type}${state ? `: ${state}` : ''})`, 'warn');
        setStatus('Stopped');
        updateUiForState('idle');
      },
      iceStateChange: (evt) => {
        const state =
          typeof evt === 'string'
            ? evt
            : (evt?.target?.iceConnectionState || evt?.iceConnectionState || 'unknown');
        setConnInfo(`ICE state: ${state}`);
      }
    }
  });
}

// Global traps
export function installGlobalTraps() {
  window.addEventListener('unhandledrejection', (e) => {
    const txt = humanizeWhipError(e.reason || e, 'WHIP/unhandled');
    setStatus(txt, 'err');
    stopSilently();
  });
  window.addEventListener('error', (e) => {
    const m = String(e?.message || '').toLowerCase();
    if (m.includes('failed to fetch') || m.includes('network')) {
      setStatus(`Network error: ${e.message}`, 'err');
      stopSilently();
    }
  });
}

// 401 sniffer (fetch + XHR)
export function attachNetwork401Sniffer() {
  // fetch
  if (window.fetch && !window.__olk401FetchPatched) {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const res = await nativeFetch(input, init);
      if (method === 'POST' && store.lastWhipUrl && url && url.indexOf(store.lastWhipUrl) === 0 && res && res.status === 401) {
        const friendly = humanizeWhipError({ status: 401, statusText: res.statusText }, url);
        setStatus(friendly, 'err');
        stopSilently();
        throw new Error('WHIP 401 Unauthorized');
      }
      return res;
    };
    window.__olk401FetchPatched = true;
  }
  // XHR
  const XHR = window.XMLHttpRequest;
  if (XHR && !XHR.prototype.__olk401Patched) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__whipInfo = { method: String(method || '').toUpperCase(), url: String(url || '') };
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      this.addEventListener('loadend', function () {
        const info = this.__whipInfo || {};
        if (info.method === 'POST' && store.lastWhipUrl && info.url && info.url.indexOf(store.lastWhipUrl) === 0 && this.status === 401) {
          const friendly = humanizeWhipError({ status: 401, statusText: this.statusText }, info.url);
          setStatus(friendly, 'err');
          stopSilently();
        }
      });
      return send.apply(this, arguments);
    };
    XHR.prototype.__olk401Patched = true;
  }
}

/* ---------------------------
   RTMP URL VALIDATOR
---------------------------- */
function decodeSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/**
 * Validate RTMP/RTMPS URL structure:
 *  - scheme: rtmp:// or rtmps://
 *  - host present
 *  - path has at least two non-empty segments: /app/streamKey
 *  - optional port in [1..65535]
 *  - path segments contain common safe chars (alnum, . _ ~ - : @ % +)
 */
export function validateRtmpUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'Empty URL' };
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    // If user forgot the scheme, this makes the error clearer
    return { ok: false, reason: 'Missing or invalid scheme. Use rtmp:// or rtmps://' };
  }

  if (!(u.protocol === 'rtmp:' || u.protocol === 'rtmps:')) {
    return { ok: false, reason: 'Protocol must be rtmp:// or rtmps://' };
  }
  if (!u.hostname) {
    return { ok: false, reason: 'Missing host' };
  }
  if (u.port) {
    const p = Number(u.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return { ok: false, reason: 'Invalid port' };
    }
  }

  const segs = (u.pathname || '').split('/').filter(Boolean);
  if (segs.length < 2) {
    return { ok: false, reason: 'Path must be /app/streamKey (missing app or stream key)' };
  }

  // Allow common safe characters; % to allow encoded chars; @ and : for userinfo in stream/app names, + for typical keys
  const allowed = /^[A-Za-z0-9._~\-:@%+]+$/;
  for (const s of segs) {
    if (!allowed.test(s)) {
      return { ok: false, reason: `Unexpected character in path segment "${decodeSafe(s)}"` };
    }
  }

  // Note: we allow query and hash (some relays use tokens in query); not part of "normalized"
  const normalized = `${u.protocol}//${u.host}/${segs.join('/')}`;
  return {
    ok: true,
    normalized,
    protocol: u.protocol.replace(':', ''),
    host: u.host,
    app: segs[0],
    streamKey: segs.slice(1).join('/'),
    hasQuery: !!u.search,
  };
}
