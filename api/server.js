const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = path.join(__dirname, 'data');
const proofsDir = path.join(dataDir, 'proofs');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir);

const usersPath = path.join(dataDir, 'users.json');
const messagesPath = path.join(dataDir, 'messages.json');
const bansPath = path.join(dataDir, 'bans.json');
const reportsPath = path.join(dataDir, 'reports.json');

function readJSON(file) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fs.writeFileSync(file, '[]');
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function cleanupExpiredBans() {
  const bans = readJSON(bansPath);
  const now = Date.now();
  const validBans = bans.filter(b => {
    if (b.duration === 'inf') return true;
    const expire = new Date(b.duration).getTime();
    return expire > now;
  });
  if (validBans.length !== bans.length) writeJSON(bansPath, validBans);
  return validBans;
}

function generateUserCode() {
  return crypto.randomBytes(16).toString('hex');
}

function generateMessageId() {
  return crypto.randomBytes(12).toString('hex');
}

function generateReportId() {
  return crypto.randomBytes(12).toString('hex');
}

app.post('/register', (req, res) => {
  const { email, displayName, username, password } = req.body;
  if (!email || !displayName || !username || !password) return res.json({ error: 'Compila tutti i campi' });

  const users = readJSON(usersPath);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.json({ error: 'Username già esistente' });

  const userCode = generateUserCode();
  users.push({ email, displayName, username, password, userCode, avatar: null });
  writeJSON(usersPath, users);
  res.json({ userCode });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'Inserisci username e password' });

  const users = readJSON(usersPath);
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.json({ error: 'Username non trovato' });
  if (user.password !== password) return res.json({ error: 'Password errata' });

  const bans = cleanupExpiredBans();
  const ban = bans.find(b => b.username.toLowerCase() === username.toLowerCase());

  if (ban) {
    if (ban.duration === 'inf') {
      return res.json({
        userCode: user.userCode,
        ban: { active: true, inf: true, reason: ban.reason }
      });
    }

    const expire = new Date(ban.duration).getTime();
    const now = Date.now();
    if (now < expire) {
      return res.json({
        userCode: user.userCode,
        ban: { active: true, inf: false, reason: ban.reason, expiry: ban.duration }
      });
    }
  }

  res.json({ userCode: user.userCode });
});

app.post('/unban-user', (req, res) => {
  const { adminUser, adminCode, username } = req.body;
  if (!adminUser || !adminCode || !username) return res.json({ error: 'Dati mancanti' });

  const users = readJSON(usersPath);
  const admin = users.find(u => u.username.toLowerCase() === adminUser.toLowerCase() && u.userCode === adminCode);
  if (!admin || admin.username.toLowerCase() !== 'tutuu666kteam') return res.json({ error: 'Credenziali non valide' });

  const bans = cleanupExpiredBans();
  const index = bans.findIndex(b => b.username.toLowerCase() === username.toLowerCase());
  if (index === -1) return res.json({ error: 'Utente non bannato' });

  bans.splice(index, 1);
  writeJSON(bansPath, bans);
  res.json({ success: true });
});

app.get('/validate/:code', (req, res) => {
  const users = readJSON(usersPath);
  const user = users.find(u => u.userCode === req.params.code);
  if (!user) return res.json({ valid: false });
  res.json({ valid: true, username: user.username, displayName: user.displayName });
});

app.get('/messages/:username', (req, res) => {
  const messages = readJSON(messagesPath);
  const userMsgs = messages.filter(m => m.targetUsername.toLowerCase() === req.params.username.toLowerCase());
  res.json(userMsgs);
});

app.post('/send', (req, res) => {
  const { targetUsername, text, fromId } = req.body;
  if (!targetUsername || !text) return res.json({ success: false, error: 'Campi mancanti' });

  const users = readJSON(usersPath);
  if (!users.find(u => u.username.toLowerCase() === targetUsername.toLowerCase())) return res.json({ success: false, error: 'Utente non trovato' });

  const messages = readJSON(messagesPath);
  const newMessage = { id: generateMessageId(), targetUsername, text, time: Date.now(), fromId: fromId || null, replies: [] };
  messages.push(newMessage);
  writeJSON(messagesPath, messages);
  res.json({ success: true, messageId: newMessage.id });
});

