// ═══════════════════════════════════════════
// 幽 · AI运营核心 v4
// 有久住建 (YOJO HOUSING) 专属运营助理
// 更新：新增收货/送货数据读取（warehouse_receipts / delivery_records）
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

// Odoo XML-RPC
const ODOO_URL='https://my.yojohouse.com', ODOO_DB='yojohousing', ODOO_LOGIN='bot@yojohouse.com', ODOO_KEY='<<ODOO_API_KEY>>';
function xv(v){if(v===false||v===null||v===undefined)return'<value><boolean>0</boolean></value>';if(v===true)return'<value><boolean>1</boolean></value>';if(typeof v==='number')return Number.isInteger(v)?`<value><int>${v}</int></value>`:`<value><double>${v}</double></value>`;if(typeof v==='string')return`<value><string>${v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string></value>`;if(Array.isArray(v))return`<value><array><data>${v.map(xv).join('')}</data></array></value>`;if(typeof v==='object')return`<value><struct>${Object.entries(v).map(([k,u])=>`<member><name>${k}</name>${xv(u)}</member>`).join('')}</struct></value>`;return`<value><string>${String(v)}</string></value>`;}
function buildXml(m,p){return`<?xml version='1.0'?><methodCall><methodName>${m}</methodName><params>${p.map(x=>`<param>${xv(x)}</param>`).join('')}</params></methodCall>`;}
function exDepth(t){const v=[];let i=0;while(i<t.length){const s=t.indexOf('<value>',i);if(s<0)break;let d=0,j=s;while(j<t.length){if(t.substring(j,j+7)==='<value>'){d++;j+=7;}else if(t.substring(j,j+8)==='</value>'){d--;j+=8;if(!d)break;}else j++;}v.push(t.slice(s+7,j-8));i=j;}return v;}
function pv(s){s=(s||'').trim();if(!s)return false;if(/^<i(?:nt|4)>/.test(s))return parseInt(s.replace(/<\/?(?:int|i4)>/g,''))||0;if(s.startsWith('<double>'))return parseFloat(s.replace(/<\/?double>/g,''))||0;if(s.startsWith('<boolean>'))return s.includes('>1<');if(s.startsWith('<string>'))return s.slice(8,-9).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');if(s.startsWith('<array>')){const dm=s.match(/<data>([\s\S]*)<\/data>/);return dm?exDepth(dm[1]).map(pv):[];}if(s.startsWith('<struct>')){const obj={};let i=0,sc=s.slice(8);while(i<sc.length){const ms=sc.indexOf('<member>',i),me=sc.indexOf('</member>',ms);if(ms<0||me<0)break;const mc=sc.slice(ms+8,me),nm=mc.match(/<name>([\s\S]*?)<\/name>/);if(nm){const vls=exDepth(mc);if(vls.length)obj[nm[1]]=pv(vls[0]);}i=me+9;}return obj;}return s.replace(/<[^>]+>/g,'').trim()||false;}
function parseXml(xml){if(xml.includes('<fault>')){const m=xml.match(/faultString[\s\S]*?<string>([\s\S]*?)<\/string>/);throw new Error('Odoo: '+(m?.[1]||'fault'));}const ps=xml.indexOf('<param>');if(ps<0)return null;const vls=exDepth(xml.slice(ps));return vls.length?pv(vls[0]):null;}
async function odooCall(p,m,params){const r=await httpRequest({method:'POST',url:ODOO_URL+p,headers:{'Content-Type':'text/xml'},body:buildXml(m,params),timeout:20000});return parseXml(typeof r==='string'?r:String(r));}
async function odooRead(uid,model,domain,fields,limit=15,order='id desc'){try{const r=await odooCall('/xmlrpc/2/object','execute_kw',[ODOO_DB,uid,ODOO_KEY,model,'search_read',[domain],{fields,limit,order}]);return Array.isArray(r)?r:[];}catch(e){return[];}}

// DingTalk token
const DD_ID='<<DINGTALK_CLIENT_ID>>', DD_SECRET='<<DINGTALK_SECRET>>';
async function getDingToken(){try{const r=await httpRequest({method:'POST',url:'https://api.dingtalk.com/v1.0/oauth2/accessToken',headers:{'Content-Type':'application/json'},body:JSON.stringify({appKey:DD_ID,appSecret:DD_SECRET}),timeout:10000});return r.accessToken||null;}catch(e){return null;}}

const PG_CONFIG={host:'postgres',port:5432,database:'yojo_data',user:'yojo',password:'<<INTERNAL_API_KEY>>'};

// ─── 解析 TG 输入 ───
const inp = $input.first().json;
const msg = inp.body ? inp : (inp.message ? {body: inp} : inp);
const userMsg  = msg.body?.message?.text || msg.body?.callback_query?.data || inp.message?.text || '';
const chatId   = msg.body?.message?.chat?.id || msg.body?.callback_query?.message?.chat?.id || inp.message?.chat?.id;
const fromName = msg.body?.message?.from?.first_name || inp.message?.from?.first_name || '主理人';

if (!userMsg || !chatId) return [{ json: { skip: true } }];

// ─── 意图识别 ───
const isHistorical = /上(个?月|周|季|年)|历史|趋势|对比|之前|过去|统计|同比|环比|月报/.test(userMsg);
const isEmployee   = /员工|汇报|日报|谁汇报|今天汇报/.test(userMsg);
const isAttendance = /考勤|打卡|缺勤|迟到|早退|出勤/.test(userMsg);
const isApproval   = /审批|申请|报销|请假|付款|收款|转账|备用金/.test(userMsg);
const isWarehouse  = /收货|入库|到货|仓库/.test(userMsg);
const isDelivery   = /送货|配送|发货|已送/.test(userMsg);
const isRemember   = /^记住|^帮我?记住|^幽.*记住/.test(userMsg.trim());

let reply = '', pgClient = null;
try {
  const { Client } = require('pg');
  pgClient = new Client(PG_CONFIG);
  await pgClient.connect();

  // ─── 处理「记住」指令 ───
  if (isRemember) {
    const content = userMsg.replace(/^(幽[，,]?\s*)?帮?我?记住[：:]?\s*/,'').trim();
    if (content) {
      await pgClient.query(
        'INSERT INTO company_memory(category,content,source) VALUES($1,$2,$3)',
        ['user_note', content, 'user']
      );
      await pgClient.query('INSERT INTO chat_history(chat_id,role,content) VALUES($1,$2,$3)',[chatId,'user',userMsg]);
      reply = `✅ 已记住：${content}`;
      await pgClient.query('INSERT INTO chat_history(chat_id,role,content) VALUES($1,$2,$3)',[chatId,'assistant',reply]);
      return [{ json: { chatId, reply, fromName, skip: false } }];
    }
  }

  // ─── 加载对话记忆 ───
  await pgClient.query('INSERT INTO chat_history(chat_id,role,content) VALUES($1,$2,$3)',[chatId,'user',userMsg]);
  const hr = await pgClient.query(
    `SELECT role,content FROM chat_history WHERE chat_id=$1 AND id<(SELECT MAX(id) FROM chat_history WHERE chat_id=$1 AND role='user') ORDER BY created_at DESC LIMIT 384`,
    [chatId]
  );
  const history = hr.rows.reverse();

  // ─── 加载长期运营记忆 ───
  let memContext = '';
  try {
    const mr = await pgClient.query(
      `SELECT DISTINCT ON(category) category, content, created_at::date AS date
       FROM company_memory ORDER BY category, created_at DESC LIMIT 20`
    );
    if (mr.rows.length) {
      const grouped = {};
      for (const r of mr.rows) {
        if (!grouped[r.category]) grouped[r.category] = [];
        grouped[r.category].push(r.content.slice(0,200));
      }
      const catLabel = {daily_summary:'每日摘要',monthly_summary:'月度摘要',user_note:'主理人备注',business_context:'业务背景'};
      memContext = mr.rows.map(r=>`[${catLabel[r.category]||r.category} ${r.date}] ${r.content.slice(0,150)}`).join('\n');
    }
  } catch(e){}

  // ─── Odoo 实时数据 ───
  let uid=null, crm=[], orders=[], projects=[], invoices=[];
  try { uid=await odooCall('/xmlrpc/2/common','authenticate',[ODOO_DB,ODOO_LOGIN,ODOO_KEY,{}]); } catch(e){}
  const today=new Date().toLocaleDateString('sv',{timeZone:'Asia/Shanghai'});
  const firstDay=today.slice(0,8)+'01';
  if (uid) {
    [crm,orders,projects,invoices] = await Promise.all([
      odooRead(uid,'crm.lead',[['active','=',true],['type','=','opportunity']],['name','partner_name','stage_id','expected_revenue','user_id','probability'],15),
      odooRead(uid,'sale.order',[['create_date','>=',firstDay]],['name','partner_id','amount_total','state','user_id'],20),
      odooRead(uid,'project.project',[['active','=',true]],['name','task_count','user_id'],10),
      odooRead(uid,'account.move',[['move_type','=','out_invoice'],['payment_state','in',['not_paid','partial']],['state','=','posted']],['name','partner_id','amount_residual','invoice_date_due'],15,'invoice_date_due asc')
    ]);
  }

  // ─── 额外数据（按意图加载）───
  let extraContext = '';

  if (isHistorical) {
    try {
      const sr = await pgClient.query(
        `SELECT snapshot_date::text,data_type,COUNT(*)::int AS cnt,COALESCE(SUM(amount),0)::int AS total
         FROM odoo_snapshots WHERE snapshot_date>=NOW()-INTERVAL '60 days'
         GROUP BY snapshot_date,data_type ORDER BY snapshot_date DESC,data_type`
      );
      if (sr.rows.length) {
        const bt={};
        for(const r of sr.rows){if(!bt[r.data_type])bt[r.data_type]=[];bt[r.data_type].push(`${r.snapshot_date}:${r.cnt}条¥${Number(r.total).toLocaleString()}`);}
        extraContext+='\n\n━━ 历史数据(近60天) ━━\n';
        for(const[t,ls]of Object.entries(bt)) extraContext+=`【${t}】${ls.slice(0,8).join(' | ')}\n`;
      }
    } catch(e){}
  }

  if (isEmployee) {
    try {
      const er = await pgClient.query(
        `SELECT report_date::text,report_time::text,employee_name,content
         FROM employee_reports WHERE report_date>=NOW()-INTERVAL '7 days'
         ORDER BY report_date DESC,report_time DESC LIMIT 30`
      );
      if (er.rows.length) {
        extraContext+='\n\n━━ 员工近期汇报(近7天) ━━\n';
        extraContext+=er.rows.map(r=>`[${r.report_date} ${(r.report_time||'').slice(0,5)}] ${r.employee_name||'员工'}: ${r.content.slice(0,100)}`).join('\n');
      }
    } catch(e){}
  }

  if (isAttendance) {
    try {
      const atRes = await pgClient.query(
        `SELECT check_date::text,employee_name,
          MAX(CASE WHEN check_type='OnDuty' THEN (check_time AT TIME ZONE 'Asia/Shanghai')::time END)::text AS on_duty,
          MAX(CASE WHEN check_type='OffDuty' THEN (check_time AT TIME ZONE 'Asia/Shanghai')::time END)::text AS off_duty,
          MAX(status) AS status
         FROM dingtalk_attendance
         WHERE check_date>=NOW()-INTERVAL '7 days'
         GROUP BY check_date,employee_name ORDER BY check_date DESC,employee_name LIMIT 80`
      );
      if (atRes.rows.length) {
        extraContext+='\n\n━━ 钉钉考勤(近7天) ━━\n';
        const byDate={};
        for(const r of atRes.rows){if(!byDate[r.check_date])byDate[r.check_date]=[];
          const on=r.on_duty?r.on_duty.slice(0,5):'—';const off=r.off_duty?r.off_duty.slice(0,5):'—';
          const st=r.status==='Normal'?'✓':r.status==='Late'?'⚠️迟到':r.status==='NotSigned'?'未签':r.status||'';
          byDate[r.check_date].push(`${r.employee_name}|上${on}下${off}|${st}`);
        }
        for(const[date,rows]of Object.entries(byDate).slice(0,5)){
          extraContext+=`【${date}】\n`+rows.join('\n')+'\n';
        }
      } else {
        const tok=await getDingToken();
        if(tok){
          const nm={"19666753301002115915":"河西店钉钉","2019310439958070":"田润","01204607092726094794":"李利清","193732151327268312":"武文龙","02225017544432947696":"荆一航","01460365686626128445":"李国富","040861324423228271":"孟宇婷","01143758676720122410":"乔栋梁","03000614335826401259":"李秀保","2769162927609321":"汪玉全","02420409591824192647":"张志瑞","01095809385936235423":"连晓琴","2129672500943136":"王晋","452607132120052":"乔","3315535343943071":"王昊","013350420128674564":"刘娜","031340082138347198":"靳蓓蕾","066041602132989069":"范学翰"};
          const ar=await httpRequest({method:'POST',url:`https://oapi.dingtalk.com/attendance/list?access_token=${tok}`,headers:{'Content-Type':'application/json'},body:JSON.stringify({workDateFrom:today+' 00:00:00',workDateTo:today+' 23:59:59',userIdList:Object.keys(nm),isI18n:false,offset:0,limit:50}),timeout:10000});
          if(ar.recordresult?.length){extraContext+='\n\n━━ 今日考勤(实时) ━━\n';extraContext+=ar.recordresult.slice(0,20).map(r=>{const ts=parseInt(r.userCheckTime)||0;const t=ts>0?new Date(ts).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}):'—';return`${nm[r.userId]||r.userId}|${r.checkType==='OnDuty'?'上班':'下班'}|${t}|${r.timeResult==='Normal'?'✓':r.timeResult||''}`}).join('\n');}
        }
      }
    } catch(e){ extraContext+=`\n\n考勤查询异常:${e.message?.slice(0,40)}`; }
  }

  if (isApproval) {
    try {
      const apRes = await pgClient.query(
        `SELECT process_name_cn AS type, originator_name,
          CASE status WHEN 'RUNNING' THEN '进行中' WHEN 'COMPLETED' THEN '已完成' WHEN 'TERMINATED' THEN '已撤销' ELSE status END AS status_cn,
          CASE result WHEN 'agree' THEN '同意' WHEN 'refuse' THEN '拒绝' ELSE '—' END AS result_cn,
          CASE WHEN amount IS NOT NULL THEN '¥'||amount::int::text ELSE '' END AS amount,
          start_time::date::text AS date
         FROM dingtalk_approvals WHERE start_time>=NOW()-INTERVAL '30 days'
         ORDER BY start_time DESC LIMIT 40`
      );
      if (apRes.rows.length) {
        extraContext+='\n\n━━ 钉钉审批(近30天) ━━\n';
        const byType={};
        for(const r of apRes.rows){if(!byType[r.type])byType[r.type]=[];byType[r.type].push(`${r.originator_name}|${r.date}|${r.status_cn}|${r.result_cn}${r.amount?' '+r.amount:''}`);}
        for(const[type,rows]of Object.entries(byType)) extraContext+=`【${type}】\n`+rows.slice(0,6).join('\n')+'\n';
      } else {
        extraContext+='\n\n近30天暂无审批记录';
      }
    } catch(e){ extraContext+=`\n\n审批查询异常:${e.message?.slice(0,40)}`; }
  }

  if (isWarehouse) {
    try {
      const wrRes = await pgClient.query(
        `SELECT receipt_no, (created_at AT TIME ZONE 'Asia/Shanghai')::text AS local_time,
                staff_name, supplier, product, quantity, customer, condition, condition_detail
         FROM warehouse_receipts WHERE created_at >= NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC LIMIT 20`
      );
      if (wrRes.rows.length) {
        extraContext += '\n\n━━ 近7天收货记录 ━━\n';
        wrRes.rows.forEach(r => {
          const t = (r.local_time||'').slice(0,16);
          const cond = r.condition === '货损' ? `⚠️货损:${r.condition_detail||'待确认'}` : '✅完好';
          extraContext += `${r.receipt_no} ${t} ${r.supplier||'—'} ${r.product||'—'} ×${r.quantity||'?'}件 ${r.customer||'—'} ${cond}\n`;
        });
      } else {
        extraContext += '\n\n近7天暂无收货记录';
      }
    } catch(e) { extraContext += `\n\n收货查询异常:${e.message?.slice(0,40)}`; }
  }

  if (isDelivery) {
    try {
      const dlRes = await pgClient.query(
        `SELECT delivery_no, (created_at AT TIME ZONE 'Asia/Shanghai')::text AS local_time,
                staff_name, supplier, product, quantity, customer, address, signed, condition, condition_detail
         FROM delivery_records WHERE created_at >= NOW() - INTERVAL '7 days'
         ORDER BY created_at DESC LIMIT 20`
      );
      if (dlRes.rows.length) {
        extraContext += '\n\n━━ 近7天送货记录 ━━\n';
        dlRes.rows.forEach(r => {
          const t = (r.local_time||'').slice(0,16);
          const sign = r.signed ? '✅已签收' : '⚠️未签收';
          const cond = r.condition === '货损' ? ' ⚠️货损' : '';
          extraContext += `${r.delivery_no} ${t} ${r.supplier||'—'} ${r.product||'—'} ×${r.quantity||'?'}件 ${r.customer||'—'}${r.address?' '+r.address:''} ${sign}${cond}\n`;
        });
      } else {
        extraContext += '\n\n近7天暂无送货记录';
      }
    } catch(e) { extraContext += `\n\n送货查询异常:${e.message?.slice(0,40)}`; }
  }

  // ─── 构建幽的系统提示词 ───
  const fmt = n => Math.round(Number(n)||0).toLocaleString('zh-CN');
  const f2  = r => Array.isArray(r) ? r[1] : (r||'');
  const crmPip  = crm.reduce((s,r)=>s+(Number(r.expected_revenue)||0),0);
  const ordTot  = orders.reduce((s,r)=>s+(Number(r.amount_total)||0),0);
  const confTot = orders.filter(r=>r.state==='sale'||r.state==='done').reduce((s,r)=>s+(Number(r.amount_total)||0),0);
  const unpaid  = invoices.reduce((s,r)=>s+(Number(r.amount_residual)||0),0);
  const overdue = invoices.filter(r=>r.invoice_date_due&&r.invoice_date_due<today);
  const nowStr  = new Date().toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'long'});
  const memNote = history.length>0 ? `（已加载${Math.ceil(history.length/2)}轮对话记忆）` : '（新对话）';

  const crmDetail  = crm.slice(0,6).map(r=>`  • ${r.partner_name||r.name} | ${f2(r.stage_id)} | ¥${fmt(r.expected_revenue)} | ${f2(r.user_id)} | ${Math.round(r.probability||0)}%`).join('\n')||'  暂无';
  const orderDetail= orders.slice(0,6).map(r=>`  • ${f2(r.partner_id)} ¥${fmt(r.amount_total)} [${r.state==='sale'?'确认':r.state==='done'?'完成':'草稿'}] ${f2(r.user_id)}`).join('\n')||'  暂无';
  const overdueDetail=overdue.slice(0,4).map(r=>`  ⚠️ ${f2(r.partner_id)} ¥${fmt(r.amount_residual)} 到期${r.invoice_date_due}`).join('\n')||'  无逾期';

  const sysPrompt = `你是「幽」，有久住建（YOJO HOUSING）的自主运营智能体，唯一服务对象：主理人范学翰。

━━ 使命 ━━
让有久住建的业务持续健康增长。这是你分析每一条数据的出发点，是你判断什么值得主动汇报的标准。

━━ 行动边界 ━━
你有独立的分析和判断能力，但没有独立的执行权。
工作流永远是：分析数据 → 发现问题或机会 → 提出建议 → 等待主理人决定。
主理人说「我来处理」→ 你记录，下次跟进结果；说「你去执行」→ 你才采取行动并汇报结果。
未经授权，不触发任何操作。

━━ 今天 ${nowStr} ${memNote}

━━ 当前经营数据 ━━
CRM商机 ${crm.length}个 | 管道总值 ¥${fmt(crmPip)}
${crmDetail}

本月订单 ${orders.length}单 总计 ¥${fmt(ordTot)} | 已确认 ¥${fmt(confTot)} | 待确认 ¥${fmt(ordTot-confTot)}
${orderDetail}

项目 ${projects.length}个: ${projects.map(r=>r.name+'('+r.task_count+'任务)').join(' | ')||'—'}

应收账款 ¥${fmt(unpaid)}${overdue.length>0?' | ⚠️逾期'+overdue.length+'笔 ¥'+fmt(overdue.reduce((s,r)=>s+Number(r.amount_residual),0)):''}
${overdueDetail}
${extraContext}
▌长期运营记忆
${memContext||'（暂无——可发"记住：xxx"存入重要信息）'}

━━ 工作方式 ━━
每次被唤醒先扫描五个维度：
→ 商机管道：有没有超过2周没推进的商机？
→ 应收账款：有没有已逾期或即将逾期的款项？
→ 团队执行：考勤异常、日报断档、审批积压？
→ 本月目标：按当前进度，缺口在哪？
→ 物流仓储：近期收货/送货有无货损或未签收异常？（发送含"收货/送货"关键词可查询详情）
发现异常→主动提出，给出建议，询问是否授权处理；一切正常→简短说明现状，给出下一步建议

━━ 分析框架 ━━
趋势是什么 → 根本原因 → 不干预30天后怎样 → 建议行动由谁执行

━━ 计划能力 ━━
主理人给出目标时：拆解缺口 → 识别优先商机 → 给出行动清单（标注哪些需主理人亲自处理）→ 下次主动追踪进度

━━ 业务背景 ━━
代理品牌：骊住LIXIL · 宝来标准TAKARA · 日门NIHON FLUSH · 通世泰TOSTEM
覆盖整体厨卫、室内门、玄关门、全屋定制。客户以装修公司和房产开发商为主，成单周期长。

━━ 表达规范 ━━
结论先行 | ⚠️标注需立刻处理的事项 | 每条建议末尾标注「需要您处理」或「如授权我可以执行」| 金额带¥和千分位，时间具体到日 | 400字以内，不废话

━━ 边界 ━━
只服务主理人范学翰，其他人消息静默跳过。`;

  // ─── 调用 Qwen（幽的大脑）───
  const messages = [{role:'system',content:sysPrompt},...history,{role:'user',content:userMsg}];
  const parsed = await httpRequest({
    method:'POST', url:'http://host.docker.internal:8000/v1/chat/completions',
    headers:{'Content-Type':'application/json','Authorization':'Bearer <<INTERNAL_API_KEY>>'},
    body: JSON.stringify({
      model:'Qwen3.6-35B-A3B-UD-MLX-4bit',
      messages, temperature:0.4, max_tokens:2500,
      chat_template_kwargs:{enable_thinking:false}
    }),
    timeout: 90000
  });
  reply = (parsed.choices?.[0]?.message?.content||'').replace(/<think>[\s\S]*?<\/think>/g,'').trim();

  if (reply) {
    await pgClient.query('INSERT INTO chat_history(chat_id,role,content) VALUES($1,$2,$3)',[chatId,'assistant',reply]);
  }

} catch(e) {
  reply = `⚠️ 幽暂时不可用 (${e.message?.slice(0,60)})`;
} finally {
  if (pgClient) try { await pgClient.end(); } catch(e) {}
}

return [{ json: { chatId, reply, fromName, skip: !reply } }];
