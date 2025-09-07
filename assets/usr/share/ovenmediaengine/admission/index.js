const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = 9595;

// === Config: incoming (receiving) app ===
const INCOMING_APP = process.env.INCOMING_APP || 'rtmprelay';

// ---- OME API auth/config ----
const key = 'Y54wlJtxc4K1NuAXbTaf';
const encoded = Buffer.from(key).toString('base64');
const OME_API_BASE_URL = 'http://127.0.0.1:8081/v1/vhosts/default/apps';
const OME_API_AUTH_HEADER = {
  'Authorization': `Basic ${encoded}`,
  'Content-Type': 'application/json'
};

app.use(express.json());

function newEventId() {
  return crypto.randomBytes(4).toString('hex'); // 8-char id
}
function logCtx(id, msg, obj) {
  if (obj !== undefined) {
    console.log(`[${id}] ${msg}`, typeof obj === 'string' ? obj : JSON.stringify(obj));
  } else {
    console.log(`[${id}] ${msg}`);
  }
}
function logReject(id, reason, extra) { logCtx(id, `❌ REJECT: ${reason}`, extra); }
function logAccept(id, reason, extra) { logCtx(id, `✅ ACCEPT: ${reason}`, extra); }

function maskRtmp(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length >= 2) {
      const key = segs[segs.length - 1];
      const masked = key.length <= 6 ? '***' : key.slice(0, 3) + '***' + key.slice(-3);
      segs[segs.length - 1] = masked;
      u.pathname = '/' + segs.join('/');
      return u.toString();
    }
    return url;
  } catch { return url; }
}

/**
 * Parse the OME admission request URL (HTTPS/WSS/etc) and extract:
 *   - app (first path segment, e.g. 'rtmprelay')
 *   - streamName (remaining path, WITHOUT the query string)
 * Works with URLs like:
 *   https://rtmprelay.example/rtmprelay/rtmp%3A%2F%2Fhost%2Fapp%2Fkey?direction=whip
 */
function parseIncomingAdmissionUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null; // need at least app + streamName
    const app = parts[0];
    const streamName = parts.slice(1).join('/'); // do NOT include u.search
    return { scheme: u.protocol.replace(':',''), host: u.hostname, app, streamName };
  } catch {
    return null;
  }
}

/** Parse an RTMP URL into {protocol, host, port, app, stream} */
function parseRtmpUrl(url) {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(':', '').toLowerCase();
    if (protocol !== 'rtmp') return null;

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const app = pathParts[0] || null;

    const streamParts = pathParts.slice(1);
    const streamPath = streamParts.join('/');
    const queryString = parsed.search; // includes ?...
    const stream = (streamPath + queryString) || null;

    if (!app || !stream) return null;

    return {
      protocol,
      host: parsed.hostname,
      port: parsed.port || '1935',
      app,
      stream
    };
  } catch {
    return null;
  }
}

