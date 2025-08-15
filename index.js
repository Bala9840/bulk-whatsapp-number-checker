const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');

const delay = ms => new Promise(res => setTimeout(res, ms));

function readNumbersFromCSV(path) {
  return new Promise((resolve, reject) => {
    const nums = [];
    fs.createReadStream(path)
      .pipe(csv())
      .on('data', row => row.number && nums.push(row.number.trim()))
      .on('end', () => resolve(nums))
      .on('error', reject);
  });
}

const csvWriter = createCsvWriter({
  path: 'output.csv',
  header: [
    { id: 'number', title: 'Number' },
    { id: 'status', title: 'WhatsApp Status' }
  ]
});

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  // Wait until logged in
  await new Promise((resolve, reject) => {
    sock.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        console.log('📷 Scan this QR with your WhatsApp:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp Connected!');
        resolve();
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        if (reason === DisconnectReason.loggedOut) {
          console.log('❌ Logged out. Please delete the auth folder and try again.');
          process.exit();
        } else {
          reject(new Error('Connection closed before login'));
        }
      }
    });
  });

  return sock;
}

async function main() {
  const sock = await startSock();

  const numbers = await readNumbersFromCSV('numbers.csv');
  const results = [];

  console.log(`🔍 Checking ${numbers.length} numbers ...`);

  for (const num of numbers) {
    try {
      const res = await sock.onWhatsApp(num);
      const ok = res && res.length > 0;
      console.log(`${num} ➜ ${ok ? '✅ Registered' : '❌ Not Registered'}`);
      results.push({ number: num, status: ok ? 'Registered' : 'Not Registered' });
    } catch (e) {
      console.error(`❌ Error on ${num}:`, e.message || e);
      results.push({ number: num, status: 'Error' });
    }

    await delay(2000); // Avoid rate limiting
  }

  await csvWriter.writeRecords(results);
  console.log('✅ Done. Results saved to output.csv');
}

main();
