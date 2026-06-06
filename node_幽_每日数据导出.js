// ═══════════════════════════════════════════
// 幽 · 每日数据导出 v1
// 链路G：Cron 0 20 * * *（20:00 CST）
// 查询今日：日报+KPI / 收货 / 送货
// 推送 Telegram：文字摘要 + 3份 CSV 附件
// ═══════════════════════════════════════════

function httpRequest(opts) {
  return new Promise((resolve, reject) => {
    const { URL } = require('url');
    const u = new URL(opts.url);
    const lib = require(u.protocol === 'https:' ? 'https' : 'http');
    const body = opts.body
      ? (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)))
      : null;
    const options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...opts.headers }
    };
    if (body) options.headers['Content-Length'] = body.length;
    const req = lib.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const s = Buffer.concat(chunks).toString('utf8');
        try { resolve(JSON.parse(s)); } catch(e) { resolve(s); }
      });
    });
    req.on('error', reject);
    if (opts.timeout) req.setTimeout(opts.timeout, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── CSV 工具 ──────────────────────────────
function toCsv(headers, rows) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
}

// ── 数字格式化（带千分位逗号）────────────────
function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  return '¥' + Number(n).toLocaleString('zh-CN');
}
function fmtN(n) {
  return (n === null || n === undefined) ? '—' : String(n);
}

// ── 时间戳转CST字符串 ──────────────────────
function toCST(ts) {
  if (!ts) return '';
  return new Date(new Date(ts).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

// ── Telegram 发文字消息（分段处理超长文本）──
async function sendMsg(text) {
  const MAX = 4000;
  const doSend = async t => httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text: t, parse_mode: 'HTML' }),
    timeout: 15000
  });
  if (text.length <= MAX) { await doSend(text); return; }
  const lines = text.split('\n');
  let chunk = '';
  for (const line of lines) {
    if ((chunk + line + '\n').length > MAX) {
      if (chunk) await doSend(chunk.trimEnd());
      chunk = '';
    }
    chunk += line + '\n';
  }
  if (chunk.trim()) await doSend(chunk.trimEnd());
}

