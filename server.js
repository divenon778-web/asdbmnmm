const express = require('express');
const cors = require('cors');
const uuid = require('uuid');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory session store (Ideally use Redis or DB column for production)
const sessions = new Map(); 

// Validation Auth logic
app.post('/api/auth', (req, res) => {
  const { key, hwid } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });

  const stmt = db.prepare('SELECT * FROM keys WHERE key_string = ?');
  const license = stmt.get(key);

  if (!license) return res.status(401).json({ error: 'Invalid key' });

  const now = Date.now();

  // If first time active, calculate expiration for monthly keys
  if (license.is_active === 0) {
    let expiresAt = null;
    if (license.type === 'monthly') {
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expiresAt = new Date(now + thirtyDays).toISOString();
    }
    
    // Hardware ID locking configuration
    const activeHwId = hwid || 'generic-hwid';

    db.prepare('UPDATE keys SET is_active = 1, expires_at = ?, hardware_id = ? WHERE id = ?')
      .run(expiresAt, activeHwId, license.id);
  } else {
    // Check if expired
    if (license.type === 'monthly' && license.expires_at) {
       const expirationTime = new Date(license.expires_at).getTime();
       if (now > expirationTime) {
         return res.status(403).json({ error: 'Key expired' });
       }
    }
    
    // Validate hardware lock
    if (hwid && license.hardware_id !== hwid) {
       return res.status(403).json({ error: 'Key tied to another machine.' });
    }
  }

  // Create session
  const token = uuid.v4();
  sessions.set(token, { key: license.key_string, type: license.type });

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

app.post('/api/predict', (req, res) => {
  const { token, algorithm, spots, history } = req.body;

  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized Session. Please log in.' });
  }

  const fn = algos[algorithm] || algos.tsunami;
  
  // Fake history if none provided to ensure the algorithm has something to run on
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Wave Predictor Secure Backend running on http://localhost:${PORT}`);
});