// Admission Webhook route
app.post('/v1/admission', async (req, res) => {
  const id = newEventId();
  console.log(' ');
  console.log('++++++++++++++++++++++++++++++++++++++++');
  logCtx(id, '🆕 Admission request body:', req.body);

  const direction = req.body?.request?.direction;
  const status    = req.body?.request?.status;
  const reqUrl    = req.body?.request?.url;
  logCtx(id, 'Context', { direction, status, reqUrl });

  if (!direction) {
    logReject(id, 'missing direction');
    res.status(200).json({ allowed: false, reason: 'missing direction' });
    console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
  }
  if (direction !== 'incoming') {
    logCtx(id, 'Ignoring non-incoming request');
    res.status(200).json({});
    console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
  }
  if (!status) {
    logReject(id, 'missing status');
    res.status(200).json({ allowed: false, reason: 'missing status' });
    console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
  }
  if (!reqUrl) {
    logReject(id, 'missing request.url');
    res.status(200).json({ allowed: false, reason: 'missing request.url' });
    console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
  }

  if (status === 'opening') {
    // ✅ Correctly detach the stream name from the HTTPS/WEBSOCKET context
    const incoming = parseIncomingAdmissionUrl(reqUrl);
    if (!incoming) {
      logReject(id, 'cannot parse incoming admission URL', { reqUrl });
      res.status(200).json({ allowed: false, reason: 'invalid incoming admission URL' });
      console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
    }
    logCtx(id, 'Parsed admission URL', incoming);

    if (incoming.app !== INCOMING_APP) {
      logReject(id, `unexpected app '${incoming.app}' (expected '${INCOMING_APP}')`);
      res.status(200).json({ allowed: false, reason: `unexpected app: ${incoming.app}` });
      console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
    }

    const streamName = (incoming.streamName || '').split('?')[0]; // drop admission query like ?direction=whip
    logCtx(id, 'Extracted streamName', streamName);

    if (!streamName) {
      logReject(id, 'missing stream name on incoming URL', { reqUrl });
      res.status(200).json({ allowed: false, reason: 'missing stream name' });
      console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
    }

    // Must be a URL-encoded RTMP URL (e.g., rtmp%3A%2F%2Fhost%2Fapp%2Fkey)
    if (!/^rtmp%3A%2F%2F/i.test(streamName)) {
      logReject(id, 'stream name is not URL-encoded RTMP URL (rtmp%3A%2F%2F...)', { streamName });
      res.status(200).json({
        allowed: false,
        reason: 'stream name must be URL-encoded RTMP URL (rtmp%3A%2F%2F...)'
      });
      console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
    }

    let pushUrl;
    try {
      pushUrl = decodeURIComponent(streamName);
    } catch (e) {
      logReject(id, 'cannot decode URL-encoded RTMP URL', { streamName, error: String(e) });
      res.status(200).json({ allowed: false, reason: 'cannot decode URL-encoded RTMP URL' });
      console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
    }

    const parsedPush = parseRtmpUrl(pushUrl);
    if (!parsedPush) {
      logReject(id, 'decoded value is not a valid RTMP URL', { pushUrl: maskRtmp(pushUrl) });
      res.status(200).json({ allowed: false, reason: 'decoded value is not a valid RTMP URL' });
      console.log('++++++++++++++++++++++++++++++++++++++++\n'); return;
    }

    logAccept(id, 'incoming accepted; will push-publish to decoded RTMP URL', {
      pushUrl: maskRtmp(pushUrl),
      parsedPush
    });

    res.status(200).json({ allowed: true, lifetime: 0, reason: 'authorized' });

    await updatePushPublish(id, streamName, pushUrl);
  }
  else if (status === 'closing') {
    logCtx(id, 'Incoming status=closing, scheduling cleanup');
    res.status(200).json({});
    scheduleCleanupPushes();
  } else {
    logCtx(id, `Status ${status} acknowledged (no action)`);
    res.status(200).json({});
  }

  console.log('++++++++++++++++++++++++++++++++++++++++\n');
});

let cleanupPushesTimeout = null;

function scheduleCleanupPushes(){
  if (cleanupPushesTimeout != null){
    clearTimeout(cleanupPushesTimeout);
  }
  cleanupPushesTimeout = setTimeout(cleanupPushes, 60 * 1000);
}

async function cleanupPushes(){
  const id = newEventId();
  logCtx(id, 'cleanupPushes() begin');
  cleanupPushesTimeout = null;

  const pushesData = await callOmeApi('rtmprelay:pushes');
  const pushingStreams = Array.isArray(pushesData.response)
    ? pushesData.response.map(item => item.stream.name)
    : [];
  logCtx(id, 'Currently pushing streams', pushingStreams);

  const streamsData = await callOmeApi('rtmprelay/streams');
  const activeStreams = Array.isArray(streamsData.response) ? streamsData.response : [];
  logCtx(id, 'Active incoming streams', activeStreams);

  const inactivePushingStreams = pushingStreams.filter(
    stream => !activeStreams.includes(stream)
  );

  if (inactivePushingStreams.length === 0) {
    logCtx(id, 'No stale pushes to stop');
  }

  for (const stream of inactivePushingStreams) {
    logCtx(id, 'Stopping stale push for stream', stream);
    await stopPushPublish(id, stream);
  }
  logCtx(id, 'cleanupPushes() end');
}

