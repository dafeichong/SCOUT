# 在 Ubuntu 24.04 部署

提供两个方案：**公网 IP + HTTP** 快速开玩，或 **域名 + HTTPS** 长期使用。游戏进程、前端页面和 WebSocket 都包含在项目中，不需要额外数据库。

## 1. 安装 Docker

如果已经有 Docker Engine 和 `docker compose`，跳过这一步。以下使用 [Docker 官方 Ubuntu 安装源](https://docs.docker.com/engine/install/ubuntu/)，适用于 Ubuntu 24.04。若服务器已有其他 Docker 发行包，请先按官方文档处理冲突，不要在有业务的服务器上直接卸载。

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
```

## 2. 上传项目

将项目发布包上传至服务器，替换示例中的用户名和服务器地址：

```powershell
scp G:\home\scot_game\release\scout-table.tar.gz ubuntu@你的服务器IP:~/
```

在服务器上解压：

```bash
mkdir -p ~/scout-table
tar -xzf ~/scout-table.tar.gz -C ~/scout-table
cd ~/scout-table
```

也可以通过 Git 获取源码，或直接上传整个项目（不要上传本机 `node_modules`、`data`、`.env`）。

## 3A. 无域名：公网 IP 直接访问

```bash
cd ~/scout-table
cp .env.example .env
sudo bash deploy/start.sh http
```

启动后，在浏览器访问 `http://你的服务器IP:8080`。创建房间并把生成的邀请链接发给朋友。

在云服务器控制台的安全组中开放 **TCP 8080**。如启用了 UFW，可添加 `sudo ufw allow 8080/tcp`；不要为了这个项目重新启用或重置防火墙。Docker 发布端口可能绕过 UFW，外部访问限制应同时设置在云安全组中。

如果 8080 已被占用，在 `.env` 中设置 `HTTP_PORT=8081` 后重启。HTTP 适合试用；有域名后建议使用 HTTPS，保护会话 Cookie 和传输中的手牌。

## 3B. 有域名：自动 HTTPS

1. 将域名 A 记录指向服务器公网 IP。设置 AAAA 记录时也必须指向可达的服务器 IPv6。
2. 云安全组开放 TCP **80、443**；443/UDP 用于可选 HTTP/3。服务器上的 80、443 需空闲。
3. 根目录 `.env` 新增一行，例如 `DOMAIN=scout.example.com`，只填域名，不加协议、端口或斜杠。
4. 若之前启动了 HTTP 方案，先用 `sudo docker compose down` 停止旧容器（不要加 `-v`）。
5. 启动 HTTPS 方案：

```bash
sudo bash deploy/start.sh https
```

访问 `https://scout.example.com`。Caddy 自动申请并续期证书，也会代理 WebSocket；应用端口不会直接暴露在公网。参考 [Caddy reverse_proxy 文档](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。

若服务器已有 Nginx 或 Caddy 占用 80/443，可以继续使用 HTTP Compose，将 `.env` 中 `BIND_ADDRESS=127.0.0.1`，再让现有反向代理转发到 `127.0.0.1:8080`。Nginx 模板见 `deploy/nginx.conf.example`；HTTPS 配置请沿用现有证书管理方式，并把 `PUBLIC_ORIGIN` 设置成浏览器实际使用的完整 HTTPS 来源。

## 4. 验证和维护

HTTP 方案：

```bash
sudo docker compose ps
curl --fail http://127.0.0.1:8080/api/health
sudo docker compose logs --tail=100 scout
```

HTTPS 方案，后续所有 Compose 命令都使用 `-f compose.https.yaml`：

```bash
sudo docker compose -f compose.https.yaml ps
curl --fail https://scout.example.com/api/health
sudo docker compose -f compose.https.yaml logs --tail=100
```

健康接口返回 `{"ok":true}`。用两台设备进入相同房间，确认开始、出牌、刷新恢复均正常。两人在同一浏览器同域名的普通标签页里会共用身份，请改用无痕窗口或不同设备。

**更新：** 上传新源码后，再执行对应的 `deploy/start.sh`。容器重建时会短暂断线，房间由持久化卷恢复，页面会自动重连。

**备份：** 原子替换保存的 `rooms.json` 可以直接复制。HTTP 用以下命令；HTTPS 在 `compose` 后添加 `-f compose.https.yaml`。

```bash
mkdir -p backups
sudo docker compose cp scout:/app/data/rooms.json ./backups/rooms.json
```

刚部署还没有创建任何房间时，数据文件尚不存在。

**恢复：** 先停止服务，将备份放入数据卷。以下示例恢复当前目录 `backups/rooms.json`，会覆盖当前牌局，应先另存当前备份；HTTPS 在所有 `compose` 后加 `-f compose.https.yaml`。

```bash
sudo docker compose stop scout
sudo docker compose run --rm --no-deps --user root -v "$PWD/backups:/backup:ro" scout sh -c 'cp /backup/rooms.json /app/data/rooms.json && chown node:node /app/data/rooms.json'
sudo docker compose up -d
```

不要运行 `docker compose down -v`，它会删除包括房间和证书在内的数据卷。不要将 `rooms.json` 放入网站公开目录。

## 常见问题

- **网页打不开：** 检查云安全组、访问的端口、`docker compose ps`，以及服务器出口能否拉取 npm 包和 Docker 镜像。
- **网页打开但一直连接中：** 检查 `/socket.io/` 的反向代理和 WebSocket Upgrade 配置，确认 `PUBLIC_ORIGIN` 与实际地址一致。
- **HTTPS 没拿到证书：** 检查 DNS 和 80/443 可达性，再看 Caddy 日志。不要绕过浏览器证书警告。
- **刷新后不是原玩家：** 身份依赖当前浏览器 Cookie；IP、域名和无痕窗口属于不同身份。不要清理站点 Cookie。
- **有人长期离线：** 已开局的牌桌会等其重连；在线房主可以结束本场回大厅，再移除离线座位。
- **服务器资源：** 面向好友房间的小规模单机部署，未进行公网压力测试。保持单副本，不要用 PM2 cluster 或多容器同时写此数据卷。

此项目已在本地验证构建、规则和真实 Socket.IO 联机；实际 Ubuntu/Docker 部署仍需在你的服务器上执行并验证。
