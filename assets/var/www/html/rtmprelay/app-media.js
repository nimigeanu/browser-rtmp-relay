// Device enumeration + stream acquisition + mic meter
import { store, setStatus, updateUiForState } from './app-core.js';

export async function refreshDevices() {
  try {
    const { videoinput = [], audioinput = [] } = await OvenLiveKit.getDevices('both');
    fillSelect(store.els.cameraSelect, videoinput);
    fillSelect(store.els.micSelect, audioinput);
  } catch (e) {
    console.warn('Device enumeration failed', e);
  }
}

function fillSelect(sel, list) {
  const current = sel.value;
  sel.innerHTML = '';
  for (const d of list) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || d.deviceId;
    sel.appendChild(opt);
  }
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

export async function acquireStream(deviceIds) {
  const constraints = {
    video: deviceIds?.video ? { deviceId: { exact: deviceIds.video } } : true,
    audio: deviceIds?.audio ? { deviceId: { exact: deviceIds.audio } } : true
  };
  if (store.currentStream) store.currentStream.getTracks().forEach(t => t.stop());

  store.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  store.els.preview.srcObject = store.currentStream;

  store.olk.setMediaStream(store.currentStream);
  store.olk.attachMedia(store.els.preview);

  startMicMeter(store.currentStream);

  await refreshDevices();
  syncSelectValueToCurrentTracks();

  setStatus('Devices ready');
  updateUiForState('idle');
}

function syncSelectValueToCurrentTracks() {
  const vTrack = store.currentStream?.getVideoTracks?.()[0];
  const aTrack = store.currentStream?.getAudioTracks?.()[0];
  const vId = vTrack?.getSettings?.().deviceId;
  const aId = aTrack?.getSettings?.().deviceId;
  if (vId && [...store.els.cameraSelect.options].some(o => o.value === vId)) {
    store.els.cameraSelect.value = vId;
  }
  if (aId && [...store.els.micSelect.options].some(o => o.value === aId)) {
    store.els.micSelect.value = aId;
  }
}

function startMicMeter(stream) {
  try {
    if (!store.audioContext) store.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (store.audioContext.state === 'suspended') store.audioContext.resume();

    const source = store.audioContext.createMediaStreamSource(stream);
    store.analyser = store.audioContext.createAnalyser();
    store.analyser.fftSize = 1024;
    source.connect(store.analyser);

    const data = new Uint8Array(store.analyser.fftSize);
    cancelAnimationFrame(store.meterRAF);
    const loop = () => {
      store.analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const pct = Math.min(100, Math.round(rms * 140));
      store.els.micBar.style.width = pct + '%';
      store.els.micDb.textContent = pct + '%';
      store.meterRAF = requestAnimationFrame(loop);
    };
    loop();
    store.els.audioState.textContent = 'audio active';
  } catch (e) {
    console.warn('Mic meter failed', e);
    store.els.audioState.textContent = 'audio unavailable';
  }
}