// ── Telegram 发 CSV 文件（multipart/form-data）──
async function sendDoc(filename, csvContent, caption) {
  const boundary = 'b' + Date.now() + Math.random().toString(36).slice(2, 8);
  const fileBytes = Buffer.from('﻿' + csvContent, 'utf8'); // BOM → Excel UTF-8
  const preamble = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="chat_id"\r\n\r\n`,
    `${TG_CHAT}\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="caption"\r\n\r\n`,
    `${(caption || '').slice(0, 1024)}\r\n`,
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n`,
    `Content-Type: text/csv; charset=utf-8\r\n\r\n`
  ].join('');
  const body = Buffer.concat([Buffer.from(preamble), fileBytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);

  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendDocument`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('sendDoc timeout')); });
    req.write(body);
    req.end();
  });
}

// ════════════════════════════════════════════

const TG_TOKEN = '<<TG_BOT_TOKEN>>';
const TG_CHAT  = '5349097907';
const PG = { host: 'postgres', port: 5432, database: 'yojo_data', user: 'yojo', password: '<<INTERNAL_API_KEY>>' };
const { Client } = require('pg');

const now  = new Date();
const cst  = new Date(now.getTime() + 8 * 3600 * 1000);
const today = cst.toISOString().slice(0, 10);
const dateDisp    = `${cst.getMonth()+1}月${cst.getDate()}日`;
const dateCompact = today.replace(/-/g, '');

// ── 查询三张表 ─────────────────────────────
const pg = new Client(PG);
await pg.connect();

let reports = [], receipts = [], deliveries = [];
try {
  const [r1, r2, r3] = await Promise.all([
    pg.query(`
      SELECT report_time, employee_name, is_valid, score, score_breakdown,
             score_issues, yesterday_done, today_plan, tags, validation_issues,
             customers_served, new_wechat_customers, payment_received,
             monthly_revenue, monthly_target
      FROM employee_reports
      WHERE report_date = $1 AND report_type = '日报'
      ORDER BY score DESC NULLS LAST, report_time ASC
    `, [today]),
    pg.query(`
      SELECT receipt_no, created_at, staff_name, supplier, product,
             quantity, customer, condition, condition_detail
      FROM warehouse_receipts
      WHERE created_at::date = $1::date
      ORDER BY created_at ASC
    `, [today]),
    pg.query(`
      SELECT delivery_no, created_at, staff_name, supplier, product, quantity,
             customer, address, signed, signed_note, condition, condition_detail
      FROM delivery_records
      WHERE created_at::date = $1::date
      ORDER BY created_at ASC
    `, [today])
  ]);
  reports    = r1.rows;
  receipts   = r2.rows;
  deliveries = r3.rows;
} finally {
  await pg.end();
}

// ── 构建文字摘要 ───────────────────────────
const medals = ['🥇', '🥈', '🥉'];
const SEP = '━'.repeat(22);

// 日报部分
let rptLines = [`📋 <b>今日日报（${reports.length}人提交）</b>`];
if (reports.length === 0) {
  rptLines.push('暂无提交');
} else {
  const valid   = reports.filter(r => r.is_valid);
  const invalid = reports.filter(r => !r.is_valid);

  valid.forEach((r, i) => {
    const medal = medals[i] || '  ';
    const sc = r.score != null ? Number(r.score).toFixed(1) + '分' : '—';
    let line = `${medal} <b>${r.employee_name}</b>  ${sc}`;
    const kpis = [];
    if (r.customers_served != null)    kpis.push(`接待${r.customers_served}人`);
    if (r.new_wechat_customers != null) kpis.push(`企微新增${r.new_wechat_customers}人`);
    if (r.payment_received != null && Number(r.payment_received) >= 0) kpis.push(`收款${fmtMoney(r.payment_received)}`);
    if (r.monthly_revenue != null) {
      const tgt = r.monthly_target != null ? `/${fmtMoney(r.monthly_target)}` : '';
      kpis.push(`月业绩${fmtMoney(r.monthly_revenue)}${tgt}`);
    }
    if (kpis.length) line += '\n    ' + kpis.join('  ');
    if (r.score_issues) line += `\n    💡 ${r.score_issues.slice(0, 40)}`;
    rptLines.push(line);
  });

  if (invalid.length > 0) {
    rptLines.push('');
    rptLines.push(`⚠️ 待补充：${invalid.map(r => r.employee_name).join('、')}`);
    invalid.forEach(r => {
      if (r.validation_issues) rptLines.push(`  ${r.employee_name}：${r.validation_issues.slice(0, 40)}`);
    });
  }

  // KPI 汇总行
  const totalCust  = reports.reduce((s, r) => s + (Number(r.customers_served) || 0), 0);
  const totalNew   = reports.reduce((s, r) => s + (Number(r.new_wechat_customers) || 0), 0);
  const totalPay   = reports.reduce((s, r) => s + (Number(r.payment_received) || 0), 0);
  const hasAnyKpi  = reports.some(r => r.customers_served != null || r.payment_received != null);
  if (hasAnyKpi) {
    rptLines.push('');
    rptLines.push('📊 <b>今日KPI合计</b>');
    if (totalCust > 0)  rptLines.push(`  接待客户：${totalCust}人`);
    if (totalNew  > 0)  rptLines.push(`  企微新增：${totalNew}人`);
    if (totalPay  > 0)  rptLines.push(`  收款合计：${fmtMoney(totalPay)}`);
  }
}

// 收货部分
let rcpLines = [`📦 <b>今日收货（${receipts.length}单）</b>`];
if (receipts.length === 0) {
  rcpLines.push('暂无记录');
} else {
  receipts.forEach(r => {
    const condIcon = r.condition === '货损' ? '⚠️货损' : '✅完好';
    rcpLines.push(`<code>${r.receipt_no}</code>  ${toCST(r.created_at).slice(11, 16)}`);
    rcpLines.push(`  ${r.supplier || '—'} ${r.product || '—'} ×${fmtN(r.quantity)}件`);
    rcpLines.push(`  项目：${r.customer || '—'}  ${condIcon}`);
    if (r.condition === '货损' && r.condition_detail) rcpLines.push(`  ↳ 货损：${r.condition_detail}`);
    rcpLines.push('');
  });
}

// 送货部分
let dlvLines = [`🚚 <b>今日送货（${deliveries.length}单）</b>`];
if (deliveries.length === 0) {
  dlvLines.push('暂无记录');
} else {
  deliveries.forEach(r => {
    const signIcon = r.signed ? '✅已签收' : '⚠️未签收';
    const condNote = r.condition === '货损' ? '  ⚠️货损' : '';
    dlvLines.push(`<code>${r.delivery_no}</code>  ${toCST(r.created_at).slice(11, 16)}`);
    dlvLines.push(`  ${r.supplier || '—'} ${r.product || '—'} ×${fmtN(r.quantity)}件`);
    dlvLines.push(`  客户：${r.customer || '—'}${r.address ? '  ' + r.address : ''}`);
    dlvLines.push(`  ${signIcon}${condNote}`);
    if (!r.signed && r.signed_note) dlvLines.push(`  备注：${r.signed_note}`);
    if (r.condition === '货损' && r.condition_detail) dlvLines.push(`  ↳ 货损：${r.condition_detail}`);
    dlvLines.push('');
  });
}

const summaryText = [
  `📊 <b>有久住建 · 每日数据报表</b>`,
  `${dateDisp}  截止 20:00`,
  SEP,
  rptLines.join('\n'),
  SEP,
  rcpLines.join('\n'),
  SEP,
  dlvLines.join('\n'),
  SEP,
  `📎 完整明细见下方 CSV 附件`
].join('\n');

await sendMsg(summaryText);

// ── 生成并发送 CSV 附件 ────────────────────

// 日报
if (reports.length > 0) {
  const headers = ['日期', '提交时间(CST)', '员工姓名', '合格', '总分', '完整度', '具体度', '量化感',
    '失分说明', '昨日完成', '今日计划', '事项标签', '接待客户数', '企微新增客户数',
    '收款(元)', '月累计业绩(元)', '月目标业绩(元)', '不合格原因'];
  const rows = reports.map(r => {
    const sb = r.score_breakdown
      ? (typeof r.score_breakdown === 'object' ? r.score_breakdown : JSON.parse(r.score_breakdown))
      : {};
    const tagsStr = Array.isArray(r.tags) ? r.tags.join('/') : String(r.tags || '').replace(/[{}"]/g, '');
    return [
      today,
      String(r.report_time || '').slice(0, 8),
      r.employee_name,
      r.is_valid ? '合格' : '不合格',
      r.score != null ? Number(r.score).toFixed(1) : '',
      sb['完整度'] != null ? sb['完整度'] : '',
      sb['具体度'] != null ? sb['具体度'] : '',
      sb['量化感'] != null ? sb['量化感'] : '',
      r.score_issues || '',
      (r.yesterday_done || '').replace(/\n/g, '；'),
      (r.today_plan || '').replace(/\n/g, '；'),
      tagsStr,
      r.customers_served != null ? r.customers_served : '',
      r.new_wechat_customers != null ? r.new_wechat_customers : '',
      r.payment_received != null ? r.payment_received : '',
      r.monthly_revenue != null ? r.monthly_revenue : '',
      r.monthly_target != null ? r.monthly_target : '',
      r.validation_issues || ''
    ];
  });
  await sendDoc(`日报_${dateCompact}.csv`, toCsv(headers, rows), `📋 日报数据 ${dateDisp}（${reports.length}条记录）`);
}

// 收货
if (receipts.length > 0) {
  const headers = ['编号', '收货时间(CST)', '记录人', '供应商/品牌', '产品名称', '数量(件)', '客户/项目', '货物状态', '货损说明'];
  const rows = receipts.map(r => [
    r.receipt_no,
    toCST(r.created_at),
    r.staff_name,
    r.supplier || '',
    r.product || '',
    r.quantity != null ? r.quantity : '',
    r.customer || '',
    r.condition,
    r.condition_detail || ''
  ]);
  await sendDoc(`收货_${dateCompact}.csv`, toCsv(headers, rows), `📦 收货数据 ${dateDisp}（${receipts.length}条记录）`);
}

// 送货
if (deliveries.length > 0) {
  const headers = ['编号', '送货时间(CST)', '记录人', '供应商/品牌', '产品名称', '数量(件)', '客户', '送货地址', '是否签收', '签收备注', '货物状态', '货损说明'];
  const rows = deliveries.map(r => [
    r.delivery_no,
    toCST(r.created_at),
    r.staff_name,
    r.supplier || '',
    r.product || '',
    r.quantity != null ? r.quantity : '',
    r.customer || '',
    r.address || '',
    r.signed ? '已签收' : '未签收',
    r.signed_note || '',
    r.condition,
    r.condition_detail || ''
  ]);
  await sendDoc(`送货_${dateCompact}.csv`, toCsv(headers, rows), `🚚 送货数据 ${dateDisp}（${deliveries.length}条记录）`);
}

return [{ json: { date: today, reports: reports.length, receipts: receipts.length, deliveries: deliveries.length } }];
