---
doc_type: runbook
project: workspace
owner_repository: chenhaoxiang/pi-lobehub
status: active
truth_mode: maintained
created: 2026-11-10
verified: 2026-11-10
verification_scope: Isolated Apple-silicon macOS authenticated Web/backend/CLI fixture, DB migration, local S3/queue/gateway health, device offline/reconnect and original native question single/multi callbacks; no production or business-model turn
---

# 全本机验证环境

本轮是本机验证版，不是服务器部署、正式桌面发行或 24×7 服务。按
[现有 Change](../../openspec/changes/adopt-pi-workspace/tasks.md) 的 P1 准备，
Pi 兼容属于同一 Change 的 P2。不要打开 Vite 打印的线上 Debug Proxy；只访问
本机 Next 后端地址。以下命令均在本任务专属 worktree 执行。

## 工具链与安装边界

本次初始使用 Node 26.9、Bun 1.4.2、pnpm 12.4.1、Docker Desktop arm64；并行本机工具更新后尾验 Node 为 26.13，显式冻结的 Pi SDK 仍是 1.5.0-fork.4，不把两者混为一个版本。
版本来源以 `package.json` 的 `packageManager` 和实际 `--version` 为准。
根 workspace 当前明确 `lockfile: false`，不是不可变依赖树；CLI 独立于根安装。
先保留安装日志、失败和实际版本，不批量改依赖范围：

```sh
# 使用 packageManager 指定的 pnpm，禁止生命周期脚本。
pnpm install --ignore-scripts --child-concurrency=1 --network-concurrency=4
(cd apps/cli && pnpm install --ignore-scripts --child-concurrency=1 --network-concurrency=4)
```

