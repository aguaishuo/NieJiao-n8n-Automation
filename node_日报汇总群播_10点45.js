// ═══════════════════════════════════════════
// Nbat · 日报汇总推主理人
// 节点名：幽·日报汇总群播（新增链路F，Cron 10:45 CST）
// 员工提交截止：10:30
// 当前阶段：发给主理人 FanXueHan，不推部门群
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

const NOTIFY_USER    = 'FanXueHan';
const WECOM_RELAY    = 'http://144.168.57.93:8090';
const WECOM_AGENTID  = 1000004;
const WECOM_CORPID   = 'wwa6ac4bfac5d924c4';
const WECOM_SECRET   = '<<WECOM_SECRET>>';
const PG = { host:'postgres', port:5432, database:'yojo_data', user:'yojo', password:'<<INTERNAL_API_KEY>>' };

// 获取 access_token
async function getToken() {
  const res = await httpRequest({
    url: `${WECOM_RELAY}/cgi-bin/gettoken?corpid=${WECOM_CORPID}&corpsecret=${WECOM_SECRET}`,
    timeout: 10000
  });
  return res.access_token || '';
}

// 推主理人
async function pushOwner(token, msg) {
  if (!token) return;
  try {
    await httpRequest({
      method: 'POST',
      url: `${WECOM_RELAY}/cgi-bin/message/send?access_token=${token}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: NOTIFY_USER,
        msgtype: 'text',
        agentid: WECOM_AGENTID,
        text: { content: msg },
        safe: 0
      }),
      timeout: 10000
    });
  } catch(e) {}
}
const { Client } = require('pg');

const now  = new Date();
const cst  = new Date(now.getTime() + 8 * 3600 * 1000);
const today = cst.toISOString().slice(0, 10);
const dateDisp = `${cst.getMonth()+1}月${cst.getDate()}日`;

// 读今日日报
let rows = [];
try {
  const pg = new Client(PG);
  await pg.connect();
  const res = await pg.query(`
    SELECT employee_name, score, score_breakdown, score_issues,
           yesterday_done, today_plan, tags, is_valid, validation_issues
    FROM employee_reports
    WHERE report_date = $1 AND report_type = '日报'
    ORDER BY score DESC NULLS LAST, report_time ASC
  `, [today]);
  rows = res.rows;
  await pg.end();
} catch(e) {
  return [{ json: { error: 'PG查询失败: ' + e.message } }];
}

// 无日报
if (rows.length === 0) {
  const token = await getToken();
  await pushOwner(token, `📋 ${dateDisp} 工作日报汇总\n\n今日暂无日报提交。`);
  return [{ json: { sent: 0 } }];
}

// 评分排名
const valid   = rows.filter(r => r.is_valid);
const invalid = rows.filter(r => !r.is_valid);
const medals  = ['🥇','🥈','🥉'];

let rankStr = '';
valid.forEach((r, i) => {
  const medal = medals[i] || '  ';
  const sc    = r.score != null ? Number(r.score).toFixed(1) : '—';
  const issue = r.score_issues ? ` ⚠${r.score_issues.slice(0,18)}` : '';
  rankStr += `${medal} ${r.employee_name || '员工'}  ${sc}分${issue}\n`;
});
if (invalid.length > 0) {
  rankStr += `\n格式待完善：${invalid.map(r=>r.employee_name).join('、')}\n`;
}

// 今日事项（按人展示，附标签）
const catIcon = {
  '设计出图':'📐','客户跟进':'👥','报价签约':'📝',
  '下单采购':'🛒','安装验收':'🔧','收货入库':'📦',
  '售后处理':'🔁','行政管理':'📋','送货配送':'🚚'
};

let catStr = '';
rows.forEach(r => {
  let planRaw = r.today_plan || '';
  let planLines = [];
  if (planRaw.startsWith('{') && planRaw.endsWith('}')) {
    planLines = planRaw.slice(1,-1).split('","').map(s => s.replace(/^"|"$/g,'').trim()).filter(Boolean);
  } else {
    planLines = planRaw.split('\n').filter(l => l.trim());
  }
  if (!planLines.length) return;
  const tagArr = Array.isArray(r.tags) ? r.tags : (r.tags ? r.tags.replace(/[{}"]/g,'').split(',').map(t=>t.trim()) : []);
  const tagLabel = tagArr.filter(Boolean).slice(0, 2).map(t => (catIcon[t] || '') + t).join('/') || '其他';
  catStr += `\n👤 ${r.employee_name}（${tagLabel}）\n`;
  planLines.slice(0, 4).forEach(l => catStr += `  · ${l.slice(0, 35)}\n`);
  if (planLines.length > 4) catStr += `  · 共${planLines.length}项\n`;
});

const msg = [
  `📋 ${dateDisp} 工作日报汇总`,
  ``,
  `提交人数：${rows.length}人`,
  ``,
  `━━━━ 评分排名 ━━━━`,
  rankStr.trimEnd(),
  catStr ? `\n━━━━ 今日关键事项 ━━━━${catStr}` : ''
].join('\n').replace(/\n{3,}/g, '\n\n');

const token = await getToken();
await pushOwner(token, msg);

return [{ json: { sent: rows.length, message: msg } }];
