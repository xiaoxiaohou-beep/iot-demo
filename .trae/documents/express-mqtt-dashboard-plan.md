# 为 publisher.js 数据添加 Express 可视化网页 — 实施计划

## 一、目标概述

在现有 MQTT 演示项目上新增一个基于 **Express** 的实时仪表盘网页，把 `publisher.js` 每 2 秒上报的温湿度数据可视化展示。

数据链路：`publisher.js → MQTT Broker → 新增的 Express 服务（订阅端）→ SSE → 浏览器页面`。

- 不改动 `publisher.js` 与 `subscriber.js` 的任何代码。
- 页面包含：当前值卡片 + 连接状态、实时温湿度曲线（原生 Canvas）、最近数据表格。
- 不实现超阈值告警（用户未勾选）。

## 二、现状分析

已确认的目录与依赖情况：

```
d:\project\iot‑demo
├─ README.md              # 仅"当前状态"占位，注明后续补充运行方式和验证记录
├─ package.json           # 根级，仅声明 dotenv/mqtt，无 scripts、无 node_modules
├─ package-lock.json
└─ iot-demo\              # 实际代码目录
   ├─ publisher.js        # 每 2s 发布 {deviceId, ts, temperature, humidity}，QoS 0
   ├─ subscriber.js       # 订阅并打印消息，reconnectPeriod: 1000
   ├─ .env                # MQTT_URL / MQTT_USERNAME / MQTT_PASSWORD / TOPIC
   ├─ .gitignore          # 已忽略 node_modules/、.env
   ├─ package.json        # name: iot-demo，scripts: pub / sub
   └─ node_modules\       # 已安装 mqtt、dotenv 等
```

关键事实（已核实）：

- 当前工作区**未安装 express**（`iot-demo/node_modules/express` 与根目录均不存在），需要新增依赖。
- `publisher.js` 与 `subscriber.js` 已固化"读 `.env` → 连 Broker → 收发 Topic"的写法，新服务沿用同样模式即可保持一致。
- 默认 Topic 为 `iot/demo/temperature`，默认 Broker 为 `mqtt://localhost:1883`。
- 默认数据字段：`deviceId`（固定 `sensor-001`）、`ts`（毫秒时间戳）、`temperature`、`humidity`（均为两位小数字符串）。
- 环境：Node v24.22.0 / npm 11.19.1，无前端构建工具，也不应引入构建链。

## 三、架构设计

```
浏览器 (public/index.html + app.js + Canvas)
   │  ① 首次加载 GET /api/history  → 拉取历史点
   │  ② EventSource GET /api/stream → 实时接收 point / status 事件
   ▼
Express (iot-demo/server.js, 端口 3000)
   │  内存环形缓冲（最多 120 点）
   ▼
MQTT Client（订阅 TOPIC，reconnectPeriod 1000）
   ▲
publisher.js ──每 2s──> Broker
```

选择理由：服务端统一持有 MQTT 连接与历史数据，浏览器不接触 Broker；SSE 是浏览器原生 API，无需额外依赖，正好匹配"只增 express 一个包"的约束。

## 四、变更清单

### 1. 新增 `iot-demo/server.js`（Express 服务，约 120 行）

**职责**：启动 Express、连接 MQTT、维护历史缓冲、提供 REST + SSE 接口、托管静态页面。

实现要点：

- 顶部 `require('dotenv').config()`，与 `publisher.js` 保持一致。
- 配置读取：
  - `MQTT_URL`（默认 `mqtt://localhost:1883`）、`MQTT_USERNAME`、`MQTT_PASSWORD`、`TOPIC`（默认 `iot/demo/temperature`）
  - `WEB_PORT`（默认 `3000`）
- 常量 `HISTORY_LIMIT = 120`（约 2 秒 × 120 = 4 分钟数据）。
- 状态对象：`history`（数组）、`mqttConnected`（布尔）、`lastMessageAt`。
- MQTT 客户端：`mqtt.connect(url, {username, password, reconnectPeriod: 1000})`；
  - `connect` → `mqttConnected = true`，`client.subscribe(topic, {qos: 0})`，广播 `status` 事件
  - `message` → `JSON.parse`，解析失败则打印错误并忽略（外部数据边界）；成功则补入 `history`（超过 `HISTORY_LIMIT` 时 `shift()`），广播 `point` 事件
  - `close` / `offline` → `mqttConnected = false`，广播 `status`
  - `error` → 打印 `err.message`（不退出进程）