app.post('/send-reply', (req, res) => {
  const { messageId, responderUsername, text } = req.body;
  if (!messageId || !responderUsername || !text) return res.json({ error: 'Campi mancanti' });

  const messages = readJSON(messagesPath);
  const msg = messages.find(m => m.id === messageId);
  if (!msg) return res.json({ error: 'Messaggio non trovato' });
  if (msg.targetUsername.toLowerCase() !== responderUsername.toLowerCase()) return res.json({ error: 'Non autorizzato' });

  msg.replies.push({ from: responderUsername, text, time: Date.now() });
  writeJSON(messagesPath, messages);
  res.json({ success: true });
});

app.put('/edit-profile', (req, res) => {
  const code = req.headers.authorization || req.body.userCode || req.headers['usercode'];
  const users = readJSON(usersPath);
  const user = users.find(u => u.userCode === code);
  if (!user) return res.status(400).json({ error: 'Utente non trovato' });

  if (req.body.email) user.email = req.body.email;
  if (req.body.displayName) user.displayName = req.body.displayName;
  if (req.body.username) user.username = req.body.username;
  if (req.body.password) user.password = req.body.password;
  if (req.body.avatarBase64) user.avatar = req.body.avatarBase64;

  writeJSON(usersPath, users);
  res.json({ success: true });
});

app.get('/get-avatar/:username', (req, res) => {
  const users = readJSON(usersPath);
  const user = users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (!user) return res.json({ avatar: null });
  res.json({ avatar: user.avatar || null });
});

app.get('/get-user/:username', (req, res) => {
  const users = readJSON(usersPath);
  const user = users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  res.json({ email: user.email || '', username: user.username, displayName: user.displayName, avatar: user.avatar || null });
});

app.post('/ban-user', (req, res) => {
  const { adminUser, adminCode, username, reason, duration } = req.body;
  if (!adminUser || !adminCode) return res.json({ error: 'Accesso negato' });

  const users = readJSON(usersPath);
  const admin = users.find(u => u.username.toLowerCase() === adminUser.toLowerCase() && u.userCode === adminCode);
  if (!admin || admin.username.toLowerCase() !== 'tutuu666kteam') return res.json({ error: 'Credenziali non valide' });

  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.json({ error: 'Utente non trovato' });

  const bans = cleanupExpiredBans();
  if (bans.find(b => b.username.toLowerCase() === username.toLowerCase())) {
    return res.json({ error: 'Utente già bannato' });
  }

  bans.push({ username, reason, duration });
  writeJSON(bansPath, bans);

  res.json({ success: true });
});

app.get('/ban-status/:code', (req, res) => {
  const users = readJSON(usersPath);
  const user = users.find(u => u.userCode === req.params.code);
  if (!user) return res.json({ banned: false });

  const bans = cleanupExpiredBans();
  const ban = bans.find(b => b.username.toLowerCase() === user.username.toLowerCase());
  if (!ban) return res.json({ banned: false });

  if (ban.duration === 'inf') {
    return res.json({ banned: true, active: true, inf: true, reason: ban.reason });
  }

  const expire = new Date(ban.duration).getTime();
  const now = Date.now();
  if (now < expire) {
    return res.json({ banned: true, active: true, inf: false, reason: ban.reason, expiry: ban.duration });
  } else {
    return res.json({ banned: false });
  }
});

app.post('/report', (req, res) => {
  const { reporterUsername, reportedUsername, category, description, proofBase64 } = req.body;
  if (!reporterUsername || !reportedUsername || !category || !description) {
    return res.json({ error: 'Campi obbligatori mancanti' });
  }

  const users = readJSON(usersPath);
  if (!users.find(u => u.username.toLowerCase() === reporterUsername.toLowerCase())) {
    return res.json({ error: 'Reporter non trovato' });
  }
  if (!users.find(u => u.username.toLowerCase() === reportedUsername.toLowerCase())) {
    return res.json({ error: 'Utente segnalato non trovato' });
  }

  const reports = readJSON(reportsPath);

  let proofFilename = null;
  if (proofBase64 && proofBase64.startsWith('data:image/')) {
    const matches = proofBase64.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (matches) {
      const ext = matches[1];
      const data = matches[2];
      const buffer = Buffer.from(data, 'base64');
      proofFilename = generateReportId() + '.' + ext;
      fs.writeFileSync(path.join(proofsDir, proofFilename), buffer);
    }
  }

  reports.push({
    id: generateReportId(),
    reporterUsername,
    reportedUsername,
    category,
    description,
    proofFile: proofFilename,
    time: Date.now(),
    resolved: false
  });

  writeJSON(reportsPath, reports);

  res.json({ success: true });
});

app.get('/:username/ask', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ask.html'));
});

app.get('admin/code/cat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

module.exports = app;

