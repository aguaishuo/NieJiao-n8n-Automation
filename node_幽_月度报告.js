// ═══════════════════════════════════════════
// 幽 · 月度报告生成 v2
// Cron: 0 0 1 * *（每月1日 08:00 CST）
// 更新：统一幽身份/使命/分析框架；补入收货/送货月度统计
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

const ODOO_URL='https://my.yojohouse.com',ODOO_DB='yojohousing',ODOO_LOGIN='bot@yojohouse.com',ODOO_KEY='<<ODOO_API_KEY>>';
function xv(v){if(v===false||v===null||v===undefined)return'<value><boolean>0</boolean></value>';if(v===true)return'<value><boolean>1</boolean></value>';if(typeof v==='number')return Number.isInteger(v)?`<value><int>${v}</int></value>`:`<value><double>${v}</double></value>`;if(typeof v==='string')return`<value><string>${v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string></value>`;if(Array.isArray(v))return`<value><array><data>${v.map(xv).join('')}</data></array></value>`;if(typeof v==='object')return`<value><struct>${Object.entries(v).map(([k,u])=>`<member><name>${k}</name>${xv(u)}</member>`).join('')}</struct></value>`;return`<value><string>${String(v)}</string></value>`;}
function buildXml(m,p){return`<?xml version='1.0'?><methodCall><methodName>${m}</methodName><params>${p.map(x=>`<param>${xv(x)}</param>`).join('')}</params></methodCall>`;}
function exDepth(t){const v=[];let i=0;while(i<t.length){const s=t.indexOf('<value>',i);if(s<0)break;let d=0,j=s;while(j<t.length){if(t.substring(j,j+7)==='<value>'){d++;j+=7;}else if(t.substring(j,j+8)==='</value>'){d--;j+=8;if(!d)break;}else j++;}v.push(t.slice(s+7,j-8));i=j;}return v;}
function pv(s){s=(s||'').trim();if(!s)return false;if(/^<i(?:nt|4)>/.test(s))return parseInt(s.replace(/<\/?(?:int|i4)>/g,''))||0;if(s.startsWith('<double>'))return parseFloat(s.replace(/<\/?double>/g,''))||0;if(s.startsWith('<boolean>'))return s.includes('>1<');if(s.startsWith('<string>'))return s.slice(8,-9).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');if(s.startsWith('<array>')){const dm=s.match(/<data>([\s\S]*)<\/data>/);return dm?exDepth(dm[1]).map(pv):[];}if(s.startsWith('<struct>')){const obj={};let i=0,sc=s.slice(8);while(i<sc.length){const ms=sc.indexOf('<member>',i),me=sc.indexOf('</member>',ms);if(ms<0||me<0)break;const mc=sc.slice(ms+8,me),nm=mc.match(/<name>([\s\S]*?)<\/name>/);if(nm){const vls=exDepth(mc);if(vls.length)obj[nm[1]]=pv(vls[0]);}i=me+9;}return obj;}return s.replace(/<[^>]+>/g,'').trim()||false;}
function parseXml(xml){if(xml.includes('<fault>')){const m=xml.match(/faultString[\s\S]*?<string>([\s\S]*?)<\/string>/);throw new Error('Odoo: '+(m?.[1]||'fault'));}const ps=xml.indexOf('<param>');if(ps<0)return null;const vls=exDepth(xml.slice(ps));return vls.length?pv(vls[0]):null;}
async function odooCall(p,m,params){const r=await httpRequest({method:'POST',url:ODOO_URL+p,headers:{'Content-Type':'text/xml'},body:buildXml(m,params),timeout:20000});return parseXml(typeof r==='string'?r:String(r));}
async function odooRead(uid,model,domain,fields,limit=50,order='id desc'){try{const r=await odooCall('/xmlrpc/2/object','execute_kw',[ODOO_DB,uid,ODOO_KEY,model,'search_read',[domain],{fields,limit,order}]);return Array.isArray(r)?r:[];}catch(e){return[];}}

const { Client } = require('pg');
const PG = {host:'postgres',port:5432,database:'yojo_data',user:'yojo',password:'<<INTERNAL_API_KEY>>'};
const fmt = n => Math.round(Number(n)||0).toLocaleString('zh-CN');
const f2  = r => Array.isArray(r)?r[1]:(r||'');
const TZ_OFF = 8*3600000;

// 幽的统一身份与分析框架（全链路一致）
const YOU_IDENTITY = `你是「幽」，有久住建（YOJO HOUSING）的自主运营智能体，唯一服务对象：主理人范学翰。

使命：让有久住建的业务持续健康增长——这是你分析每一条数据的出发点，也是你判断什么值得主动汇报的标准。

行动边界：你有独立的分析和判断能力，但没有独立的执行权。
工作流永远是：分析数据 → 发现问题或机会 → 提出建议 → 等待主理人决定。

分析框架：趋势是什么 → 根本原因 → 不干预30天后怎样 → 建议行动由谁执行

业务背景：代理品牌骊住LIXIL · 宝来标准TAKARA · 日门NIHON FLUSH · 通世泰TOSTEM，覆盖整体厨卫、室内门、玄关门、全屋定制，客户以装修公司和房产开发商为主，成单周期长。

表达规范：结论先行 | ⚠️标注需立刻处理 | 行动建议标注「需您处理」或「如授权我可执行」 | 金额带¥和千分位 | 数据对比具体到数字 | 600字以内`;

let pg = null;
try {
  const now = new Date();
  const today     = new Date(now.getTime()+TZ_OFF).toISOString().slice(0,10);
  const thisMonth = today.slice(0,7);
  const d = new Date(now.getTime()+TZ_OFF);
  d.setDate(1); d.setMonth(d.getMonth()-1);
  const lastMonth      = d.toISOString().slice(0,7);
  const lastMonthStart = lastMonth+'-01';
  const lastMonthEnd   = thisMonth+'-01';
  const monthLabel     = lastMonth.replace('-','年')+'月';

  pg = new Client(PG);
  await pg.connect();

  // 上月 Odoo 快照
  const snapCrm   = await pg.query(`SELECT COUNT(DISTINCT record_id) AS cnt, COALESCE(SUM(amount),0)::int AS total FROM odoo_snapshots WHERE data_type='crm' AND snapshot_date>=$1 AND snapshot_date<$2`,[lastMonthStart,lastMonthEnd]);
  const snapOrder = await pg.query(`SELECT COUNT(DISTINCT record_id) AS cnt, COALESCE(SUM(amount),0)::int AS total, SUM(CASE WHEN status IN('sale','done') THEN amount ELSE 0 END)::int AS confirmed FROM odoo_snapshots WHERE data_type='order' AND snapshot_date>=$1 AND snapshot_date<$2`,[lastMonthStart,lastMonthEnd]);
  const snapInv   = await pg.query(`SELECT COALESCE(SUM(amount),0)::int AS total FROM odoo_snapshots WHERE data_type='invoice' AND snapshot_date>=$1 AND snapshot_date<$2`,[lastMonthStart,lastMonthEnd]);

  // 上月考勤汇总
  const atSum = await pg.query(
    `SELECT employee_name, COUNT(DISTINCT check_date) AS days,
       SUM(CASE WHEN status='Late' THEN 1 ELSE 0 END) AS late_cnt,
       SUM(CASE WHEN status='NotSigned' THEN 1 ELSE 0 END) AS unsigned_cnt
     FROM dingtalk_attendance WHERE check_date>=$1 AND check_date<$2 AND check_type='OnDuty'
     GROUP BY employee_name ORDER BY late_cnt DESC`,
    [lastMonthStart, lastMonthEnd]
  );

  // 上月审批汇总
  const apSum = await pg.query(
    `SELECT process_name_cn AS type, COUNT(*) AS cnt, COALESCE(SUM(amount),0)::int AS total,
       SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) AS pending
     FROM dingtalk_approvals WHERE start_time>=$1 AND start_time<$2
     GROUP BY process_name_cn ORDER BY total DESC`,
    [lastMonthStart, lastMonthEnd]
  );

  // 上月员工汇报统计
  const erSum = await pg.query(
    `SELECT employee_name, COUNT(*) AS report_cnt FROM employee_reports
     WHERE report_date>=$1 AND report_date<$2
     GROUP BY employee_name ORDER BY report_cnt DESC`,
    [lastMonthStart, lastMonthEnd]
  );

  // 上月收货/送货统计
  const wrSum = await pg.query(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN condition='货损' THEN 1 ELSE 0 END) AS damaged,
       COUNT(DISTINCT supplier) AS suppliers
     FROM warehouse_receipts WHERE created_at>=$1 AND created_at<$2`,
    [lastMonthStart, lastMonthEnd]
  );
  const dlSum = await pg.query(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN signed=false THEN 1 ELSE 0 END) AS unsigned,
       SUM(CASE WHEN condition='货损' THEN 1 ELSE 0 END) AS damaged
     FROM delivery_records WHERE created_at>=$1 AND created_at<$2`,
    [lastMonthStart, lastMonthEnd]
  );

  // Odoo 当月实时
  let uid=null, crmNow=[], ordersNow=[], invNow=[];
  try { uid=await odooCall('/xmlrpc/2/common','authenticate',[ODOO_DB,ODOO_LOGIN,ODOO_KEY,{}]); } catch(e){}
  if (uid) {
    [crmNow, ordersNow, invNow] = await Promise.all([
      odooRead(uid,'crm.lead',[['active','=',true],['type','=','opportunity']],['name','partner_name','stage_id','expected_revenue'],15),
      odooRead(uid,'sale.order',[['create_date','>=',thisMonth+'-01']],['name','partner_id','amount_total','state'],30),
      odooRead(uid,'account.move',[['move_type','=','out_invoice'],['payment_state','in',['not_paid','partial']],['state','=','posted']],['name','partner_id','amount_residual','invoice_date_due'],20,'invoice_date_due asc')
    ]);
  }

  const crmNowPip    = crmNow.reduce((s,r)=>s+(Number(r.expected_revenue)||0),0);
  const ordNowTot    = ordersNow.reduce((s,r)=>s+(Number(r.amount_total)||0),0);
  const ordNowConf   = ordersNow.filter(r=>r.state==='sale'||r.state==='done').reduce((s,r)=>s+(Number(r.amount_total)||0),0);
  const invNowUnpaid = invNow.reduce((s,r)=>s+(Number(r.amount_residual)||0),0);
  const overdueNow   = invNow.filter(r=>r.invoice_date_due&&r.invoice_date_due<today);

  const atDetail = atSum.rows.map(r=>`${r.employee_name}出勤${r.days}天${Number(r.late_cnt)>0?` 迟到${r.late_cnt}次`:''}${Number(r.unsigned_cnt)>0?` 未签${r.unsigned_cnt}次`:''}`).join('；')||'无数据';
  const apDetail = apSum.rows.slice(0,8).map(r=>`${r.type}${r.cnt}笔¥${fmt(r.total)}${Number(r.pending)>0?` (待审${r.pending})`:''}`).join('；')||'无';
  const erDetail = erSum.rows.map(r=>`${r.employee_name}(${r.report_cnt}次)`).join(' ')||'无数据';

  const wr0 = wrSum.rows[0]||{total:0,damaged:0};
  const dl0 = dlSum.rows[0]||{total:0,unsigned:0,damaged:0};
  const wrDetail = `收货${wr0.total}单${Number(wr0.damaged)>0?` ⚠️货损${wr0.damaged}单`:'，无货损'}`;
  const dlDetail = `送货${dl0.total}单${Number(dl0.unsigned)>0?` ⚠️未签收${dl0.unsigned}单`:'，全部签收'}${Number(dl0.damaged)>0?` ⚠️货损${dl0.damaged}单`:''}`;

  const dataBlock = `━━ ${monthLabel}核心数据 ━━
销售：订单${snapOrder.rows[0]?.cnt||0}单 总额¥${fmt(snapOrder.rows[0]?.total)} 确认¥${fmt(snapOrder.rows[0]?.confirmed)}
CRM：商机管道有记录
应收：月内应收台账¥${fmt(snapInv.rows[0]?.total)}

━━ 当前状态（本月进行中）━━
CRM管道：${crmNow.length}个商机 ¥${fmt(crmNowPip)}
本月订单：${ordersNow.length}单 ¥${fmt(ordNowTot)} 确认¥${fmt(ordNowConf)}
应收账款：¥${fmt(invNowUnpaid)}${overdueNow.length>0?' ⚠️逾期'+overdueNow.length+'笔':''}

━━ 人员 ━━
考勤：${atDetail}
汇报积极性：${erDetail}

━━ 财务审批 ━━
${apDetail}

━━ 物流仓储 ━━
${wrDetail}
${dlDetail}`;

  const parsed = await httpRequest({
    method:'POST', url:'http://host.docker.internal:8000/v1/chat/completions',
    headers:{'Content-Type':'application/json','Authorization':'Bearer <<INTERNAL_API_KEY>>'},
    body: JSON.stringify({
      model:'Qwen3.6-35B-A3B-UD-MLX-4bit',
      messages:[
        {role:'system', content:YOU_IDENTITY},
        {role:'user', content:`${dataBlock}\n\n请生成${monthLabel}月度运营报告。深度复盘上月，结合当前态势，给出战略建议。格式：📈【${monthLabel}月度报告】，分：一、业绩复盘（数字对比）二、团队状况 三、财务与物流健康 四、下月重点建议（3条，每条标注执行人）`}
      ],
      temperature:0.3, max_tokens:1500, chat_template_kwargs:{enable_thinking:false}
    }),
    timeout: 120000
  });
  const report = (parsed.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'').trim();

  // 存入长期记忆
  const memorySummary = `${monthLabel}：订单¥${fmt(snapOrder.rows[0]?.total||0)} 确认¥${fmt(snapOrder.rows[0]?.confirmed||0)} 应收¥${fmt(snapInv.rows[0]?.total||0)} 收货${wr0.total}单${Number(wr0.damaged)>0?' 货损'+wr0.damaged:''} 送货${dl0.total}单${Number(dl0.unsigned)>0?' 未签'+dl0.unsigned:''}`;
  await pg.query('INSERT INTO company_memory(category,content,source) VALUES($1,$2,$3)',['monthly_summary', memorySummary, 'monthly_report']);
  await pg.query('INSERT INTO daily_briefings(briefing_date,content) VALUES($1,$2) ON CONFLICT DO NOTHING',[today, `[月度报告]\n${report}`]);

  return [{ json: { report, month: lastMonth } }];

} catch(e) {
  return [{ json: { report: `⚠️ 幽月度报告生成失败：${e.message?.slice(0,80)}`, month: 'error' } }];
} finally {
  if (pg) try { await pg.end(); } catch(e) {}
}
