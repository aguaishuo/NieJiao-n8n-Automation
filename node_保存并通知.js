// ═══════════════════════════════════════════
// Nbat · 保存并通知 v2
// 节点名：保存并通知（替换原"保存员工日报"）
// 依赖节点名：AI解析消息（上一节点）
// 通知对象：主理人 FanXueHan（企业微信应用消息），待测试稳定后可改推部门群
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

// 发给主理人（企业微信应用消息）
const NOTIFY_USER   = 'FanXueHan';
const WECOM_RELAY   = 'http://144.168.57.93:8090';
const WECOM_AGENTID = 1000004;

const PG = { host:'postgres', port:5432, database:'yojo_data', user:'yojo', password:'<<INTERNAL_API_KEY>>' };
const { Client } = require('pg');

const item = $input.first().json;
const {
  fromUser, content, type, is_valid, validation_issues,
  score, score_breakdown, score_issues,
  supplier, product, quantity, customer,
  condition, condition_detail,
  address, signed, signed_note,
  reply
} = item;
let replyFinal = reply;
const customers_served      = item.customers_served      ?? null;
const new_wechat_customers  = item.new_wechat_customers  ?? null;
const payment_received      = item.payment_received      ?? null;
const monthly_revenue       = item.monthly_revenue       ?? null;
const monthly_target        = item.monthly_target        ?? null;

// LLM 有时返回数组，统一转成换行分隔字符串
const toStr = v => Array.isArray(v) ? v.join('\n') : (typeof v === 'string' ? v : '');
const yesterday_done = toStr(item.yesterday_done);
const today_plan     = toStr(item.today_plan);
const tags           = Array.isArray(item.tags) ? item.tags : [];

const now  = new Date();
const cst  = new Date(now.getTime() + 8 * 3600 * 1000);
const date = cst.toISOString().slice(0, 10);
const time = cst.toISOString().slice(11, 19);
const timeDisp = cst.toISOString().slice(11, 16);
const dateCompact = date.replace(/-/g, '');

// ── 生成编号工具 ─────────────────────────────
async function nextNo(prefix, table) {
  const pg = new Client(PG);
  await pg.connect();
  const col = prefix === 'WH' ? 'receipt_no' : 'delivery_no';
  const r = await pg.query(
    `SELECT COUNT(*)+1 AS n FROM ${table} WHERE ${col} LIKE $1`,
    [`${prefix}-${dateCompact}-%`]
  );
  await pg.end();
  return `${prefix}-${dateCompact}-${String(r.rows[0]?.n || 1).padStart(3,'0')}`;
}