- SSE 广播函数 `broadcast(event, data)`：遍历 `sseClients` Set，`res.write(\`event: ${event}\ndata: ${JSON.stringify(data)}\n\n\`)`；写失败的客户端从 Set 中移除。
- 路由：
  - `GET /api/health` → `{ok: true, mqttConnected, topic, lastMessageAt, clients: sseClients.size}`
  - `GET /api/history` → `{topic, mqttConnected, points: history}`
  - `GET /api/stream` → 设置 `Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`，`res.flushHeaders()`；建连立即补发 `status` 与 `history` 事件；把 `res` 加入 `sseClients`；`req.on('close')` 时移除；每 15 秒写一次 `: ping\n\n` 心跳防代理断连
  - `express.static(path.join(__dirname, 'public'))` 托管前端；`GET /` 由 `index.html` 兜底
- `app.listen(WEB_PORT)` 后打印一行访问地址 `http://localhost:3000`。
- 进程退出处理：`SIGINT` 时关闭 MQTT 客户端与 HTTP 服务（保证 Ctrl+C 干净退出）。

### 2. 新增 `iot-demo/public/index.html`

无构建、单页结构，引用同目录 `styles.css` 与 `app.js`：

- 顶部标题栏：项目名 + 右侧两个状态徽标（`MQTT`、`实时推送`）。
- 主区域上方：三个数值卡片 —— 当前温度、当前湿度、最后更新时间（附设备 ID 与 Topic 小字）。
- 中部卡片：标题"实时曲线（最近 120 点）"，内含两张并排的 `canvas`（`#tempChart`、`#humidityChart`），各配图例文字与当前范围标注。
- 下方卡片：标题"最近数据"，表格表头 `时间 / 设备 / 温度(℃) / 湿度(%)`，`tbody#historyBody`，最多 20 行，新数据置顶。
- 无数据时卡片显示"等待数据…"占位。

### 3. 新增 `iot-demo/public/styles.css`

- 深色控制台风格：背景 `#0f172a`，卡片 `#1e293b`，主色青蓝 `#38bdf8`（温度）与琥珀 `#fbbf24`（湿度），状态点绿/灰/红。
- 简单栅格：卡片区 `display: grid; grid-template-columns: repeat(3, 1fr)`，窄屏（`max-width: 720px`）降为单列。
- Canvas 宽度 100%，高度 220px，用 `devicePixelRatio` 在 JS 中设置内部分辨率以保证清晰。
- 不使用任何外部字体或 CDN 资源。

### 4. 新增 `iot-demo/public/app.js`（原生 JS，约 180 行）

- 启动流程：`fetch('/api/history')` 拿历史 → 渲染曲线、卡片、表格 → `new EventSource('/api/stream')` 订阅实时事件。
- 数据模型：`points` 数组（前端也保留 120 点上限）。
- 事件处理：
  - `event: history` → 重置 `points` 后整体重绘
  - `event: point` → `push` 并裁剪到 120 点，更新卡片、重绘两张图、往表格头部插入一行（超过 20 行移除末尾）
  - `event: status` → 更新 MQTT 徽标（连接中/已断开），并联动卡片显示"Broker 未连接"
  - EventSource 的 `onopen` / `onerror` → 更新"实时推送"徽标为已连接/重连中
- 绘图函数 `drawChart(canvas, values, color, unit)`：
  - 处理 `devicePixelRatio`，清空画布
  - 依 `min/max` 加 10% 留白计算 y 轴（若全部相等则取 ±1 兜底）
  - 画 4 条水平网格线与左侧刻度文字
  - 折线连接所有点，最后一个点画实心圆
  - 只在点数 ≥ 2 时连线，点数为 0 时居中显示"等待数据…"
