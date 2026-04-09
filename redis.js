require('dotenv').config();
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn('WARNING: REDIS_URL not found. Connection to Redis will fail on Render/Production.');
}

const redis = new Redis(redisUrl || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

redis.on('error', (err) => {
  console.error('Redis Connection Error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis successfully.');
});

module.exports = redis;
