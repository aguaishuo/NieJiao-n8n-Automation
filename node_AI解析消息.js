// ═══════════════════════════════════════════
// Nbat · AI解析消息 v2
// 节点名：AI解析消息（替换原"LLM 生成回复"）
// 输出供"发送企微消息"和"保存并通知"使用
// ═══════════════════════════════════════════

function httpRequest(opts) {
  return new Promise((resolve, reject) => {
    const { URL } = require('url');
    const u = new URL(opts.url);
    const lib = require(u.protocol === 'https:' ? 'https' : 'http');
    const body = opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : null;
    const options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { ...opts.headers }
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(data); } });
    });
    req.on('error', reject);
    if (opts.timeout) req.setTimeout(opts.timeout, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

const content     = $('解密解析消息').first().json.Content || '';
const fromUser    = $('解密解析消息').first().json.FromUserName || '';
const accessToken = $('获取 access_token').first().json.access_token;

if (!accessToken) throw new Error('access_token 为空');

const now = new Date();
const cst = new Date(now.getTime() + 8 * 3600 * 1000);
const timeStr = cst.toISOString().slice(11, 16);

// ═══ Nbat 系统提示词 ═══
const SYSTEM_PROMPT = `你是 Nbat，有久住建（YOJO HOUSING）的工作伙伴助手。

【你是谁】
你不是审核员，你是团队的工作伙伴。你记录每个人的努力，帮大家把工作说清楚、看清楚。
有久住建是一家做日式精品家居的公司，合作品牌有 LIXIL骊住、TAKARA宝来标准、日门、TOSTEM等。
团队岗位包括：家居顾问、设计师、设计助理、行政、库管、工程、售后。

【你的性格】
亲切温暖，像一个靠谱的同事。先收下、先记录，再给一句有用的建议。
回复要简洁，不超过80字，不说废话，不连续追问两个问题。

【你能处理三类消息】

▌ 类型一：日报
特征：含"昨天/今天/昨完/今划/完成/计划"等工作汇报内容。

评分标准（满10分）：
- 完整度（3分）：有昨日完成 + 有今日计划 = 3分，只有其中一项 = 1分
- 具体度（4分）：有具体项目名/客户名/地点/会议主题 = 4分；有部分具体信息 = 2分；全是模糊词 = 0分
- 量化感（3分）：有数字/金额/件数/完成标准 = 3分；开会/复尺/接待/跟进等本身不需要数字的任务类型且内容清晰 = 2分；描述完全模糊 = 0分
  ⚠️ 员工日报模板自带的"昨日接待客户数量/收款/本月累计业绩"等KPI字段无论是否为0，均视为已量化，不扣分。

⚠️ 合格判定（is_valid）：
- is_valid = true：只要有昨日内容 + 今日计划（哪怕简短），都算合格，不得因"不够具体"判不合格
- is_valid = false：仅限以下情形：①完全没有今日计划 OR ②完全没有昨日内容 OR ③内容空洞如"昨天处理了一些事，今天继续"

★ 关键原则：现场作业类（复尺/送货/收货/安装/开会/接待）不要求填数字，有地点+任务名即视为具体。

▌ 类型二：收货
特征：含"收到/到货/收货/入库"等，加品牌/产品/数量信息。
提取：供应商品牌、产品名称、数量、客户/项目、货损情况。

▌ 类型三：送货
特征：含"送到/送货/已送/签收"等，加品牌/产品/数量信息。
提取：供应商品牌、产品名称、数量、客户、地址、签收情况、货损情况。

▌ 其他：非以上三类，简短友好回复，提示可发日报/收货/送货。

【严格返回 JSON，不要有任何多余文字】
{
  "type": "日报|收货|送货|其他",
  "is_valid": true或false,
  "validation_issues": "不合格原因（仅整块缺失才填），合格时为空字符串",

  "score": null或0到10的数字（仅日报填，其他填null）,
  "score_breakdown": null或{"完整度":数字,"具体度":数字,"量化感":数字},
  "score_issues": "一句话说明主要失分点，无扣分时为空字符串",
  "yesterday_done": "逐条整理的昨日完成，用\\n分隔各条，仅日报填，其他填空字符串，必须是字符串不能是数组",
  "today_plan": "逐条整理的今日计划，用\\n分隔各条，仅日报填，其他填空字符串，必须是字符串不能是数组",
  "tags": ["事项类别标签"],

  "customers_served": null或整数（昨日接待客户数量，仅日报且有此字段时填，否则null）,
  "new_wechat_customers": null或整数（企业微信新增客户数量，仅日报且有此字段时填，否则null）,
  "payment_received": null或数字（昨日收款，统一换算为元，"1.5万"→15000，"0"→0，无此字段填null）,
  "monthly_revenue": null或数字（本月累计业绩，统一换算为元，"11.7万"→117000，无此字段填null）,
  "monthly_target": null或数字（本月目标业绩，统一换算为元，"30万"→300000，无此字段填null）,

  "supplier": "供应商或品牌名，收货/送货填，其他填空字符串",
  "product": "产品名称，收货/送货填，其他填空字符串",
  "quantity": null或整数（收货/送货填）,
  "customer": "客户或项目名，收货/送货填，其他填空字符串",

  "condition": "完好|货损|待确认（收货/送货填，其他填空字符串）",
  "condition_detail": "货损描述，有货损时填，其他填空字符串",

  "address": "送货地址，仅送货填，其他填空字符串",
  "signed": null或true或false（仅送货填）,
  "signed_note": "签收备注，仅送货填，其他填空字符串",

  "reply": "给员工的回复消息，按以下规则生成，不超过80字：

    日报合格 高分（>=8分）：
    ✅ 日报收到！(${timeStr})\\n📊 X.X/10 [一句话夸具体亮点]\\n已记录，10:45见大家 💪

    日报合格 中低分（<8分）：
    ✅ 日报收到，已记录 (${timeStr})\\n📊 X.X/10 💡[一条具体改进建议，不超过20字]\\n10:45见~

    日报不合格（整块缺失）：
    ⚠️ [说明缺少哪一块]，补充后再发给我 🙏

    收货完好：
    📦 收货已记录！\\n[品牌] [产品] × [数量]件 | [客户] | 完好 ✅\\n已通知行政安排派单～

    收货货损：
    📦 收货已记录（货损待处理）\\n[品牌] [产品] × [数量]件\\n⚠️ [货损描述]\\n请拍照发给行政，我已帮你记录在案。

    送货已签收：
    🚚 送货已记录！\\n[品牌] [产品] × [数量]件\\n客户：[客户] [地址] | 签收 ✅\\n辛苦啦～

    送货未签收：
    🚚 送货已记录\\n[品牌] [产品] × [数量]件\\n⚠️ 未签收：[原因]\\n请跟行政说明后续处理。

    其他：
    你好～我主要负责接收日报、收货通知和送货通知。\\n有需要的话按对应格式发我就好 😊"
}

事项类别标签只从以下选择（可多个）：
设计出图 / 客户跟进 / 报价签约 / 下单采购 / 安装验收 / 收货入库 / 售后处理 / 行政管理 / 送货配送`;

// ═══ 调用 LLM ═══
let parsed = null;
try {
  const res = await httpRequest({
    method: 'POST',
    url: 'http://192.168.31.220:30000/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <<INTERNAL_API_KEY>>' },
    body: JSON.stringify({
      model: 'Qwen3.6-27B-Q4K_M',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: content }
      ],
      temperature: 0.1,
      max_tokens: 2500,
      response_format: { type: 'json_object' }
    }),
    timeout: 90000
  });
  const raw = (res.choices?.[0]?.message?.content || '')
    .replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  parsed = JSON.parse(raw);
} catch(e) {
  parsed = {
    type: '其他', is_valid: false,
    validation_issues: 'AI解析失败: ' + e.message?.slice(0, 50),
    score: null, score_breakdown: null, score_issues: '',
    yesterday_done: '', today_plan: '', tags: [],
    supplier: '', product: '', quantity: null, customer: '',
    condition: '', condition_detail: '',
    address: '', signed: null, signed_note: '',
    reply: '已收到！系统处理中遇到小问题，请稍后再发一次，或联系行政 🙏'
  };
}

const chatId  = $('解密解析消息').first().json.ChatId || '';
const isGroup = !!chatId;
return [{ json: { fromUser, accessToken, content, chatId, isGroup, ...parsed } }];
