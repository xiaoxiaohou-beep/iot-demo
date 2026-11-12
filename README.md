# iot-demo

物联网设计与创新课程实践项目：MQTT 模拟设备上报 + 实时可视化仪表盘。

## 功能

- `publisher.js` 模拟传感器，每 2 秒向 MQTT 主题发布温度、湿度数据。
- `server.js` 提供 Express 服务，订阅同一主题并通过 SSE 把数据实时推送到网页。
- 网页包含：当前温湿度卡片、连接状态徽标、实时温湿度曲线（原生 Canvas）、最近数据表格。

数据链路：`publisher.js → MQTT Broker → server.js(Express) → SSE → 浏览器`

## 目录结构

```
iot-demo/
├─ publisher.js      # 发布端：模拟设备上报数据
├─ subscriber.js     # 订阅端：命令行打印消息
├─ server.js         # Express 服务：订阅 MQTT + SSE + 静态页面托管
├─ public/           # 仪表盘前端
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js         # 原生 Canvas 绘图与 SSE 接收
├─ .env              # 连接配置
└─ package.json      # npm 脚本：pub / sub / web
```

## 运行方式

1. 先准备一个 MQTT Broker，监听 `localhost:1883`（如 Mosquitto、EMQX）。没有现成 Broker 时可临时用 `npx aedes-cli -p 1883` 启动一个。
2. 在项目根目录（即本 README 所在目录）下安装依赖并启动网页服务：

```powershell
cd iot-demo
npm install
npm run web
```

3. 浏览器打开 <http://localhost:3000>。
4. 另开一个终端启动模拟上报：

```powershell
cd iot-demo
npm run pub
```

页面会每 2 秒刷新卡片、曲线与表格。可选执行 `npm run sub` 在命令行同时查看原始消息。

## 配置（iot-demo/.env）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MQTT_URL` | `mqtt://localhost:1883` | Broker 地址 |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | 空 | Broker 认证信息，可留空 |
| `TOPIC` | `iot/demo/temperature` | 订阅/发布主题 |
| `WEB_PORT` | `3000` | 网页服务端口，端口被占用时修改此项 |

## 接口

- `GET /api/history`：返回当前内存中的历史数据点（最多 120 条）。
- `GET /api/stream`：SSE 事件流，事件类型为 `status`、`history`、`point`。
- `GET /api/health`：服务健康检查，含 MQTT 连接状态与在线 SSE 客户端数。

## 验证记录

2026-11-12 本机验证（Node v24.22.0 / npm 11.19.1）：

| 场景 | 结果 |
|---|---|
| `npm run web` 启动 | 通过，输出 `http://localhost:3000`，`/`、`styles.css`、`app.js` 均返回 200 |
| Broker 未启动 | 通过，服务不崩溃，`/api/health` 返回 `mqttConnected: false`，页面提示"Broker 未连接" |
| Broker 启动后 | 通过，1 秒重连周期内自动连接并订阅 `iot/demo/temperature` |
| `npm run pub` 上报 | 通过，约 2 秒一条，`/api/history` 点数持续增长 |
| 浏览器渲染 | 通过，卡片数值、两条 Canvas 曲线（含最新点标记）、表格行均正常，两个状态徽标为绿色，控制台无报错 |
| Broker 中断 | 通过，状态变为"MQTT 未连接"，Broker 恢复后自动重连并继续出数 |
