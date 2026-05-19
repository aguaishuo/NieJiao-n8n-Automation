# NieJiao · n8n 自动化工作流

> 内部代号：捏脚 | 有久住建自动化办公项目

企业微信、钉钉、Telegram、Odoo 之间的数据流转与自动化任务。

## 部署环境

- **n8n**：https://n8n.yojohouse.com（Mac OrbStack Docker，端口 5678）
- **数据库**：PostgreSQL 16（yojo_data）
- **AI 模型**：Qwen3.6-35B MLX（本机 oMLX，端口 8000）

## 工作流备份说明

每次修改工作流后，从 n8n 导出最新 JSON 更新对应目录下的 `workflow.json`。

## 目录结构

```
/workflows     各工作流 JSON 备份
/docs          流程说明文档
```
