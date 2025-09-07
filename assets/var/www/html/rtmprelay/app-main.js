// Entry: wiring, WHIP flow, start/stop, with RTMP URL validation
import {
  store, initDomRefs, setStatus, setConnInfo, updateUiForState,
  armWatchdog, disarmWatchdog, humanizeWhipError,
  initOvenLiveKit, installGlobalTraps, attachNetwork401Sniffer,
  userStop, stopSilently, validateRtmpUrl
} from './app-core.js';
import { acquireStream } from './app-media.js';

document.addEventListener('DOMContentLoaded', () => {
  initDomRefs();

  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    store.els.httpsWarn.style.display = 'inline-block';
  }

  const params = new URLSearchParams(location.search);
  const whipUrlPrefixRaw = params.get('url') || params.get('u') || '';
  const whipUrlPrefix = whipUrlPrefixRaw ? decodeURIComponent(whipUrlPrefixRaw) : '';

  initOvenLiveKit();
  installGlobalTraps();
  attachNetwork401Sniffer();

  (async function main() {
    try {
      await acquireStream();
    } catch (e) {
      store.els.enableBtn.style.display = 'inline-block';
      setStatus('Click the button to enable camera and mic', 'warn');
      updateUiForState('idle');
    }
  })();

  store.els.cameraSelect.addEventListener('change', () =>
    acquireStream({ video: store.els.cameraSelect.value, audio: store.els.micSelect.value })
  );
  store.els.micSelect.addEventListener('change', () =>
    acquireStream({ video: store.els.cameraSelect.value, audio: store.els.micSelect.value })
  );

  store.els.startBtn.addEventListener('click', async () => {
    if (!store.currentStream) {
      try { await acquireStream({ video: store.els.cameraSelect.value, audio: store.els.micSelect.value }); }
      catch (e) { setStatus('Access denied', 'err'); return; }
    }
    startStreaming(whipUrlPrefix);
  });

  store.els.stopBtn.addEventListener('click', userStop);

  store.els.enableBtn.addEventListener('click', async () => {
    try { await acquireStream(); store.els.enableBtn.style.display = 'none'; }
    catch (e) { setStatus('Access denied', 'err'); }
  });

  window.addEventListener('beforeunload', () => {
    disarmWatchdog();
    try { cancelAnimationFrame(store.meterRAF); } catch (e) {}
    if (store.currentStream) store.currentStream.getTracks().forEach(t => t.stop());
    try { store.olk?.stopStreaming?.(); } catch (e) {}
    try { store.olk?.remove?.(); } catch (e) {}
  });

  async function startStreaming(whipUrlPrefix) {
    const input = (store.els.publishUrl.value || '').trim();

    // --- RTMP URL validation ---
    const v = validateRtmpUrl(input);
    if (!v.ok) {
      setStatus(`Invalid RTMP URL: ${v.reason}
Example: rtmp://example.com/live/streamKey`, 'warn');
      return;
    }
    // Optional: normalize the input box (no trailing slash, no query/hash in display)
    store.els.publishUrl.value = v.normalized;

    if (!whipUrlPrefix) {
      setStatus('Missing WHIP prefix (?url= or ?u=)', 'warn');
      return;
    }

    const finalUrl = whipUrlPrefix + encodeURIComponent(v.normalized) + '?direction=whip';
    store.lastWhipUrl = finalUrl;

    try {
      if (location.protocol === 'https:') {
        const u = new URL(finalUrl);
        if (!(u.protocol === 'https:' || u.protocol === 'wss:')) {
          setStatus('On HTTPS pages, use https:// (WHIP) or wss:// signaling URLs', 'err');
          return;
        }
      }
      updateUiForState('connecting');
      setStatus('Connecting…');
      setConnInfo(`Posting WHIP to: ${finalUrl}`, 'warn');

      armWatchdog(finalUrl);

      const p = store.olk.startStreaming(finalUrl);
      if (p && typeof p.then === 'function') {
        await p; // success handled in 'connected'
      }
    } catch (err) {
      const friendly = humanizeWhipError(err, finalUrl);
      setStatus(friendly, 'err');
      stopSilently();
    }
  }
});
