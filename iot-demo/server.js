require('dotenv').config();
const path = require('path');
const express = require('express');
const mqtt = require('mqtt');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const TOPIC = process.env.TOPIC || 'iot/demo/temperature';
const WEB_PORT = Number(process.env.WEB_PORT) || 3000;
const HISTORY_LIMIT = 120;

const history = [];
const sseClients = new Set();
let mqttConnected = false;
let lastMessageAt = null;

const client = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  reconnectPeriod: 1000,
});

function statusPayload() {
  return { mqttConnected, topic: TOPIC, lastMessageAt, points: history.length };
}

function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of sseClients) {
    try {
      writeEvent(res, event, data);
    } catch (err) {
      sseClients.delete(res);
    }
  }
}

client.on('connect', () => {
  mqttConnected = true;
  console.log('[WEB] MQTT connected:', MQTT_URL);
  client.subscribe(TOPIC, { qos: 0 }, (err) => {
    if (err) {
      console.error('[WEB] Subscribe error:', err.message);
    } else {
      console.log('[WEB] Subscribed to:', TOPIC);
    }
  });
  broadcast('status', statusPayload());
});

client.on('message', (topic, payload) => {
  let data;
  try {
    data = JSON.parse(payload.toString());
  } catch (err) {
    console.error('[WEB] Invalid payload:', err.message);
    return;
  }

  history.push(data);
  if (history.length > HISTORY_LIMIT) history.shift();

  lastMessageAt = Date.now();
  broadcast('point', data);
});

client.on('close', () => {
  mqttConnected = false;
  broadcast('status', statusPayload());
});

client.on('offline', () => {
  mqttConnected = false;
  broadcast('status', statusPayload());
});

client.on('error', (err) => {
  if (err.message) console.error('[WEB] MQTT error:', err.message);
});

const app = express();

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mqttConnected,
    topic: TOPIC,
    lastMessageAt,
    clients: sseClients.size,
  });
});

app.get('/api/history', (req, res) => {
  res.json({ topic: TOPIC, mqttConnected, points: history });
});

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  writeEvent(res, 'status', statusPayload());
  writeEvent(res, 'history', { points: history });

  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (err) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(WEB_PORT, () => {
  console.log(`[WEB] Dashboard: http://localhost:${WEB_PORT}`);
});

function shutdown() {
  console.log('\n[WEB] Shutting down...');
  client.end(true);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