async function updatePushPublish(id, stream, pushUrl){
  logCtx(id, 'updatePushPublish', { stream, pushUrl: maskRtmp(pushUrl) });

  const current = await checkRunningPushPublish(id, stream);
  logCtx(id, 'Currently publishing to', current ? maskRtmp(current) : null);

  if (pushUrl != null){
    if (current === pushUrl){
      logCtx(id, `No-op; already publishing to desired target`);
      return;
    }
    if (current != null){
      logCtx(id, 'Stopping existing push before switching');
      await stopPushPublish(id, stream);
      await wait(5);
    }
    await startPushPublish(id, stream, pushUrl);
  } else {
    if (current != null){
      logCtx(id, 'Stopping push (pushUrl=null and a current push exists)');
      await stopPushPublish(id, stream);
    } else {
      logCtx(id, 'No-op; not publishing anyway');
    }
  }
}

function wait(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function callOmeApi(endpoint, options = {}) {
  console.log('📡⬆️ ', endpoint);
  const url = `${OME_API_BASE_URL}/${endpoint}`;
  try {
    const res = await fetch(url, {
      headers: OME_API_AUTH_HEADER,
      ...options
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`❌ [${endpoint}] API call failed:`, err.message);
    throw err;
  }
}

async function stopPushPublish(id, stream) {
  logCtx(id, 'stopPushPublish', { stream });
  const body = { id: `rtmprelay_push_${stream}` };
  logCtx(id, 'stopPushPublish body', body);
  try {
    const result = await callOmeApi('rtmprelay:stopPush', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    logCtx(id, 'RTMP Push Stopped', result);
  } catch (e) {
    logCtx(id, 'stopPushPublish error (ignored)', String(e));
  }
}

async function startPushPublish(id, stream, pushUrl) {
  logCtx(id, 'startPushPublish', { stream, pushUrl: maskRtmp(pushUrl) });

  const parsed = parseRtmpUrl(pushUrl);
  if (!parsed) {
    logReject(id, 'startPushPublish: invalid RTMP URL', { pushUrl: maskRtmp(pushUrl) });
    return;
  }

  const body = {
    id: `rtmprelay_push_${stream}`,
    stream: { name: stream },
    protocol: 'rtmp',
    url: `rtmp://${parsed.host}/${parsed.app}`,
    streamKey: parsed.stream
  };

  logCtx(id, 'startPushPublish body', { ...body, streamKey: '***masked***' });

  try {
    const result = await callOmeApi('rtmprelay:startPush', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    logCtx(id, 'RTMP Push Created', result);
  } catch (e) {
    logReject(id, 'startPushPublish failed', String(e));
  }
}

async function checkRunningPushPublish(id, streamName) {
  logCtx(id, 'checkRunningPushPublish', streamName);
  try {
    const pushesData = await callOmeApi('rtmprelay:pushes');
    if (!Array.isArray(pushesData.response)) return null;

    const match = pushesData.response.find(item => item.id === `rtmprelay_push_${streamName}`);
    const current = match ? `${match.url}/${match.streamKey}` : null;
    logCtx(id, 'Running push target', current ? maskRtmp(current) : null);
    return current;
  } catch (e) {
    logCtx(id, 'checkRunningPushPublish error (returning null)', String(e));
    return null;
  }
}

// 👇 Catch-all logger for all other routes/methods
app.use((req, res) => {
  const id = newEventId();
  console.warn(`[${id}] ⚠️  Unhandled request: ${req.method} ${req.originalUrl}`);
  res.status(404).send('Not found');
});

// Start server
app.listen(PORT, () => {
  console.log(`🟢 OME webhook server listening on port ${PORT}`);
});
