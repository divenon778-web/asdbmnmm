const https = require('https');

// --- CONFIGURATION ---
const RENDER_URL = 'asdbmnmm.onrender.com'; // Your Render URL (without https://)
const ADMIN_SECRET = 'dev-secret';          // Must match the ADMIN_SECRET on Render
// ----------------------

const type = process.argv[2];

if (!['monthly', 'lifetime'].includes(type)) {
  console.error("Usage: node remote_generate.js <monthly|lifetime>");
  process.exit(1);
}

const data = JSON.stringify({
  secret: ADMIN_SECRET,
  type: type
});

const options = {
  hostname: RENDER_URL,
  port: 443,
  path: '/api/admin/generate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log(`Sending request to ${RENDER_URL}...`);

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (d) => body += d);
  res.on('end', () => {
    try {
      const response = JSON.parse(body);
      if (response.success) {
        console.log('\x1b[32m%s\x1b[0m', `\nSUCCESS! New key generated on Render:`);
        console.log('\x1b[36m%s\x1b[0m', `Key:  ${response.key}`);
        console.log('\x1b[36m%s\x1b[0m', `Type: ${response.type}`);
      } else {
        console.error('\x1b[31m%s\x1b[0m', `\nFAILED: ${response.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('\x1b[31m%s\x1b[0m', `\nFAILED: Received invalid response from server.`);
      console.log('Response:', body);
    }
  });
});

req.on('error', (error) => {
  console.error('\x1b[31m%s\x1b[0m', '\nCONNECTION ERROR:');
  console.error(error.message);
});

req.write(data);
req.end();
