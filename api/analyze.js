// ─── RATE LIMIT CONFIG ────────────────────────────────────────────
// Each single analysis = 5 API calls
// Compare mode (3 docs) = 15 API calls sequentially + 1 comparison = 16 total
// Limits below are per IP address
const LIMITS = {
  PER_MINUTE:  30,   // max 30 calls/min — handles sequential single doc (5 calls) + compare mode
  PER_HOUR:   150,   // max 150 calls/hour
  PER_DAY:    500,   // max 500 calls/day
};

// In-memory store (resets on cold start — fine for basic protection)
const ipStore = new Map();

function getRateLimitData(ip) {
  const now = Date.now();
  if (!ipStore.has(ip)) {
    ipStore.set(ip, { calls: [], blocked: false, blockedUntil: 0 });
  }
  const data = ipStore.get(ip);
  data.calls = data.calls.filter(t => now - t < 24 * 60 * 60 * 1000);
  return data;
}

function checkRateLimit(ip) {
  const now = Date.now();
  const data = getRateLimitData(ip);

  if (data.blocked && data.blockedUntil > now) {
    const minutesLeft = Math.ceil((data.blockedUntil - now) / 60000);
    return { allowed: false, reason: `Too many requests. Try again in ${minutesLeft} minute(s).` };
  }
  if (data.blocked && data.blockedUntil <= now) data.blocked = false;

  const callsLastMinute = data.calls.filter(t => now - t < 60 * 1000).length;
  const callsLastHour   = data.calls.filter(t => now - t < 60 * 60 * 1000).length;
  const callsLastDay    = data.calls.filter(t => now - t < 24 * 60 * 60 * 1000).length;

  if (callsLastMinute >= LIMITS.PER_MINUTE) {
    data.blocked = true;
    data.blockedUntil = now + 2 * 60 * 1000;
    return { allowed: false, reason: 'Too many requests. Please wait 2 minutes.' };
  }
  if (callsLastHour >= LIMITS.PER_HOUR) {
    data.blocked = true;
    data.blockedUntil = now + 30 * 60 * 1000;
    return { allowed: false, reason: 'Hourly limit reached. Please try again in 30 minutes.' };
  }
  if (callsLastDay >= LIMITS.PER_DAY) {
    data.blocked = true;
    data.blockedUntil = now + 60 * 60 * 1000;
    return { allowed: false, reason: 'Daily limit reached. Please try again later.' };
  }
  return { allowed: true };
}

function recordCall(ip) {
  const data = getRateLimitData(ip);
  data.calls.push(Date.now());
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function isSuspicious(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const botPatterns = ['curl', 'wget', 'python-requests', 'go-http', 'scrapy', 'httpclient', 'libwww'];
  if (botPatterns.some(p => ua.includes(p))) return true;
  if (!req.headers['user-agent']) return true;
  const origin = req.headers['origin'] || '';
  const referer = req.headers['referer'] || '';
  const allowedDomains = ['fineprintfix.com', 'vercel.app', 'localhost'];
  const fromAllowedDomain = allowedDomains.some(d => origin.includes(d) || referer.includes(d));
  if (!fromAllowedDomain && (origin || referer)) return true;
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', 'https://www.fineprintfix.com');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', 'https://www.fineprintfix.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const ip = getClientIP(req);

  if (isSuspicious(req)) {
    console.warn('Suspicious request blocked:', ip, req.headers['user-agent']);
    return res.status(403).json({ error: 'Request not allowed.' });
  }

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    console.warn('Rate limit hit:', ip, rateCheck.reason);
    res.setHeader('Retry-After', '120');
    return res.status(429).json({ error: rateCheck.reason });
  }

  const { system, messages } = req.body;
  if (!system || !messages) {
    return res.status(400).json({ error: 'Missing system or messages in request body' });
  }

  const bodySize = JSON.stringify(req.body).length;
  if (bodySize > 500000) {
    return res.status(413).json({ error: 'Request too large.' });
  }

  try {
    recordCall(ip);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        temperature: 0.2,  // Low temperature = consistent, deterministic JSON output
        system,
        messages,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json({ error: errorData });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}




