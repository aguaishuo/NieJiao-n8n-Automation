# NieJiao · n8n 自动化工作流

> 内部代号：捏脚 | 有久住建自动化办公项目

企业微信、钉钉、Telegram、Odoo 之间的数据流转与自动化任务。

## 部署环境

- **n8n**：https://n8n.yojohouse.com（HP OMEN Docker，192.168.31.220，端口 5678，版本 2.23.2）
- **数据库**：PostgreSQL 16（yojo_data，yojo-postgres 容器）
- **AI 模型**：全部节点统一使用 HP llama.cpp `http://192.168.31.220:30000`，模型 `Qwen3.6-27B-Q4K_M`，上下文 200k tokens
- **数据目录**：`/home/docker/n8n/`（HP OMEN）

## 架构设计原则

1. **幽是唯一中枢**：只对主理人 Telegram（chat_id 5349097907），读取全部公司数据
2. **收集机器人只写不读**：Nbat 等只写 PG，不知道任何内部信息
3. **数据流单向**：收集机器人 → PG 数据中心 → 幽

## 工作流

### ✅ YOJO AI 通讯中枢（ID: e31vA0CzKxdxLYhF）— 34节点，7条链路

| 链路 | 触发 | 功能 |
|------|------|------|
| A · Nbat 企微汇报 | 员工发 WeCom | AI解析+评分+KPI提取 → 企微回复 → 写PG |
| B · 幽 TG问答 | 主理人发 Telegram | 读全部数据，深度分析 |
| C · 幽 每日报告 | Cron 09:00 CST | 经营简报 → TG推送 |
| D · 幽 钉钉同步 | Cron 22:30 CST | 考勤+审批 → PG |
| E · 幽 月度报告 | Cron 每月1日 08:00 CST | 月度运营报告 → TG推送 |
| F · Nbat 日报汇总 | Cron 10:45 CST 周一至六 | 评分排名+今日事项 → 企微推主理人 |
| G · 幽 数据导出 | Cron 20:00 CST | 三表CSV+摘要 → TG推送 |

## ⚠️ 关键运维说明

### 企微 API 必须走 VPS 中继

企业微信 IP 白名单只有搬瓦工 VPS（144.168.57.93），HP/Mac 直连超时。

```
n8n → http://144.168.57.93:8090/cgi-bin/... → VPS nginx(niejiao-wecom-relay) → qyapi.weixin.qq.com
```

受影响节点（已配置为中继地址）：
- `获取 access_token`：`http://144.168.57.93:8090/cgi-bin/gettoken`
- `发送企微消息`：`http://144.168.57.93:8090/cgi-bin/message/send`

**迁移 n8n 后必须检查这两个节点是否仍指向中继地址。**

### SQLite 修复（崩溃/WAL 残留）

```bash
docker stop n8n
# 如有 WAL 残留（database.sqlite-shm/wal 异常大）:
# sqlite3 /home/docker/n8n/data/database.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
docker start n8n
```

**绝不在 n8n 运行时直接写 SQLite。**

### n8n REST API（v2.23.2）

```bash
# 登录
curl -X POST http://192.168.31.220:5678/rest/login \
  -H "Content-Type: application/json" \
  -d '{"emailOrLdapLoginId":"f@yojohouse.com","password":"Hyxhyxhyx222."}' \
  -c /tmp/n8n.txt

# 更新工作流（用 PATCH，不是 PUT）
curl -X PATCH http://192.168.31.220:5678/rest/workflows/<ID> \
  -H "Content-Type: application/json" \
  -b /tmp/n8n.txt -d @workflow.json
```

## PostgreSQL 数据中心

连接：`host=postgres port=5432 db=yojo_data user=yojo pass=yojohousing123`

| 表 | 用途 | 写入方 |
|----|------|--------|
| employee_reports | 员工企微日报（含5KPI字段）| Nbat 链路 A |
| chat_history | 幽 TG 对话记忆 | 幽 链路 B |
| company_memory | 幽长期记忆（daily/monthly/user_note）| 报告节点/"记住"指令 |
| dingtalk_attendance | 钉钉考勤 | 链路 D |
| dingtalk_approvals | 钉钉审批18类（含金额）| 链路 D |
| odoo_snapshots | 每日 Odoo 业务快照 | 链路 C |
| daily_briefings | 每日/月度报告存档 | 链路 C/E |

## 工作流备份说明

每次修改工作流后，从 n8n 导出最新 JSON 更新对应目录下的 `workflow.json`。

## 目录结构

```
/workflows     各工作流 JSON 备份
/docs          流程说明文档
```
