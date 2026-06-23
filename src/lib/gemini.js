export const MODELS = [
  ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite (default, fast & modern)'],
  ['gemini-3.5-flash',      'Gemini 3.5 Flash (latest, strongest Flash)'],
  ['gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview (most capable, premium)'],
  ['gemma-4-26b-a4b-it',    'Gemma 4 26B IT (open model, strong & free)'],
  ['gemma-4-31b-it',        'Gemma 4 31B IT (larger open model)'],
  ['gemini-2.5-flash',      'Gemini 2.5 Flash (older fallback)']
];

const AIR_OK = [0x71, 0x75, 0x69, 0x7A, 0x74, 0x6F, 0x6F, 0x6C];

function obfuscate(str) {
  const ok = AIR_OK, out = [];
  for (let i = 0; i < str.length; i++) out.push(str.charCodeAt(i) ^ ok[i % ok.length]);
  return btoa(String.fromCharCode.apply(null, out));
}

function deobfuscate(encoded) {
  try {
    const ok = AIR_OK, raw = atob(encoded);
    const out = [];
    for (let i = 0; i < raw.length; i++) out.push(raw.charCodeAt(i) ^ ok[i % ok.length]);
    return String.fromCharCode.apply(null, out);
  } catch (e) { return ''; }
}

export function readKey() {
  const r = localStorage.getItem('gemini_api_key');
  if (!r) return '';
  return deobfuscate(r) || r;
}

export function writeKey(plain) {
  if (plain) localStorage.setItem('gemini_api_key', obfuscate(plain));
  else localStorage.removeItem('gemini_api_key');
}

export function hasKey() { return !!readKey(); }

export function extractText(payload) {
  if (!payload || !payload.candidates || !payload.candidates[0]) {
    const reason = payload?.candidates?.[0]?.finishReason || 'UNKNOWN';
    throw new Error('Gemini response missing content. finishReason=' + reason);
  }
  const parts = payload.candidates[0].content?.parts;
  if (!parts || parts.length === 0) throw new Error('Gemini returned no parts. finishReason=' + (payload.candidates[0].finishReason || 'UNKNOWN'));
  return parts.map(p => p.text || '').join('').trim();
}

export function friendlyError(err) {
  return (err?.message ? err.message : String(err || 'Unknown AI error')).replace(/\s+/g, ' ').trim();
}

export function request(systemPrompt, contents, apiKey, model, cancelSignal, temperature, maxWaitMs) {
  if (temperature === undefined) temperature = 0.4;
  const controller = maxWaitMs > 0 ? new AbortController() : null;
  let timeoutId = null;
  if (controller) timeoutId = setTimeout(() => controller.abort(), maxWaitMs);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature }
  });
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body,
    signal: controller ? controller.signal : (cancelSignal || null)
  }).then(r => r.text().then(text => {
    if (!r.ok) {
      try { const pe = JSON.parse(text); if (pe?.error?.message) throw new Error(pe.error.message); } catch (e) { if (e.message) throw e; }
      throw new Error('Gemini API error ' + r.status);
    }
    return extractText(JSON.parse(text));
  })).finally(() => { if (timeoutId) clearTimeout(timeoutId); });
}

export function tryRequests(systemPrompt, contents, apiKey, model, models, cancelSignal, temperature, maxWaitMs, onFallback) {
  const attempts = [{ model }];
  const fallback = models?.[0]?.[0];
  if (fallback && fallback !== model) attempts.push({ model: fallback });
  let idx = 0;
  const next = () => {
    if (idx >= attempts.length) return Promise.reject(new Error('All Gemini models exhausted'));
    const att = attempts[idx++];
    return request(systemPrompt, contents, apiKey, att.model, cancelSignal, temperature, maxWaitMs)
      .catch(err => {
        if (idx < attempts.length) {
          if (onFallback) onFallback(attempts[idx].model);
          return next();
        }
        throw err;
      });
  };
  return next();
}

export function getClient(apiKey) {
  return {
    apiKey,
    request: (systemPrompt, contents, model, temperature, cancelSignal) =>
      request(systemPrompt, contents, apiKey, model, cancelSignal, temperature),
    tryRequests: (systemPrompt, contents, model, cancelSignal, temperature, onFallback) =>
      tryRequests(systemPrompt, contents, apiKey, model, MODELS, cancelSignal, temperature, 15000, onFallback),
    extractText,
    friendlyError,
    readKey,
    writeKey,
    hasKey,
  };
}

export async function streamGenerate(systemPrompt, userPrompt, apiKey, model, onChunk, cancelSignal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4 }
    }),
    signal: cancelSignal || null,
  });
  if (!res.ok) throw new Error(`Gemini streaming error ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const text = extractText(parsed);
          if (text && onChunk) onChunk(text);
        } catch (_) { /* skip malformed chunks */ }
      }
    }
  }
}
