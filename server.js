const express = require('express');
const cors = require('cors');
const uuid = require('uuid');
const redis = require('./redis'); // Using Redis now

const app = express();
app.use(cors());
app.use(express.json());

// Session TTL set to 24 hours (86400 seconds)
const SESSION_TTL = 86400;

// Validation Auth logic
app.post('/api/auth', async (req, res) => {
  const { key, hwid } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });

  const redisKey = `WAVE:KEY:${key}`;
  const license = await redis.hgetall(redisKey);

  // Check if key exists (hgetall returns empty object if not found)
  if (!license || Object.keys(license).length === 0) {
    return res.status(401).json({ error: 'Invalid key' });
  }

  const now = Date.now();

  // If first time active, calculate expiration for monthly keys
  if (parseInt(license.is_active, 10) === 0) {
    let expiresAt = 'null';
    if (license.type === 'monthly') {
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expiresAt = new Date(now + thirtyDays).toISOString();
    }
    
    const activeHwId = hwid || 'generic-hwid';

    await redis.hmset(redisKey, {
      is_active: '1',
      expires_at: expiresAt,
      hardware_id: activeHwId
    });
  } else {
    // Check if expired
    if (license.type === 'monthly' && license.expires_at !== 'null') {
       const expirationTime = new Date(license.expires_at).getTime();
       if (now > expirationTime) {
         return res.status(403).json({ error: 'Key expired' });
       }
    }
    
    // Validate hardware lock
    if (hwid && license.hardware_id !== 'null' && license.hardware_id !== hwid) {
       return res.status(403).json({ error: 'Key tied to another machine.' });
    }
  }

  // Create session in Redis with TTL
  const token = uuid.v4();
  const sessionData = JSON.stringify({ key: key, type: license.type });
  await redis.setex(`WAVE:SESSION:${token}`, SESSION_TTL, sessionData);

  res.json({ success: true, token, type: license.type });
});

// The prediction algorithms moved completely to the backend for max security
const algos = {
  tsunami: (history, safeCount) => {
    const scores = Array(25).fill(0);
    history.forEach((game, idx) => {
      const decay = Math.pow(0.85, idx);
      if (game?.mineLocations?.length) {
        game.mineLocations.forEach(loc => {
          scores[loc] -= decay * 20;
          [-1, 1, -5, 5].forEach((off, rank) => {
            const n = loc + off;
            if (n >= 0 && n < 25) scores[n] -= (7 - rank) * decay;
          });
        });
      }
    });
    return scores.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v).slice(0, safeCount).map(x => x.i);
  },
  wave: (history, safeCount) => {
    const scores = Array(25).fill(0);
    history.forEach((game, idx) => {
      const phase = Math.PI * 2 * idx / 8;
      const decay = Math.exp(-idx / 7);
      if (game?.mineLocations?.length) {
        game.mineLocations.forEach(loc => {
          scores[loc] -= decay * 25 * (Math.sin(phase) + Math.cos(phase));
          for (let r = 1; r <= 2; r++) {
            [-r, r, -r * 5, r * 5].forEach(off => {
              const n = loc + off;
              if (n >= 0 && n < 25) scores[n] -= decay * 10 * Math.sin(phase + r);
            });
          }
        });
      }
    });
    return scores.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v).slice(0, safeCount).map(x => x.i);
  },
  riptide: (history, safeCount) => {
    const scores = Array(25).fill(0);
    history.forEach((game, idx) => {
      const phase = Math.PI * idx / 8;
      const decay = Math.exp(-idx / 7);
      if (game?.mineLocations?.length) {
        game.mineLocations.forEach(loc => {
          scores[loc] -= decay * 25 * (Math.sin(phase) + Math.cos(phase));
          for (let r = 1; r <= 2; r++) {
            [-r, r, -r * 5, r * 5].forEach(off => {
              const n = loc + off;
              if (n >= 0 && n < 25) scores[n] -= decay * 15 * Math.sin(phase + r);
            });
          }
        });
      }
    });
    return scores.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v).slice(0, safeCount).map(x => x.i);
  }
};

app.post('/api/predict', async (req, res) => {
  const { token, algorithm, spots, history } = req.body;

  if (!token) return res.status(401).json({ error: 'Token required' });

  const sessionRaw = await redis.get(`WAVE:SESSION:${token}`);
  if (!sessionRaw) {
    return res.status(401).json({ error: 'Unauthorized Session. Please log in again.' });
  }

  const session = JSON.parse(sessionRaw);
  const fn = algos[algorithm] || algos.tsunami;
  
  const historyData = history || [];
  if (historyData.length === 0) {
    for (let i = 0; i < 5; i++) {
        const locs = [];
        while (locs.length < 5) {
            const r = Math.floor(Math.random() * 25);
            if (!locs.includes(r)) locs.push(r);
        }
        historyData.push({ mineLocations: locs });
    }
  }

  const count = spots ? parseInt(spots, 10) : 5;
  const picks = fn(historyData, count);
  
  res.json({ success: true, picks });
});

const PORT = process.env.PORT || 3000;

// Admin Endpoint for remote key generation
app.post('/api/admin/generate', async (req, res) => {
  const { secret, type } = req.body;
  const adminSecret = process.env.ADMIN_SECRET || 'dev-secret';

  if (secret !== adminSecret) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin Secret' });
  }

  if (!['monthly', 'lifetime'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type. Use monthly or lifetime.' });
  }

  const pt1 = uuid.v4().split('-')[0].substring(0, 4).toUpperCase();
  const pt2 = uuid.v4().split('-')[1].substring(0, 4).toUpperCase();
  const keyString = `WAVE-${pt1}-${pt2}`;

  try {
    const redisKey = `WAVE:KEY:${keyString}`;
    await redis.hmset(redisKey, {
      key: keyString,
      type: type,
      is_active: '0',
      expires_at: 'null',
      hardware_id: 'null',
      created_at: new Date().toISOString()
    });
    res.json({ success: true, key: keyString, type });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate key' });
  }
});

app.listen(PORT, () => {
  console.log(`Wave Predictor Secure Backend running on port ${PORT}`);
});
