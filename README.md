# SCOUT · 好戏开场

一个可以自行部署的 SCOUT 好友联机网页版。中文界面、电脑和手机浏览器可玩，采用原创的数字卡面；不包含实体游戏的原画素材。

## 已实现

- 2～5 人私人房间，6 位房间码、邀请链接、昵称。
- 3～5 人标准规则和 2 人专用规则。
- 开局整手旋转、锁定方向；相邻选牌、合法出牌提示。
- 招募两端卡牌、选择数字朝向和插入位置；每轮一次的招募＋出牌。
- 服务端洗牌、校验和计分，逐玩家发送状态，其他人的手牌不会发到你的浏览器。
- 自动结算、下一轮、最终排名与再来一场，同分共享胜利。
- 掉线重连、刷新恢复、房主离线转让、房主返回大厅、移除大厅离线座位。
- 每次成功操作原子写盘，重启后可用同一浏览器恢复原座位。
- Docker 部署、可选 Caddy 自动 HTTPS，另附 Nginx 配置示例。

## 本地运行

需要 Node.js 24（也兼容 22.12 及以上）。

```bash
npm ci
npm run build
npm start
```

打开 `http://localhost:3000`。开发时使用 `npm run dev`，打开 `http://localhost:5173`，前端代理 API 和 Socket.IO 到 3000。

若 npm 官方源连接困难，可使用 `npm ci --registry=https://registry.npmmirror.com`。依赖完整性仍由锁文件的 integrity 校验。

**模拟多人：** 使用不同设备、不同浏览器配置或无痕窗口。一个浏览器下同一域名的多个标签页属于同一个人。手机可以访问电脑的局域网 IP；电脑防火墙需要允许对应端口。

## Ubuntu 24.04 部署

完整步骤见 [DEPLOY.md](DEPLOY.md)。已有 Docker 时：

```bash
sudo bash deploy/start.sh http
```

默认通过服务器的 8080 端口访问；有域名时可以使用 HTTPS 方案。

## 测试

```bash
npm test
npm run build
```

测试涵盖组合排名、发牌人数、整手翻转、非法行动、招募与复合操作的原子性、回合结束、双人规则、多轮随机完整对局、手牌隐私、真实 Socket.IO 会话同步、重复提交、断线恢复、轮次计分、服务器重启恢复、房主转移和来源检查。

## 规则约定

参考 Oink Games 版本的 [规则说明书](https://www.hras.cz/user/related_files/new_edition_scout_rules_eng.pdf) 和 [规则文字版](https://www.rulespal.com/scout/rulebook)。

- 3 人去除含 10 的 9 张牌，每人 12 张；4 人去除 9/10 卡，每人 11 张；5 人全部 45 张，每人 9 张。
- 同张数时，同数压顺子；同类型再比较最小数字，严格大于才可压过。
- 手牌整体旋转会反转左右顺序并交换每张牌上下数字。在确认方向前可来回查看。
- 招募只能拿桌面组合两端，选方向后插入任意手牌间隙。拿空桌面后，下位玩家可以自由出牌。
- 最后一位对手也只招募时，本轮结束，即使该次招募刚好清空桌面。招募＋出牌按完整动作判断，不会在中间的招募阶段提前结束。
- 2 人使用 44 张，第一轮每人 11 张，剩余 22 张留给第二轮。每轮各有 3 枚招募筹码，招募花费自己的筹码，之后继续行动。剩余筹码计分；不能出牌且筹码用尽时自动结束。
- 第一个座位为首轮起始玩家，此后每轮顺时针移动。没有计时器，也不会替离线玩家自动操作；离线玩家轮到行动时会等待重连。

## 数据与架构

前端 React + Vite；后端 Node.js + Express + Socket.IO；规则模块在 `shared/rules.js` 和 `server/game.js`。

浏览器使用服务器生成的 HttpOnly、SameSite=Strict 会话 Cookie。持久化文件只保存会话令牌的 SHA-256 哈希。设置 HTTPS 的 `PUBLIC_ORIGIN` 后，Cookie 同时启用 Secure。

默认数据在 `data/rooms.json`；Docker 使用 `scout-table_scout-data` 命名卷。更新容器不会清空房间。全部离线且 24 小时无操作的房间会清理，属于好友临时牌桌，不是永久历史档案。清除浏览器 Cookie 或更换域名后，不能恢复原身份。

当前是**单 Node 进程、单副本**部署。不要同时启动多个进程写同一份数据文件，或在没有共享存储和 Socket.IO adapter 的情况下横向扩容。房间默认上限 200，是容量限制，不代表已经进行过 200 房间压力测试。备份与维护方法见部署文档。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | Node 服务监听端口 |
| `HOST` | `0.0.0.0` | Node 监听地址 |
| `DATA_DIR` | `./data` | 房间持久化目录 |
| `PUBLIC_ORIGIN` | 空 | 生产来源校验，如 `https://scout.example.com`，末尾不加 `/` |
| `MAX_ROOMS` | `200` | 房间数量上限 |
| `HTTP_PORT` | `8080` | HTTP Compose 对外端口 |
| `BIND_ADDRESS` | `0.0.0.0` | HTTP Compose 对外绑定地址 |
| `DOMAIN` | 无 | HTTPS Compose 所用域名 |

Compose 自动读取根目录 `.env`。直接 Node 启动时可用 `node --env-file=.env server/index.js`，或者在系统环境中设置这些值。
