// ═══════════════════════════════════════════
// 幽 · 每日报告生成 v2
// Cron: 0 1 * * *（09:00 CST）
// 更新：统一幽身份/使命/分析框架；补入收货/送货数据
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
async function odooRead(uid,model,domain,fields,limit=20,order='id desc'){try{const r=await odooCall('/xmlrpc/2/object','execute_kw',[ODOO_DB,uid,ODOO_KEY,model,'search_read',[domain],{fields,limit,order}]);return Array.isArray(r)?r:[];}catch(e){return[];}}

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

表达规范：结论先行 | ⚠️标注需立刻处理 | 行动建议标注「需您处理」或「如授权我可执行」 | 金额带¥和千分位 | 时间具体到日 | 400字以内，不废话`;

let pg = null;
try {
  const now = new Date();
  const today    = new Date(now.getTime()+TZ_OFF).toISOString().slice(0,10);
  const firstDay = today.slice(0,8)+'01';
  const dateStr  = new Date(now.getTime()+TZ_OFF).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});

  pg = new Client(PG);
  await pg.connect();

  // 员工日报
  const er = await pg.query(
    `SELECT employee_name, content, report_time::text
     FROM employee_reports WHERE report_date=NOW()::date ORDER BY report_time DESC LIMIT 20`
  );

  // 考勤
  const at = await pg.query(
    `SELECT employee_name,
       MAX(CASE WHEN check_type='OnDuty' THEN (check_time AT TIME ZONE 'Asia/Shanghai')::time END)::text AS on_duty,
       MAX(CASE WHEN check_type='OffDuty' THEN (check_time AT TIME ZONE 'Asia/Shanghai')::time END)::text AS off_duty,
       MAX(status) AS status
     FROM dingtalk_attendance WHERE check_date=NOW()::date
     GROUP BY employee_name ORDER BY employee_name`
  );

  // 待处理审批
  const ap = await pg.query(
    `SELECT process_name_cn, originator_name, amount, start_time::date::text AS date
     FROM dingtalk_approvals WHERE status='RUNNING' ORDER BY start_time DESC LIMIT 10`
  );

  // 昨日收货（前一天，因为报告是09:00生成）
  const wr = await pg.query(
    `SELECT receipt_no, supplier, product, quantity, customer, condition, condition_detail
     FROM warehouse_receipts
     WHERE created_at::date = NOW()::date - 1
     ORDER BY created_at DESC LIMIT 20`
  );

  // 昨日送货
  const dl = await pg.query(
    `SELECT delivery_no, supplier, product, quantity, customer, signed, condition, condition_detail
     FROM delivery_records
     WHERE created_at::date = NOW()::date - 1
     ORDER BY created_at DESC LIMIT 20`
  );

  // Odoo
  let uid=null, crm=[], orders=[], invoices=[];
  try { uid=await odooCall('/xmlrpc/2/common','authenticate',[ODOO_DB,ODOO_LOGIN,ODOO_KEY,{}]); } catch(e){}
  if (uid) {
    [crm,orders,invoices] = await Promise.all([
      odooRead(uid,'crm.lead',[['active','=',true],['type','=','opportunity']],['name','partner_name','stage_id','expected_revenue','probability'],10),
      odooRead(uid,'sale.order',[['create_date','>=',firstDay]],['name','partner_id','amount_total','state'],20),
      odooRead(uid,'account.move',[['move_type','=','out_invoice'],['payment_state','in',['not_paid','partial']],['state','=','posted']],['name','partner_id','amount_residual','invoice_date_due'],10,'invoice_date_due asc')
    ]);
  }

  // Odoo 快照
  const snapDate = today;
  for(const r of crm)     await pg.query(`INSERT INTO odoo_snapshots(snapshot_date,data_type,record_id,amount,status,extra) VALUES($1,'crm',$2,$3,$4,$5) ON CONFLICT(snapshot_date,data_type,record_id) WHERE record_id IS NOT NULL DO NOTHING`,[snapDate,r.id,r.expected_revenue,f2(r.stage_id),JSON.stringify({name:r.partner_name||r.name,prob:r.probability})]);
  for(const r of orders)  await pg.query(`INSERT INTO odoo_snapshots(snapshot_date,data_type,record_id,amount,status,extra) VALUES($1,'order',$2,$3,$4,$5) ON CONFLICT(snapshot_date,data_type,record_id) WHERE record_id IS NOT NULL DO NOTHING`,[snapDate,r.id,r.amount_total,r.state,JSON.stringify({name:f2(r.partner_id)})]);
  for(const r of invoices) await pg.query(`INSERT INTO odoo_snapshots(snapshot_date,data_type,record_id,amount,status,extra) VALUES($1,'invoice',$2,$3,'unpaid',$4) ON CONFLICT(snapshot_date,data_type,record_id) WHERE record_id IS NOT NULL DO NOTHING`,[snapDate,r.id,r.amount_residual,JSON.stringify({name:f2(r.partner_id),due:r.invoice_date_due})]);

  const crmPip  = crm.reduce((s,r)=>s+(Number(r.expected_revenue)||0),0);
  const ordTot  = orders.reduce((s,r)=>s+(Number(r.amount_total)||0),0);
  const confTot = orders.filter(r=>r.state==='sale'||r.state==='done').reduce((s,r)=>s+(Number(r.amount_total)||0),0);
  const unpaid  = invoices.reduce((s,r)=>s+(Number(r.amount_residual)||0),0);
  const overdue = invoices.filter(r=>r.invoice_date_due&&r.invoice_date_due<today);

  const atSummary = at.rows.length>0
    ? at.rows.map(r=>`${r.employee_name}|上${r.on_duty?r.on_duty.slice(0,5):'—'}下${r.off_duty?r.off_duty.slice(0,5):'—'}|${r.status==='Normal'?'✓':r.status==='Late'?'⚠️迟到':r.status==='NotSigned'?'未签':r.status||''}`).join('；')
    : '（无考勤数据）';
  const erSummary = er.rows.length>0
    ? er.rows.map(r=>`${r.employee_name}: ${r.content.slice(0,80)}`).join('\n')
    : '（今日暂无汇报）';
  const apSummary = ap.rows.length>0
    ? ap.rows.map(r=>`${r.process_name_cn} ${r.originator_name}${r.amount?' ¥'+r.amount:''}`).join('；')
    : '无';

  // 收货/送货摘要
  const wrDamaged = wr.rows.filter(r=>r.condition==='货损');
  const dlUnsigned = dl.rows.filter(r=>!r.signed);
  const wrSummary = wr.rows.length>0
    ? `${wr.rows.length}单${wrDamaged.length>0?' ⚠️货损'+wrDamaged.length+'单:'+wrDamaged.map(r=>`${r.supplier}${r.product}`).join('/'):'，均完好'}`
    : '无';
  const dlSummary = dl.rows.length>0
    ? `${dl.rows.length}单${dlUnsigned.length>0?' ⚠️未签收'+dlUnsigned.length+'单:'+dlUnsigned.map(r=>`${r.customer}`).join('/'):'，均签收'}`
    : '无';

  const dataBlock = `今天${dateStr}

