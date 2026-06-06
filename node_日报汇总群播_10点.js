// ═══════════════════════════════════════════
// Nbat · 日报汇总群播（每日10:00 Cron）
// 新增节点，需在 n8n 中独立创建一条新链路（Cron: 10:45 CST）
// 员工提交截止时间：10:30
// ⚠ GROUP_WEBHOOK 须替换为实际值
// ═══════════════════════════════════════════

function httpRequest(opts) {
  return new Promise((resolve, reject) => {
    const { URL } = require('url');
    const u = new URL(opts.url);
    const lib = require(u.protocol === 'https:' ? 'https' : 'http');
    const body = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null;
    const options = { hostname:u.hostname, port:u.port||(u.protocol==='https:'?443:80), path:u.pathname+u.search, method:opts.method||'GET', headers:{...opts.headers} };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(options, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){resolve(d);} }); });
    req.on('error', reject);
    if (opts.timeout) req.setTimeout(opts.timeout, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ⚠️ 替换为实际群机器人 webhook URL
const GROUP_WEBHOOK = 'PLACEHOLDER_WEBHOOK_URL';

const PG_CONFIG = { host:'postgres', port:5432, database:'yojo_data', user:'yojo', password:'<<INTERNAL_API_KEY>>' };

const now = new Date();
const cst = new Date(now.getTime() + 8 * 3600 * 1000);
const today = cst.toISOString().slice(0, 10);
const dateDisplay = `${cst.getMonth()+1}月${cst.getDate()}日`;

const pg = new Client(PG_CONFIG);
const { Client } = require('pg');

let rows = [];
try {
  await pg.connect();
  const res = await pg.query(`
    SELECT employee_name, score, score_issues, yesterday_done, today_plan, tags, is_valid, validation_issues
    FROM employee_reports
    WHERE report_date = $1 AND report_type = '日报'
    ORDER BY score DESC NULLS LAST, report_time ASC
  `, [today]);
  rows = res.rows;
  await pg.end();
} catch(e) {
  return [{ json: { error: 'PG查询失败: ' + e.message } }];
}

if (rows.length === 0) {
  if (GROUP_WEBHOOK !== 'PLACEHOLDER_WEBHOOK_URL') {
    await httpRequest({
      method: 'POST', url: GROUP_WEBHOOK,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: `📋 ${dateDisplay} 日报汇总\n\n今日暂无日报提交。` } }),
      timeout: 10000
    });
  }
  return [{ json: { sent: 0 } }];
}

// 评分排名（仅合格日报参与排名）
const validRows  = rows.filter(r => r.is_valid);
const invalidRows = rows.filter(r => !r.is_valid);
const medals = ['🥇', '🥈', '🥉'];

let rankStr = '';
validRows.forEach((r, i) => {
  const medal = medals[i] || '  ';
  const score = r.score != null ? r.score.toFixed(1) : '—';
  const issue = r.score_issues ? ` ⚠${r.score_issues.slice(0,15)}` : '';
  rankStr += `${medal} ${r.employee_name || '员工'}  ${score}分${issue}\n`;
});
if (invalidRows.length > 0) {
  rankStr += `\n格式不合格（需重发）：${invalidRows.map(r => r.employee_name).join('、')}\n`;
}

// 今日事项汇总（按类别分组）
const categoryMap = {
  '设计出图': '📐',
  '客户跟进': '👥',
  '报价签约': '📝',
  '下单采购': '🛒',
  '安装验收': '🔧',
  '收货入库': '📦',
  '售后处理': '🔁',
  '行政管理': '📋'
};
const catItems = {};
rows.forEach(r => {
  const planLines = (r.today_plan || '').split('\n').filter(l => l.trim());
  (r.tags || []).forEach(tag => {
    if (!catItems[tag]) catItems[tag] = [];
  });
  planLines.forEach(line => {
    const tag = (r.tags || [])[0] || '其他';
    if (!catItems[tag]) catItems[tag] = [];
    catItems[tag].push(`${line.slice(0, 30)} — ${r.employee_name}`);
  });
});

let catStr = '';
for (const [cat, items] of Object.entries(catItems)) {
  if (items.length === 0) continue;
  const icon = categoryMap[cat] || '•';
  catStr += `\n${icon} ${cat}（${items.length}项）\n`;
  items.slice(0, 3).forEach(item => catStr += `  · ${item}\n`);
  if (items.length > 3) catStr += `  · ...共${items.length}项\n`;
}

const msg = [
  `📋 ${dateDisplay} 工作日报汇总`,
  ``,
  `提交情况：${rows.length}人 ✅`,
  ``,
  `━━━━ 评分排名 ━━━━`,
  rankStr.trimEnd(),
  catStr ? `\n━━━━ 今日关键事项 ━━━━${catStr}` : '',
].join('\n').replace(/\n{3,}/g, '\n\n');

if (GROUP_WEBHOOK !== 'PLACEHOLDER_WEBHOOK_URL') {
  try {
    await httpRequest({
      method: 'POST', url: GROUP_WEBHOOK,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: msg } }),
      timeout: 10000
    });
  } catch(e) {}
}

return [{ json: { sent: rows.length, message: msg } }];