// ── 推主理人（企业微信应用消息）────────────────
async function pushOwner(msg) {
  const token = item.accessToken;
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

// ── CSV 降级备份 ──────────────────────────────
function csvFallback(row) {
  const fs = require('fs');
  try {
    fs.appendFileSync('/home/node/.n8n/datacenter/employee_reports.csv',
      `"${date}","${time}","${fromUser}","${fromUser}","${content.replace(/"/g,'""').replace(/\n/g,' ')}"\n`, 'utf8');
  } catch(e) {}
}

// ════════════════════════════════════════════
// 日报
// ════════════════════════════════════════════
if (type === '日报') {
  try {
    const pg = new Client(PG);
    await pg.connect();
    await pg.query(`
      INSERT INTO employee_reports
        (report_date, report_time, employee_id, employee_name, content,
         report_type, is_valid, validation_issues,
         score, score_breakdown, score_issues,
         yesterday_done, today_plan, tags,
         customers_served, new_wechat_customers,
         payment_received, monthly_revenue, monthly_target)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    `, [
      date, time, fromUser, fromUser, content,
      '日报',
      is_valid ?? true,
      validation_issues ?? '',
      score ?? null,
      score_breakdown ? JSON.stringify(score_breakdown) : null,
      score_issues ?? '',
      yesterday_done ?? '',
      today_plan ?? '',
      tags ?? [],
      customers_served,
      new_wechat_customers,
      payment_received,
      monthly_revenue,
      monthly_target
    ]);
    await pg.end();
  } catch(e) {
    csvFallback();
  }
}

// ════════════════════════════════════════════
// 收货
// ════════════════════════════════════════════
if (type === '收货') {
  let receiptNo = `WH-${dateCompact}-001`;
  try {
    receiptNo = await nextNo('WH', 'warehouse_receipts');
    const pg = new Client(PG);
    await pg.connect();
    await pg.query(`
      INSERT INTO warehouse_receipts
        (receipt_no, staff_id, staff_name, supplier, product, quantity,
         customer, condition, condition_detail, notified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `, [
      receiptNo, fromUser, fromUser,
      supplier ?? '', product ?? '', quantity ?? null,
      customer ?? '',
      condition ?? '完好',
      condition_detail ?? '',
      true
    ]);
    await pg.end();
  } catch(e) {}

  // 用真实编号覆盖员工回复
  if (condition === '货损') {
    replyFinal = `📦 收货已记录（货损待处理）\n编号 ${receiptNo}\n${supplier||'品牌'} ${product||'产品'} × ${quantity||'?'}件\n⚠️ ${condition_detail||'货损待确认'}\n请拍照发给行政，我已帮你记录在案。`;
  } else {
    replyFinal = `📦 收货已记录！\n编号 ${receiptNo}\n${supplier||'品牌'} ${product||'产品'} × ${quantity||'?'}件 | ${customer||'项目'} | 完好 ✅\n已通知行政安排派单～`;
  }

  // 即时推主理人（含单号）
  const icon = condition === '货损' ? '⚠️ 货损' : '✅ 完好';
  let msg = `📦 收货通知 ${timeDisp}\n单号：${receiptNo}\n\n`;
  msg += `${supplier || '未知'} ${product || '产品'} × ${quantity || '?'}件\n`;
  if (customer) msg += `项目：${customer}\n`;
  msg += `状态：${icon}\n`;
  msg += `记录人：${fromUser}\n`;
  if (condition === '货损') msg += `\n货损：${condition_detail || '待确认'}\n`;
  msg += `\n→ 可安排安装，@行政 请跟进派单`;
  await pushOwner(msg);
}

// ════════════════════════════════════════════
// 送货
// ════════════════════════════════════════════
if (type === '送货') {
  let deliveryNo = `DL-${dateCompact}-001`;
  try {
    deliveryNo = await nextNo('DL', 'delivery_records');
    const pg = new Client(PG);
    await pg.connect();
    await pg.query(`
      INSERT INTO delivery_records
        (delivery_no, staff_id, staff_name, supplier, product, quantity,
         customer, address, signed, signed_note,
         condition, condition_detail, notified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `, [
      deliveryNo, fromUser, fromUser,
      supplier ?? '', product ?? '', quantity ?? null,
      customer ?? '',
      address ?? '',
      signed ?? false,
      signed_note ?? '',
      condition ?? '完好',
      condition_detail ?? '',
      true
    ]);
    await pg.end();
  } catch(e) {}

  // 用真实编号覆盖员工回复
  {
    const signTxt = signed ? `签收 ✅` : `⚠️ 未签收${signed_note ? '：' + signed_note : ''}`;
    const condTxt = condition === '货损' ? `\n⚠️ 货损：${condition_detail || '待确认'}` : '';
    replyFinal = `🚚 送货已记录${signed ? '！' : ''}\n编号 ${deliveryNo}\n${supplier||'品牌'} ${product||'产品'} × ${quantity||'?'}件\n客户：${customer||'—'}${address ? ' | ' + address : ''}\n${signTxt}${condTxt}\n${signed ? '辛苦啦～' : '请跟行政说明后续处理。'}`;
  }

  // 即时推主理人（含单号）
  const signIcon = signed ? '✅ 已签收' : '⚠️ 未签收';
  const condIcon = condition === '货损' ? ' | ⚠️ 货损' : '';
  let msg = `🚚 送货通知 ${timeDisp}\n单号：${deliveryNo}\n\n`;
  msg += `${supplier || '未知'} ${product || '产品'} × ${quantity || '?'}件\n`;
  msg += `客户：${customer || '未填'}`;
  if (address) msg += ` | ${address}`;
  msg += `\n签收：${signIcon}${condIcon}\n`;
  msg += `记录人：${fromUser}`;
  if (!signed && signed_note) msg += `\n备注：${signed_note}`;
  if (condition === '货损') msg += `\n货损：${condition_detail || '待确认'}`;
  await pushOwner(msg);
}

return [{ json: { fromUser, type, reply: replyFinal, is_valid } }];