━━ 经营数据 ━━
CRM商机${crm.length}个 管道¥${fmt(crmPip)}
本月订单${orders.length}单 ¥${fmt(ordTot)} 已确认¥${fmt(confTot)}
应收¥${fmt(unpaid)}${overdue.length>0?' ⚠️逾期'+overdue.length+'笔：'+overdue.slice(0,3).map(r=>`${f2(r.partner_id)}¥${fmt(r.amount_residual)}到期${r.invoice_date_due}`).join('；'):''}

━━ 团队运营 ━━
考勤（${at.rows.length}人）：${atSummary}
日报（${er.rows.length}人）：
${erSummary}
待审批：${apSummary}

━━ 物流仓储（昨日）━━
收货：${wrSummary}
送货：${dlSummary}`;

  const parsed = await httpRequest({
    method:'POST', url:'http://host.docker.internal:8000/v1/chat/completions',
    headers:{'Content-Type':'application/json','Authorization':'Bearer <<INTERNAL_API_KEY>>'},
    body: JSON.stringify({
      model:'Qwen3.6-35B-A3B-UD-MLX-4bit',
      messages:[
        {role:'system', content:YOU_IDENTITY},
        {role:'user', content:`${dataBlock}\n\n请生成今日运营简报。主动识别异常和机会，给出行动建议。格式：📊每日简报 [${dateStr}]，按【经营/团队/物流仓储/待办】四块输出，有问题的块用⚠️标注。`}
      ],
      temperature:0.3, max_tokens:1200, chat_template_kwargs:{enable_thinking:false}
    }),
    timeout: 90000
  });
  const briefing = (parsed.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'').trim();

  // 存档 + 长期记忆
  await pg.query('INSERT INTO daily_briefings(briefing_date,content) VALUES($1,$2) ON CONFLICT DO NOTHING',[today, briefing]);
  const memorySummary = `[${dateStr}] CRM管道¥${fmt(crmPip)} 订单¥${fmt(ordTot)}(确认¥${fmt(confTot)}) 应收¥${fmt(unpaid)}${overdue.length>0?' 逾期'+overdue.length+'笔':''} 考勤${at.rows.length}人 日报${er.rows.length}人 待审批${ap.rows.length}条 收货${wr.rows.length}单${wrDamaged.length>0?' 货损'+wrDamaged.length:''} 送货${dl.rows.length}单${dlUnsigned.length>0?' 未签'+dlUnsigned.length:''}`;
  await pg.query('INSERT INTO company_memory(category,content,source) VALUES($1,$2,$3)',['daily_summary', memorySummary, 'daily_report']);

  return [{ json: { briefing, date: today } }];

} catch(e) {
  return [{ json: { briefing: `⚠️ 幽每日报告生成失败：${e.message?.slice(0,80)}`, date: new Date().toISOString().slice(0,10) } }];
} finally {
  if (pg) try { await pg.end(); } catch(e) {}
}
