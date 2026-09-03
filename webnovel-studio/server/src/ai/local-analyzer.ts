/**
 * 本地规则诊断器：未配置大模型 API 时使用。
 * 它不假装懂内容，只做可量化的文本体检 + 按模块的维度打分，
 * 保证用户在不联网、不花钱的情况下也能拿到可用的反馈。
 */

export interface DimensionResult {
  name: string;
  score: number;
  comment: string;
}

export interface AnalysisResult {
  score: number;
  verdict: string;
  dimensions: DimensionResult[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  rewrite: string;
  source: 'local' | 'ai';
  stats: Record<string, number>;
}

const CLICHE = [
  '只见',
  '顿时',
  '瞬间',
  '猛地',
  '不由得',
  '无非',
  '一股',
  '莫名的',
  '深深的',
  '缓缓',
  '微微',
  '嘴角勾起',
  '眼神一凛',
  '心中一凛',
  '倒吸一口凉气',
  '宛如',
  '仿佛整个世界',
];

const SENSE_WORDS = [
  '闻',
  '嗅',
  '味道',
  '气味',
  '腥',
  '香',
  '酸',
  '苦',
  '甜',
  '凉',
  '烫',
  '冷',
  '热',
  '疼',
  '痛',
  '麻',
  '痒',
  '湿',
  '黏',
  '粗糙',
  '光滑',
  '刺耳',
  '沙哑',
  '嗡',
  '寂静',
];

const CAUSE_WORDS = ['因为', '所以', '但是', '然而', '却', '于是', '因此', '不过', '尽管如此'];
const PRESS_WORDS = ['嘲笑', '讥讽', '讽刺', '欺', '辱', '踩', '看不起', '废物', '滚', '不配', '蔑视', '冷笑'];
const RELEASE_WORDS = ['震惊', '鸦雀无声', '目瞪口呆', '全场', '哗然', '倒吸', '不可思议', '愣住', '呆住'];
const DESIRE_WORDS = ['想要', '必须', '一定要', '非要', '渴望', '我要', '他想', '她想'];
const FEAR_WORDS = ['怕', '不敢', '害怕', '恐惧', '宁愿', '万一', '担心'];
const RULE_WORDS = ['不得', '禁止', '规矩', '规则', '代价', '必须', '违者', '铁律', '否则'];
const TIME_PRESSURE = ['三天', '三日后', '明日', '天亮之前', '倒计时', '来不及', '只剩', '最后一天'];
const QUESTION_MARK = ['？', '?'];

function countOf(text: string, list: string[]): number {
  let n = 0;
  for (const w of list) {
    const parts = text.split(w);
    n += parts.length - 1;
  }
  return n;
}

export function analyzeTextStats(text: string) {
  const clean = (text || '').trim();
  const cjk = (clean.match(/[\u4e00-\u9fa5]/g) || []).length;
  const enWords = (clean.match(/[A-Za-z]+/g) || []).length;
  const wordCount = cjk + enWords;

  const paragraphs = clean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const rawSentences = clean
    .split(/[。！？!?；;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const sentenceCount = Math.max(rawSentences.length, 1);
  const avgSentenceLen = Math.round(wordCount / sentenceCount);

  const longestSentence = rawSentences.reduce(
    (a, b) => (b.length > a.length ? b : a),
    '',
  );

  const quoteMatches = clean.match(/["“「『][^"”」』]{2,}["”」』]/g) || [];
  const dialogueChars = quoteMatches.join('').length;
  const dialogueRatio = wordCount ? dialogueChars / wordCount : 0;

  const chars = clean.replace(/\s/g, '');
  const uniqueRatio = chars.length ? new Set(chars).size / chars.length : 0;

  const clicheHits = countOf(clean, CLICHE);
  const senseHits = countOf(clean, SENSE_WORDS);
  const causeHits = countOf(clean, CAUSE_WORDS);
  const pressHits = countOf(clean, PRESS_WORDS);
  const releaseHits = countOf(clean, RELEASE_WORDS);
  const desireHits = countOf(clean, DESIRE_WORDS);
  const fearHits = countOf(clean, FEAR_WORDS);
  const ruleHits = countOf(clean, RULE_WORDS);
  const timeHits = countOf(clean, TIME_PRESSURE);
  const numberHits = (clean.match(/\d+/g) || []).length;

  const lastSentence = rawSentences[rawSentences.length - 1] || '';
  const endWithHook =
    lastSentence.length > 0 &&
    (QUESTION_MARK.some((q) => lastSentence.includes(q)) ||
      lastSentence.endsWith('——') ||
      lastSentence.endsWith('…') ||
      lastSentence.endsWith('...'));

  return {
    wordCount,
    paragraphCount: paragraphs.length,
    sentenceCount,
    avgSentenceLen,
    longestSentence,
    dialogueRatio: Math.round(dialogueRatio * 100),
    uniqueRatio: Math.round(uniqueRatio * 100),
    clicheHits,
    senseHits,
    causeHits,
    pressHits,
    releaseHits,
    desireHits,
    fearHits,
    ruleHits,
    timeHits,
    numberHits,
    endWithHook: endWithHook ? 1 : 0,
  };
}

const MODULE_DIMENSION_TIPS: Record<string, Record<string, string>> = {
  inspiration: {
    概念新鲜度: '看核心概念是否一句话说清、有没有辨识度',
    情感钩子: '看它是否指向一种具体的、读者熟悉的委屈',
    立意深度: '看它是可遭遇的处境，还是可讨论的抽象命题',
    可执行性: '看它是否已经落到人物与行动上',
  },
  world: {
    规则自洽: '看规则是否成体系、有没有代价设计',
    独特性: '看稀缺资源是否真的稀缺、是否与他人撞车',
    可延展性: '看是否留下了没填的空白以备后续开发',
    与人物绑定: '看规则是否真的压在了主角身上',
  },
  character: {
    动机可信: '看欲望与恐惧是否都被写出来了',
    辨识度: '看是否有行为或语言上的识别点',
    关系张力: '看是否写出了互相为难的关系结构',
    弧线完整性: '看改变是否有代价，而不是突然想通',
  },
  plot: {
    因果咬合: '看"所以／但是"这类因果连接词是否密集',
    转折力度: '看转折是否带代价、是否可回溯',
    结构均衡: '看篇幅分配与节点密度',
    伏笔回收: '看是否交代了回收方案',
  },
  climax: {
    压制强度: '看压制是否具体、有观众、伤到要害',
    释放痛快度: '看释放强度是否超过压制，有没有人看见',
    节奏配给: '看是否只有一次大释放而缺少铺垫层次',
    余味回甘: '看结尾是否留下代价、反差或回望',
  },
  scene: {
    感官密度: '看视觉之外的感官是否被调用',
    信息取舍: '看是否存在大量不影响情节的细节',
    镜头调度: '看描写是否有运动（推、拉、切）',
    氛围统一: '看细节选择是否指向同一种情绪',
  },
  dialogue: {
    声口区分: '看不同说话人是否有各自的句式与词汇',
    潜台词: '看是否存在答非所问与留白',
    信息推进: '看对话是否推动了剧情或揭示了人物',
    语言质感: '看套话与副词的使用密度',
  },
  pacing: {
    信息投放: '看是否给一点、吊一下、再给一点',
    张力曲线: '看段落与句长是否形成起伏',
    钩子密度: '看是否设置了时间压力或未答的提问',
    结尾牵引: '看结尾是否停在悬念上',
  },
  practice: {
    立意清晰: '看立意与梗概是否指向同一件事',
    结构完整: '看是否覆盖目标、阻力、位移、钩子',
    人物立住: '看人物欲望是否进入剧情',
    可执行性: '看下一步是否清楚到能直接动笔',
  },
  genre: {
    赛道匹配度: '看是否明确了男频/女频与具体大类',
    市场空白点: '看是否写出了"同中有异"的具体异色',
    读者画像: '看目标读者是否具体可操作，而非"所有人"',
    可持续性: '看是否评估了能否写满三十万字',
  },
  goldfinger: {
    爽感机制: '看是否制造了"别人没有、主角独享"的不对称',
    独特性: '看金手指是否有独特调性，而非套路作弊码',
    成长性: '看是否有清晰的升级台阶与天花板',
    制约性: '看是否有代价与上限，而非无限叠buff',
  },
  outline: {
    主线清晰度: '看一句话梗概是否含"要什么+谁挡着"',
    节点密度: '看是否标出了关键高潮节点',
    伏笔预留: '看是否在大纲阶段预埋了线索',
    可写性: '看是否落到了可动笔的细纲',
  },
  foreshadow: {
    铺垫自然度: '看伏笔当下是否服务场景，而非刻意暗示',
    回收确定性: '看回收时是否有迹可循、能拼上',
    分布均匀度: '看伏笔是否均匀，而非全挤在开头',
    信息层级: '看短中长三层伏笔是否错落',
  },
  conflict: {
    矛盾强度: '看冲突是否具体有压迫，而非泛泛而谈',
    升级梯度: '看压力是否层层加码、代价递增',
    来源多样性: '看是否混用了人/环境/自我三类冲突',
    代价真实度: '看主角失败是否真会失去重要的东西',
  },
  immersion: {
    代入视角: '看视角是否稳定限知，未乱跳上帝视角',
    情感共鸣: '看是否写感受而非旁白评价',
    选择代入: '看主角选择是否体现性格而非剧情需要',
    痛感真实度: '看痛苦与代价是否具体可感',
  },
  opening: {
    开篇钩子: '看第一章是否抛出不可解释的异常',
    代入速度: '看前三章是否立住主角身份与目标',
    信息投放: '看设定是否用情节带着出场',
    首爽兑现: '看第三章是否兑现了一次小爽',
  },
  packaging: {
    书名辨识度: '看书名是否可解码类型与爽点',
    简介转化力: '看前三行是否给出主角+困境+爽点',
    标签精准度: '看标签是否精准覆盖目标读者',
    噱头诚实度: '看噱头是否兑现得起，非虚假承诺',
  },
  'market-sense': {
    数据理解: '看是否分清追读率/留存/推荐位各自含义',
    毒点规避: '看是否识别并排雷了常见弃书写法',
    更新运营: '看是否建立了稳定更新与存稿机制',
    读者运营: '看是否区分了该听与不该盲从的反馈',
  },
};

function clamp(n: number, min = 40, max = 96) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function analyzeLocally(
  text: string,
  moduleId: string,
  dimensions: string[],
  minWords: number,
  title?: string,
): AnalysisResult {
  const s = analyzeTextStats(text);
  const dims: DimensionResult[] = [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const suggestions: string[] = [];

  // ---- 整体基线 ----
  let base = 58;
  if (s.wordCount >= minWords) base += 9;
  else if (s.wordCount >= minWords * 0.6) base += 3;
  else base -= 8;

  if (s.paragraphCount >= 3) base += 4;
  if (s.avgSentenceLen >= 10 && s.avgSentenceLen <= 30) base += 5;
  else if (s.avgSentenceLen > 45) base -= 5;
  if (s.dialogueRatio >= 10 && s.dialogueRatio <= 50) base += 4;
  if (s.uniqueRatio >= 32) base += 5;
  else if (s.uniqueRatio < 22) base -= 5;
  base -= Math.min(12, s.clicheHits * 2);
  if (s.endWithHook) base += 4;
  if (s.numberHits >= 2) base += 3;

  // ---- 模块专项 ----
  const dimNotes: Record<string, number> = {};
  const bump = (name: string, delta: number) => {
    dimNotes[name] = (dimNotes[name] || 0) + delta;
  };

  switch (moduleId) {
    case 'inspiration':
      if (s.desireHits >= 2) {
        bump('可执行性', 8);
        bump('情感钩子', 4);
      }
      if (s.wordCount >= 300 && s.paragraphCount >= 3) bump('概念新鲜度', 6);
      if (s.uniqueRatio >= 35) bump('概念新鲜度', 5);
      break;
    case 'world':
      if (s.ruleHits >= 3) bump('规则自洽', 10);
      else weaknesses.push('几乎没有出现规则性表述（不得／代价／铁律），世界像是没有牙齿的。');
      if (s.desireHits + s.fearHits >= 2) bump('与人物绑定', 8);
      else weaknesses.push('设定与人物的绑定偏弱：看不出这套规则压在谁身上。');
      break;
    case 'character':
      if (s.desireHits >= 2) bump('动机可信', 9);
      else weaknesses.push('欲望写得不够明确，读者不知道他到底要什么。');
      if (s.fearHits >= 2) bump('动机可信', 6);
      else weaknesses.push('缺少恐惧描写，人物没有底线，抉择就没分量。');
      if (s.dialogueRatio >= 20) bump('辨识度', 7);
      bump('关系张力', s.paragraphCount >= 4 ? 5 : -3);
      break;
    case 'plot':
      if (s.causeHits >= 5) bump('因果咬合', 10);
      else if (s.causeHits <= 1)
        weaknesses.push('因果连接词（所以／但是／然而）极少，容易读成流水账。');
      bump('转折力度', s.paragraphCount >= 4 ? 6 : 0);
      bump('结构均衡', s.wordCount >= minWords ? 6 : 0);
      break;
    case 'climax':
      if (s.pressHits >= 3) bump('压制强度', 11);
      else weaknesses.push('压制段落偏弱：没有具体的羞辱、没有观众，读者不会替主角憋屈。');
      if (s.releaseHits >= 2) bump('释放痛快度', 10);
      else weaknesses.push('缺少"有人看见"的反应描写，爽度至少减半。');
      if (s.pressHits > 0 && s.releaseHits > 0) bump('节奏配给', 7);
      bump('余味回甘', s.endWithHook ? 5 : -3);
      break;
    case 'scene':
      if (s.senseHits >= 4) bump('感官密度', 11);
      else weaknesses.push('感官几乎只有视觉，缺少气味、触感、声音，画面立不起来。');
      if (s.avgSentenceLen <= 22) bump('镜头调度', 7);
      else weaknesses.push(`平均句长 ${s.avgSentenceLen} 字，偏长，镜头跑不动。`);
      if (s.clicheHits <= 1) bump('信息取舍', 6);
      break;
    case 'dialogue':
      if (s.dialogueRatio >= 30) bump('声口区分', 9);
      else weaknesses.push(`对话占比仅 ${s.dialogueRatio}%，这一模块建议以对话为主体。`);
      bump('语言质感', s.clicheHits <= 1 ? 8 : -6);
      bump('潜台词', s.paragraphCount >= 4 ? 5 : 0);
      break;
    case 'pacing':
      if (s.timeHits >= 1) bump('钩子密度', 9);
      else weaknesses.push('没有时间压力（三天后／天亮之前／来不及），读者的紧迫感起不来。');
      if (s.endWithHook) bump('结尾牵引', 10);
      else weaknesses.push('结尾没有停在悬念上，读者没有翻下一章的理由。');
      bump('张力曲线', s.paragraphCount >= 4 ? 6 : -2);
      break;
    case 'practice':
      if (s.wordCount >= minWords) bump('结构完整', 8);
      if (s.desireHits >= 2) bump('人物立住', 7);
      if (s.causeHits >= 4) bump('结构完整', 6);
      bump('可执行性', s.paragraphCount >= 5 ? 6 : 0);
      break;
    case 'genre':
      if (s.uniqueRatio >= 30) bump('市场空白点', 8);
      if (s.paragraphCount >= 4) bump('赛道匹配度', 6);
      else weaknesses.push('赛道与定位的论证偏弱，看不出你究竟进了哪条赛道、为什么。');
      if (s.wordCount >= minWords) bump('可持续性', 6);
      break;
    case 'goldfinger':
      if (s.desireHits >= 2) bump('爽感机制', 9);
      else weaknesses.push('缺少"想要/必须"等目标驱动表述，金手指的动机抓手偏弱。');
      if (s.ruleHits >= 2) bump('制约性', 8);
      else weaknesses.push('几乎没有规则/代价/上限的表述，金手指像无制约的作弊码。');
      if (s.uniqueRatio >= 32) bump('独特性', 6);
      break;
    case 'outline':
      if (s.causeHits >= 4) bump('主线清晰度', 8);
      if (s.paragraphCount >= 5) bump('节点密度', 7);
      if (s.wordCount >= minWords) bump('可写性', 6);
      break;
    case 'foreshadow':
      if (s.paragraphCount >= 4) bump('分布均匀度', 6);
      if (s.uniqueRatio >= 32) bump('铺垫自然度', 6);
      break;
    case 'conflict':
      if (s.pressHits >= 2) bump('矛盾强度', 10);
      else weaknesses.push('冲突压迫偏弱，缺少具体的阻碍或羞辱，张力起不来。');
      if (s.desireHits + s.fearHits >= 2) bump('代价真实度', 8);
      if (s.causeHits >= 4) bump('升级梯度', 6);
      break;
    case 'immersion':
      if (s.dialogueRatio >= 20) bump('情感共鸣', 8);
      if (s.senseHits >= 3) bump('痛感真实度', 7);
      if (s.desireHits + s.fearHits >= 2) bump('选择代入', 8);
      break;
    case 'opening':
      if (s.endWithHook) bump('开篇钩子', 9);
      else weaknesses.push('结尾没有停在悬念上，读者没有翻下一章的理由。');
      if (s.timeHits >= 1) bump('信息投放', 7);
      if (s.numberHits >= 2) bump('首爽兑现', 6);
      break;
    case 'packaging':
      if (s.paragraphCount >= 3) bump('简介转化力', 6);
      if (s.uniqueRatio >= 32) bump('书名辨识度', 7);
      if (s.wordCount >= minWords) bump('噱头诚实度', 5);
      break;
    case 'market-sense':
      if (s.paragraphCount >= 4) bump('数据理解', 6);
      if (s.clicheHits <= 2) bump('毒点规避', 6);
      if (s.wordCount >= minWords) bump('更新运营', 6);
      break;
    default:
      break;
  }

  // ---- 组装维度分 ----
  for (const name of dimensions) {
    const tip = MODULE_DIMENSION_TIPS[moduleId]?.[name] || '';
    const delta = dimNotes[name] || 0;
    const score = clamp(base + delta + (delta === 0 ? -2 : 0));
    dims.push({
      name,
      score,
      comment: tip ? `${tip}。当前这一项${score >= 80 ? '表现不错' : score >= 65 ? '基本到位，仍有提升空间' : '明显偏弱'}。` : '',
    });
  }

  // ---- 优点 ----
  if (s.wordCount >= minWords)
    strengths.push(`字数 ${s.wordCount}，达到了本练习 ${minWords} 字的基本要求。`);
  if (s.paragraphCount >= 4)
    strengths.push(`分了 ${s.paragraphCount} 个段落，结构上有呼吸，不是一大坨。`);
  if (s.uniqueRatio >= 32)
    strengths.push(`用字多样性约 ${s.uniqueRatio}%，词汇不算贫乏。`);
  if (s.clicheHits === 0)
    strengths.push('没有出现"只见／顿时／猛地"这类高频套话，语言比较干净。');
  else if (s.clicheHits <= 2)
    strengths.push(`套话仅 ${s.clicheHits} 处，整体还算克制。`);
  if (s.dialogueRatio >= 25 && (moduleId === 'dialogue' || moduleId === 'character'))
    strengths.push(`对话占比 ${s.dialogueRatio}%，人物有在开口说话而不是被旁白概括。`);
  if (s.endWithHook) strengths.push('结尾停在悬念上，有牵引力。');
  if (s.numberHits >= 2) strengths.push('出现了具体数字，细节是有刻度的，不是空说。');
  if (strengths.length === 0) strengths.push('完成了成稿，这本身就比停留在想法阶段强。');

  // ---- 短板 ----
  if (s.wordCount < minWords)
    weaknesses.push(`字数 ${s.wordCount}，未达到要求的 ${minWords} 字，很多要求还没展开。`);
  if (s.paragraphCount <= 2) weaknesses.push('段落过少，读者眼睛会很累，也不利于节奏。');
  if (s.avgSentenceLen > 40)
    weaknesses.push(`平均句长 ${s.avgSentenceLen} 字，句子太长，读起来喘不上气。`);
  if (s.clicheHits >= 3)
    weaknesses.push(`出现 ${s.clicheHits} 处高频套话（如"只见／顿时／猛地"），会让文字显得套路。`);
  if (s.uniqueRatio < 24) weaknesses.push('用词重复度高，同一批词在反复出现。');
  if (s.dialogueRatio === 0 && ['dialogue', 'character', 'climax'].includes(moduleId))
    weaknesses.push('通篇没有对话，人物没有开口，性格很难立住。');
  if (weaknesses.length === 0) weaknesses.push('从可量化的指标上看没有硬伤，接下来要靠真人的眼睛来判断。');

  // ---- 建议 ----
  suggestions.push(
    s.wordCount < minWords
      ? `先把篇幅补到 ${minWords} 字以上：优先补"具体的事例"，而不是补形容词。`
      : '篇幅达标，下一步把力气花在删减上：删掉所有删了不影响理解的句子。',
  );
  if (s.clicheHits >= 2)
    suggestions.push(`把 ${s.clicheHits} 处套话逐个替换成具体动作或具体感受，替换不掉的直接删。`);
  if (s.avgSentenceLen > 30)
    suggestions.push('把最长的三个句子各拆成两句，节奏会立刻变利落。');
  if (!s.endWithHook)
    suggestions.push('给结尾加一钩：一个未回答的提问、一个倒计时，或者一句冰冷的转折。');
  suggestions.push(
    `对照本模块四条达标标准自查一遍：${dimensions.join('、')}，逐条给自己打勾。`,
  );

  // ---- 改写示范 ----
  let rewrite =
    '本地诊断模式不生成改写全文，只给方向。配置大模型 API 后，这里会给出逐段改写示范。';
  if (s.longestSentence.length >= 30) {
    rewrite =
      `【本地改写建议】你最长的一句是 ${s.longestSentence.length} 字：\n` +
      `「${s.longestSentence.slice(0, 60)}${s.longestSentence.length > 60 ? '……' : ''}」\n\n` +
      '建议拆成两到三句，并把其中的抽象形容换成一个具体动作。例如把"他感到一阵难以言喻的愤怒"改成' +
      '"他把杯子放下，杯底磕在桌面上，响了一声"。先写动作，让读者自己读出情绪。';
  } else if (s.clicheHits > 0) {
    rewrite =
      '【本地改写建议】优先替换套话。示例：把"他顿时倒吸一口凉气"改成在场另一个人的具体反应——' +
      '"旁边那人手里的笔掉了，滚到他脚边，没人去捡"。用旁人的动作写震惊，比写主角的生理反应更有画面。';
  }

  const score = clamp(
    dims.length ? dims.reduce((a, b) => a + b.score, 0) / dims.length : base,
  );

  const verdict =
    score >= 85
      ? '这一稿底子不错，主要问题在细节打磨，可以进入下一环节。'
      : score >= 70
        ? '骨架立住了，但有几处明显短板，照着下面的建议改一轮会明显提升。'
        : score >= 55
          ? '方向对，但还停留在概述层面：缺具体的事例、具体的人、具体的代价。'
          : '这一稿还太薄，建议先回到本模块的教程，把对应的一课重读一遍再动笔。';

  return {
    score,
    verdict,
    dimensions: dims,
    strengths,
    weaknesses,
    suggestions,
    rewrite,
    source: 'local',
    stats: {
      字数: s.wordCount,
      段落数: s.paragraphCount,
      平均句长: s.avgSentenceLen,
      对话占比: s.dialogueRatio,
      用词多样性: s.uniqueRatio,
      套话处数: s.clicheHits,
      感官词: s.senseHits,
      因果连接词: s.causeHits,
    },
  };
}
