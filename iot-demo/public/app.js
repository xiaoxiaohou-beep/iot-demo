const MAX_POINTS = 120;
const MAX_ROWS = 20;

const els = {
  tempValue: document.getElementById('tempValue'),
  humidityValue: document.getElementById('humidityValue'),
  updatedValue: document.getElementById('updatedValue'),
  deviceMeta: document.getElementById('deviceMeta'),
  topicMeta: document.getElementById('topicMeta'),
  mqttBadge: document.getElementById('mqttBadge'),
  mqttState: document.getElementById('mqttState'),
  streamBadge: document.getElementById('streamBadge'),
  streamState: document.getElementById('streamState'),
  brokerHint: document.getElementById('brokerHint'),
  tempChart: document.getElementById('tempChart'),
  humidityChart: document.getElementById('humidityChart'),
  historyBody: document.getElementById('historyBody'),
};

let points = [];

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function setMqttStatus(connected) {
  els.mqttState.textContent = connected ? 'MQTT 已连接' : 'MQTT 未连接';
  els.mqttBadge.className = connected ? 'badge ok' : 'badge bad';
  els.brokerHint.classList.toggle('show', !connected);
}

function setStreamStatus(connected) {
  els.streamState.textContent = connected ? '推送已连接' : '推送重连中';
  els.streamBadge.className = connected ? 'badge ok' : 'badge bad';
}

function renderLatest() {
  const p = points[points.length - 1];
  if (!p) {
    els.tempValue.textContent = '—';
    els.humidityValue.textContent = '—';
    els.updatedValue.textContent = '—';
    els.deviceMeta.textContent = '设备：—';
    return;
  }
  els.tempValue.textContent = Number(p.temperature).toFixed(1);
  els.humidityValue.textContent = Number(p.humidity).toFixed(1);
  els.updatedValue.textContent = formatTime(p.ts);
  els.deviceMeta.textContent = `设备：${p.deviceId || '未知'}`;
}

function renderTable() {
  els.historyBody.textContent = '';
  points
    .slice(-MAX_ROWS)
    .reverse()
    .forEach((p) => els.historyBody.appendChild(createRow(p)));
}

function createRow(p) {
  const tr = document.createElement('tr');
  [formatTime(p.ts), p.deviceId || '—', Number(p.temperature).toFixed(2), Number(p.humidity).toFixed(2)].forEach(
    (text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
  );
  return tr;
}

function addRow(p) {
  els.historyBody.prepend(createRow(p));
  while (els.historyBody.children.length > MAX_ROWS) {
    els.historyBody.lastElementChild.remove();
  }
}

function seriesOf(field) {
  return points
    .map((p) => ({ t: p.ts, v: Number(p[field]) }))
    .filter((d) => Number.isFinite(d.v));
}

function drawChart(canvas, series, color) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 480;
  const cssHeight = 220;

  if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  if (!series.length) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('等待数据…', cssWidth / 2, cssHeight / 2);
    return;
  }

  const pad = { top: 14, right: 12, bottom: 24, left: 46 };
  const plotW = cssWidth - pad.left - pad.right;
  const plotH = cssHeight - pad.top - pad.bottom;

  const values = series.map((d) => d.v);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1e-6) {
    min -= 1;
    max += 1;
  }
  const margin = (max - min) * 0.1;
  min -= margin;
  max += margin;

  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  const ticks = 4;
  for (let i = 0; i < ticks; i++) {
    const ratio = i / (ticks - 1);
    const y = pad.top + plotH * ratio;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(cssWidth - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.fillText((max - (max - min) * ratio).toFixed(1), pad.left - 8, y);
  }

  const xOf = (i) => pad.left + (i / (MAX_POINTS - 1)) * plotW;
  const yOf = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

  ctx.beginPath();
  series.forEach((d, i) => {
    const x = xOf(i);
    const y = yOf(d.v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const last = series[series.length - 1];
  ctx.beginPath();
  ctx.arc(xOf(series.length - 1), yOf(last.v), 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle = '#64748b';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(formatTime(series[0].t), pad.left, cssHeight - 18);
  ctx.textAlign = 'right';
  ctx.fillText(formatTime(last.t), cssWidth - pad.right, cssHeight - 18);
}

function renderCharts() {
  drawChart(els.tempChart, seriesOf('temperature'), '#38bdf8');
  drawChart(els.humidityChart, seriesOf('humidity'), '#fbbf24');
}

function renderAll() {
  renderLatest();
  renderCharts();
  renderTable();
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    els.topicMeta.textContent = `Topic：${data.topic}`;
    setMqttStatus(data.mqttConnected);
    points = (data.points || []).slice(-MAX_POINTS);
    renderAll();
  } catch (err) {
    console.error('加载历史数据失败：', err);
  }
}

function connectStream() {
  const source = new EventSource('/api/stream');

  source.onopen = () => setStreamStatus(true);
  source.onerror = () => setStreamStatus(false);

  source.addEventListener('status', (event) => {
    const data = JSON.parse(event.data);
    setMqttStatus(data.mqttConnected);
    if (data.topic) els.topicMeta.textContent = `Topic：${data.topic}`;
  });

  source.addEventListener('history', (event) => {
    const data = JSON.parse(event.data);
    points = (data.points || []).slice(-MAX_POINTS);
    renderAll();
  });

  source.addEventListener('point', (event) => {
    const point = JSON.parse(event.data);
    points.push(point);
    if (points.length > MAX_POINTS) points.shift();
    renderLatest();
    renderCharts();
    addRow(point);
  });
}

window.addEventListener('resize', renderCharts);

loadHistory().then(connectStream);
