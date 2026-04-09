const uuid = require('uuid');
const db = require('./db');

const type = process.argv[2];

if (!['monthly', 'lifetime'].includes(type)) {
  console.error("Usage: node generate.js <monthly|lifetime>");
  process.exit(1);
}

// Format logic: WAVE-XXXX-XXXX
const pt1 = uuid.v4().split('-')[0].substring(0, 4).toUpperCase();
const pt2 = uuid.v4().split('-')[1].substring(0, 4).toUpperCase();
const keyString = `WAVE-${pt1}-${pt2}`;

const stmt = db.prepare('INSERT INTO keys (key_string, type) VALUES (?, ?)');
stmt.run(keyString, type);

console.log(`Generated ${type} key: ${keyString}`);