macOS 的 pnpm 自动版本启动器若报官方无 shebang 入口 `ENOEXEC`，可按
[维护说明](pi-fork-maintenance.md#toolchain-and-installation)，对已核实的
12.4.1 shell 入口显式用 `sh`，进程内关闭二次版本切换；不改全局配置。
CLI/根两次无锁安装若解析出不同 Zod，记录并仅对齐本任务 ignored
node_modules 链接后复核类型，不冒称原 CLI standalone 的历史类型失败已修复。独立 CLI 安装还会把共享 package 的 peer 链接指向 CLI store，实测造成 Web 的 use-sync-external-store CommonJS 互操作失败。优先把长期 CLI 安装放在独立、同 head 的运行树。若已在本任务同树安装，先停止自己记录的 dev 服务，找出 packages/*/node_modules 内指向 apps/cli/node_modules 的链接；只把这些本任务生成目录保全移到 tmp/pi-local/ 下，再用根同版本 pnpm install --prefer-offline --ignore-scripts 重建根 peer 依赖，并刷新自己的 Vite 缓存。不要改任何 tracked 依赖策略或删除其它 worktree。此次先保全18个此类目录后根安装修复，Web/类型均恢复；离线安装缺少 miniflare tarball的失败原件保留，并非宣称离线依赖完整。

## 准备私有合成配置

`keys-local/` 已由仓库忽略，目录 0700、文件 0600；不创建根 `.env`。
以下仅生成本任务合成用户/JWKS/API key，不读取真实 profile/Keychain/auth：

```sh
node scripts/piLocalFixture.mjs prepare
# 后续命令先进入清洁 shell，防止继承真实模型/数据库凭据。
env -i HOME="$HOME" PATH="$PATH" TMPDIR="$TMPDIR" bash --noprofile --norc
umask 077
source keys-local/pi-local-validation/source.env
```

已存在的私有 fixture 不覆盖或轮换；缺文件、符号链接和不安全权限明确失败。
默认预留 DB 54321、Redis 63821、S3 19000、QStash 18081、Gateway
18787/18788；Next/Vite 由原 helper 分配并持久化至 `tmp/pi-local/ports.env`。
启动前用 `lsof -nP -iTCP:<端口> -sTCP:LISTEN` 和 `docker container inspect`
检查冲突。占用者不明时换本任务配置的端口/URL，不能杀共享进程或复用外部数据。
源码脚本不自动接管已有容器。

## 数据库与缓存

以 fixture 独立名称创建，端口只绑定 127.0.0.1；不复用共享 5432/6380。
下面 PostgreSQL digest 是本次验证的 arm64 镜像，不宣称已验证其它架构：

```sh
# 先确认两个名字均不存在；存在时核对本任务 label、端口和数据，不能覆盖。
docker run -d --name "$DB_CONTAINER" --label "pi-lobehub.instance=$PI_LOCAL_INSTANCE" \
  --memory=1536m --cpus=2 -p "$DB_PORT:5432" -e POSTGRES_PASSWORD=postgres \
  paradedb/paradedb@sha256:47c628b48806f292e6b12357e905082ced06baa9d78cdee3ebefa21edb497923 \
  postgres -c shared_preload_libraries=pg_search,pg_cron,pg_stat_statements -c shared_buffers=128MB
docker run -d --name "$REDIS_CONTAINER" --label "pi-lobehub.instance=$PI_LOCAL_INSTANCE" \
  --memory=128m --cpus=1 -p "$REDIS_PORT:6379" \
  redis@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2 \
  redis-server --save '' --appendonly no
.agents/acceptance/scripts/init-dev-env.sh setup-db
# 原 seed helper 会打印合成密码/API key；过滤后才显示或保存日志。
set -o pipefail
.agents/acceptance/scripts/init-dev-env.sh seed-user 2>&1 | node -e \
  'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>console.log(s.replace(/^.*(?:password:|LOBE_API_KEY:).*$/gm,"[fixture credential redacted]")));'
.agents/acceptance/scripts/init-dev-env.sh write keys-local/pi-local-validation/runtime.env >/dev/null
source keys-local/pi-local-validation/runtime.env
source keys-local/pi-local-validation/source.env
```

原 seed 创建固定合成 `user_agent_testing_001`，只在此隔离数据库内使用。
测试 PostgreSQL 密码 `postgres` 不是生产凭据。私有 key/JWKS 不进入聊天、
日志、Git、截图或 PR。

## 本机 S3、队列、Gateway 与 Web

每个服务用自己的前台终端运行，按上节先加载同一配置，正常停止即 Ctrl+C。
S3 沿原 helper，使用独立 `tmp/pi-local/s3`，默认只绑定 127.0.0.1：

```sh
.agents/acceptance/scripts/init-dev-env.sh s3
```

QStash 使用固定 `@upstash/qstash-cli@2.44.2` 的官方二进制。其原 dev
命令监听所有网卡，因此本轮改放在本任务 Docker 容器内，仅向宿主发布
`127.0.0.1:18081:8080`。可从官方
`https://artifacts.upstash.com/qstash/versions/2.44.2/qstash-server_2.44.2_linux_arm64.tar.gz`
下载到 `tmp/pi-local/`，先列出 tar 成员，仅提取普通文件 `qstash`，拒绝
其它路径/链接，再只读挂载运行；不要执行未知包生命周期：

```sh
# QSTASH_BINARY 是已核对的本任务 Linux arm64 qstash 文件绝对路径。
docker run -d --name "pi-lobehub-$PI_LOCAL_INSTANCE-qstash" \
  --label "pi-lobehub.instance=$PI_LOCAL_INSTANCE" --memory=128m --cpus=1 \
  -p 127.0.0.1:18081:8080 --mount "type=bind,src=$QSTASH_BINARY,dst=/qstash,readonly" \
  alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce /qstash dev -port 8080
```

原 helper 已生成 QStash 本地开发专用 token/signing-key 配置；不能换成托管
Upstash。容器内 callback 不能使用其自身 localhost，所以 Web 启动进程增加
`AGENT_RUNTIME_BASE_URL=http://host.docker.internal:$PORT`。此地址仅供
Docker→宿主 callback；浏览器 `APP_URL` 仍是 `http://localhost:$PORT`。

Gateway 用相同 fixture 的 public JWKS 与 service token。先把私有
`gateway.env` 中 `__PORT__` 替换为已分配的 Next `$PORT`，不打印其它值：

```sh
node -e 'const f="keys-local/pi-local-validation/gateway.env",fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("__PORT__",process.env.PORT),{mode:0o600});'
docker run -d --name "pi-lobehub-$PI_LOCAL_INSTANCE-gateway" \
  --label "pi-lobehub.instance=$PI_LOCAL_INSTANCE" --memory=256m --cpus=1 \
  -p 127.0.0.1:18787:8787 -p 127.0.0.1:18788:8788 \
  --env-file keys-local/pi-local-validation/gateway.env \
  ghcr.io/lobehub/lobehub-gateway@sha256:63647fd8f97407dafd344dd08b509ff74a033b23292cf1d451d804cb09d35759
export AGENT_RUNTIME_BASE_URL="http://host.docker.internal:$PORT"
export DEV_HOST=127.0.0.1
.agents/acceptance/scripts/init-dev-env.sh dev
```

`DEV_HOST` 同时传给 Next 和 Vite；未设置时保留上游开发默认，不改变其它
开发者的监听行为。本机实测 Next/Vite、S3 和四个 Docker 服务的宿主监听
均为 loopback；Docker Gateway→宿主 Web 请求也已成功。原 dev 脚本打印
的线上代理 URL 不是测试入口，不能打开它当作本地验真。

在另一个同配置终端运行 preflight：

```sh
.agents/acceptance/scripts/init-dev-env.sh preflight
```

本次 DB 迁移、Redis、QStash 双向鉴权探测、S3 Put/Get/Delete、Web 登录页
200 与 Gateway health 都实际通过；进程启动或单个 200 不代表完整业务通过。

## 独立 CLI 设备与掉线验证

不能使用上游 seed 默认 `.lobehub-dev` 去触碰日常 HOME。此入口在
`keys-local/pi-local-validation/home` 创建本任务 CLI home，只签发当前
合成用户的两小时 JWT，不读取/复制真实登录态：

```sh
source keys-local/pi-local-validation/source.env
source keys-local/pi-local-validation/cli.env
node scripts/piLocalFixture.mjs connect
```

JWT 方式也避免 Docker Gateway 把 API-key 登录的宿主 `localhost` 误当
容器 localhost；这里不是绕过真实用户认证。仅限回环 HTTP，外部 URL 明确拒绝。
该设备会提供原 CLI 能力，因此只用于自己的合成后端，不能连接线上用户。channel 使用 `cli-` 前缀（本入口为 `cli-pi-local-validation`）；任意不识别的前缀虽然 socket 已连，Web 会把它排除出可执行 CLI 设备，不能用纯连通冒称可用。

从另一清洁终端沿同一私有 CLI env 运行 `device list --json`，显式设置
`HOME="$PWD/keys-local/pi-local-validation/home"` 和 `LOBEHUB_CLI_HOME=.lobehub-local`。
检查实际 deviceId、channel、registry 和 online，不以 hostname/cwd 推导业务任务。
停止该连接自己的前台进程后，再查应为 offline；重新连接同一 id 应回 online。
本次已实际观察 **online → offline → online**，普通查看新增业务模型请求为零。

## 停止、清理与真实限制

- 前台 CLI/S3 正常 Ctrl+C；dev 用原 helper 的 `stop-dev`，它检查 PID、出生时间、cwd 与命令后只停自己记录的进程树。不要 `pkill` 全局 Pi/Node。
- 暂停本任务 Docker 容器前，先核对精确名称、`pi-lobehub.instance` label 与本任务配置；`docker stop <已核实名称>` 保留数据。不能对共享容器批量 stop/rm。
- 确认不再需要本 fixture 后，才移除自己的 stopped 容器和 `tmp/pi-local/s3`；数据库无独立持久卷，删除容器会丢弃合成数据。私有配置/profile 由用户决定是否保留，不随普通停止删除。
- 本次早期人工创建的四个容器使用 label `pi-lobehub.task=local-validation-01a1` 和显式名称；它们属于同一已核实测试，不冒称自动生成脚本新建。原件保留，不自动改名或覆盖。
- Gateway 状态在内存，QStash 为本地模拟器，Redis 不持久化；后端/容器重启不承诺在途任务自动恢复。关闭页面与结束服务是两回事，不能写成 24×7 自治已上线。
- 用户明确允许本次 localhost 合成账号的现有条款复选框后，沿普通表单登录；随后认证端点核到 `user_agent_testing_001`，真实 agent 页面和设备选择器在线状态已核。当前上游空根路由不能代替可用工作页，使用 `/agent/<id>/<topic>` 的 canonical 路径，不沿旧 `?topic=` 冒称已进入该话题。
- 已登录 Web→后端→独立 CLI→真实 Pi1.5.0-fork.4→原问答工具的单选和多选回调实测通过：单选返回所点原中文标签；多选先选2再选0、显式提交后返回原序索引 `[0,2]`。原工具 fixture 记录 providerRequests=0；问答由原生 input hook 触发，不冒称真实业务模型发起的工具回合。先前30秒ACK失败、旧前端fixture取消保留，不改标通过。显式模式无额外自由文本/notes，剩余时间明确不会自动提交；无新 VoiceOver/全键盘验收声明。
- 无真实业务账号、客户数据、已保存凭据或业务模型请求；P3–P6、Desk 卸载、生产/正式发布仍在本轮范围之外。