- 时间格式化：`HH:mm:ss`（本地时区，用 `toLocaleTimeString('zh-CN', {hour12: false})`）。
- 不做任何轮询定时器（SSE 被动接收），仅在页面不可见时可保留绘制（保持简单，不加额外优化）。

### 5. 修改 `iot-demo/package.json`

- `dependencies` 增加 `"express": "^4.21.2"`。
- `scripts` 增加 `"web": "node server.js"`（与现有 `pub` / `sub` 风格一致）。
- 其余字段不动。

### 6. 修改 `iot-demo/.env`

- 追加一行 `WEB_PORT=3000`，使端口可配置、便于发现。该文件已在 `.gitignore` 中，不会进入版本库。

### 7. 修改根目录 `README.md`

补充三节，替换"当前状态"的占位表述：

- **功能**：MQTT 模拟上报 + 实时可视化仪表盘（卡片、曲线、表格）。
- **目录说明**：`publisher.js` / `subscriber.js` / `server.js` / `public/` 各自职责。
- **运行方式**：先起 Broker（`localhost:1883`），再在 `iot-demo` 下 `npm install`、`npm run web`，浏览器打开 `http://localhost:3000`，另开终端 `npm run pub`。
- **验证记录**：执行完成后按第六节结果回填。

## 五、假设与决策

| 项 | 决策 | 理由 |
|---|---|---|
| 数据来源 | Express 服务端订阅 MQTT，SSE 推送到浏览器 | 用户已选定；不改 publisher，贴近真实 IoT 架构 |
| 图表 | 原生 Canvas 手写，双 canvas 各自单 y 轴 | 用户已选定；避免双 y 轴复杂度，零 CDN 依赖、离线可用 |
| 端口 | `3000`，可通过 `WEB_PORT` 覆盖 | 与 1883 无冲突，Express 常规端口 |
| 历史容量 | 服务端与前端各 120 点 | 约 4 分钟窗口，内存占用可忽略 |
| 端口占用 | 不做自动换端口逻辑，启动失败时由 Express 直接报错 | 避免过度设计，README 写明改 `WEB_PORT` |
| 依赖新增 | 仅 `express` 一个包 | 严格最小化，mime/静态托管均由 express 自带 |
| 数据校验 | 仅对 `JSON.parse` 失败做忽略并打日志 | 外部消息属系统边界；不额外校验字段类型 |
| 告警功能 | 不实现 | 用户未勾选 |
| 异常兜底 | MQTT 断线只更新状态、不退出进程；SSE 写失败即移除该客户端 | 保证演示时页面不中断 |

## 六、验证步骤

1. **安装依赖**：在 `iot-demo` 下执行 `npm install`，确认 `node_modules/express` 存在且 `package-lock.json` 更新。
2. **准备 Broker**：检查 `localhost:1883` 是否可连；若本机没有 Broker，用 `npx aedes-cli -p 1883` 临时启动（仅用于验证，不写入项目依赖）。
3. **启动服务**：`cd iot-demo` → `npm run web`，终端应输出访问地址且无异常。
4. **页面骨架**：浏览器打开 `http://localhost:3000`，确认三个卡片、两张 canvas、表格与两个状态徽标正常渲染；此时卡片显示"等待数据…"，MQTT 徽标为已连接。
5. **端到端**：另开终端在 `iot-demo` 下 `npm run pub`，确认每 2 秒：卡片数值刷新、两条曲线延伸、表格顶部插入新行（超过 20 行自动截断）。
6. **接口自检**：`curl http://localhost:3000/api/health` 应返回 `ok: true`、`mqttConnected: true`、`points` 数量随运行时间增长（`/api/history`）。
7. **断线恢复**：停止 Broker，确认 MQTT 徽标变为断开；重启 Broker 后应在 1 秒重连周期内自动恢复并继续出数。
8. **无 Broker 场景**：仅启动 `npm run web`（不起 Broker），确认服务不崩溃、页面仍可打开并提示"Broker 未连接"。
9. **文档核对**：将上述实际结果回填 `README.md` 的"验证记录"。
