/* public/js/app.js  (ESM)  Final-2025 – 适配新 prompt 正则 */
const $ = s => document.querySelector(s);
const url = '/api/analyze';

let radarChart;
let isAnalyzing = false;
const COOL_DOWN = 1200;
const ui = {
  input: $('#urlInput'),
  btn: $('#analyzeBtn'),
  progress: $('#progress'),
  summary: $('#summary'),
  fourDim: $('#fourDim'),
  results: $('#results'),
  fact: $('#factList'),
  opinion: $('#opinionList'),
  bias: $('#biasList'),
  pub: $('#pubAdvice'),
  pr: $('#prAdvice'),
  radarEl: $('#radar'),
  radarTgl: $('#radarToggle')
};

/* ===== 逻辑谬误模式定义 ===== */
const logicalFallacyPatterns = [
  { type: 'slippery slope', regex: /\b(will lead to|inevitably lead|eventually result in)\b/gi },
  { type: 'ad hominem', regex: /\b(idiot|liar|fool|stupid|moron)\b/gi },
  { type: 'false dilemma', regex: /\b(either.*or|only two options|black and white)\b/gi }
];

/* ===== 浏览器 LRU 48h ===== */
const LRU = new Map();
const LRU_TTL = 48 * 3600 * 1000;
async function hash(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function getCache(content, title) {
  const key = await hash(content + title);
  const hit = LRU.get(key);
  if (hit && Date.now() - hit.ts < LRU_TTL) return hit.report;
  return null;
}
async function setCache(content, title, report) {
  const key = await hash(content + title);
  LRU.set(key, { ts: Date.now(), report });
  if (LRU.size > 2000) LRU.delete(LRU.keys().next().value);
}

/* ===== 情感词典 ===== */
let enEmoDict = {};
let enEmoDictLoaded = false;
async function loadEmotionDict() {
  try {
    const res = await fetch('/dict/en-emotionDict.json');
    const data = await res.json();
    enEmoDict = data.reduce((o, i) => (o[i.word.toLowerCase()] = { intensity: i.intensity, polarity: i.polarity }, o), {});
    enEmoDictLoaded = true;
  } catch (e) {
    console.warn('词典加载失败', e);
    enEmoDictLoaded = false;
  }
}
loadEmotionDict();

/* ===== 解析主函数 ===== */
function parseResult(text) {
  try {
    const parsed = {
      credibility: 0,
      facts: [],
      opinions: [],
      bias: [],
      publisherAdvice: '',
      prReply: '',
      summary: '',
      dimensions: { ts: 0, fd: 0, eb: 0, cs: 0 }
    };

    /* 1.  credibility */
    const credMatch = text.match(/Credibility:\s*(\d+(?:\.\d+)?)\/10/i);
    if (credMatch) parsed.credibility = parseFloat(credMatch[1]);

    /* 2.  facts */
    const factMatches = text.match(/(\d+)\.\s*conf:\s*(\d+(?:\.\d+)?)\s*<fact>(.*?)<\/fact>/gis);
    if (factMatches) {
      parsed.facts = factMatches.map(m => {
        const [, , confStr, content] = m.match(/(\d+)\.\s*conf:\s*(\d+(?:\.\d+)?)\s*<fact>(.*?)<\/fact>/is);
        return { content: content.trim(), confidence: parseFloat(confStr) };
      });
    }

    /* 3.  opinions */
    const opinionMatches = text.match(/(\d+)\.\s*conf:\s*(\d+(?:\.\d+)?)\s*<opinion>(.*?)<\/opinion>/gis);
    if (opinionMatches) {
      parsed.opinions = opinionMatches.map(m => {
        const [, , confStr, content] = m.match(/(\d+)\.\s*conf:\s*(\d+(?:\.\d+)?)\s*<opinion>(.*?)<\/opinion>/is);
        return { content: content.trim(), confidence: parseFloat(confStr) };
      });
    }

    /* 4.  bias 块 */
    const biasMatch = text.match(/Bias:([\s\S]*?)(?:Pub:|$)/);
    if (biasMatch) parsed.bias = [biasMatch[1].replace(/\s+/g, ' ').trim()];

    /* 5.  summary */
    const sumMatch = text.match(/Sum:(.*?)(?:\n|$)/i);
    parsed.summary = sumMatch ? sumMatch[1].trim() : 'Analysis completed.';

    /* 6.  四维度 */
    parsed.dimensions = calculateFourDimensions(text);
    return parsed;
  } catch (e) {
    console.error('解析失败', e);
    return fallbackParse(text);
  }
}

/* ===== 降级解析 ===== */
function fallbackParse(text) {
  const extracted = extractFactsAndOpinions(text);
  const bias = detectBiasWithRules(text);
  return {
    credibility: 5,
    facts: extracted.facts,
    opinions: extracted.opinions,
    bias: [`Emotional words: ${bias.emotionalWords}`, `Binary opposition: ${bias.binaryOpposition}`, `Mind-reading: ${bias.mindReading}`, `Logical fallacy: ${bias.logicalFallacy}`, `Overall stance: ${bias.overallStance}`],
    publisherAdvice: 'No advice provided',
    prReply: 'No reply provided',
    summary: 'Analysis completed.',
    dimensions: calculateFourDimensions(text)
  };
}

/* ===== 事实/观点抽取 ===== */
function extractFactsAndOpinions(content) {
  const facts = [], opinions = [];
  const sentences = content.split(/[.!?]+/).filter(s => s.trim());
  const factKeys = ['according to', 'studies show', 'research indicates', 'data shows', 'is', 'are', 'was', 'were', 'has', 'have'];
  const opinionKeys = ['think', 'believe', 'feel', 'opinion', 'view', 'should', 'must', 'probably', 'likely', 'in my opinion'];
  sentences.forEach(s => {
    const low = s.toLowerCase();
    if (factKeys.some(k => low.includes(k)) && !opinionKeys.some(k => low.includes(k))) {
      facts.push({ content: s.trim(), confidence: 0.7 });
    } else if (opinionKeys.some(k => low.includes(k))) {
      opinions.push({ content: s.trim(), confidence: 0.6 });
    } else {
      (low.match(/\d+/) ? facts : opinions).push({ content: s.trim(), confidence: 0.5 });
    }
  });
  return { facts, opinions };
}

/* ===== 偏见检测 ===== */
function detectBiasWithRules(content) {
  if (!enEmoDictLoaded) {
    return { emotionalWords: 0, binaryOpposition: 0, mindReading: 0, logicalFallacy: 0, overallStance: 'neutral' };
  }
  
  const sentences = content.split(/[.!?]+/).filter(s => s.trim());
  let emotionalWords = 0, binaryOpp = 0, mindRead = 0, logicalFall = 0;
  const words = content.toLowerCase().match(/\b[\w']+\b/g) || [];
  words.forEach(w => { if (enEmoDict[w]) emotionalWords++; });

  const { positiveWords, negativeWords } = findOppositionPairs();
  sentences.forEach(s => {
    const l = s.toLowerCase();
    if (positiveWords.some(pw => l.includes(pw)) && negativeWords.some(nw => l.includes(nw))) binaryOpp++;
    if (/\b(they|he|she|government|people)\s+(think|believe|feel|assume)\b/i.test(s)) mindRead++;
    logicalFallacyPatterns.forEach(p => { if (p.regex.test(s)) logicalFall++; });
  });

  let stance = 'neutral';
  const pos = words.filter(w => enEmoDict[w]?.polarity === 'positive').length;
  const neg = words.filter(w => enEmoDict[w]?.polarity === 'negative').length;
  const total = pos + neg;
  if (total > 0) {
    const ratio = Math.abs(pos - neg) / total;
    stance = ratio < 0.1 ? 'neutral' : (pos > neg ? `leaning positive ${Math.round((pos / total) * 100)}%` : `leaning negative ${Math.round((neg / total) * 100)}%`);
  }
  return { emotionalWords, binaryOpposition: binaryOpp, mindReading: mindRead, logicalFallacy: logicalFall, overallStance: stance };
}

function findOppositionPairs() {
  if (!enEmoDictLoaded) {
    return { positiveWords: [], negativeWords: [] };
  }
  const positiveWords = Object.keys(enEmoDict).filter(w => enEmoDict[w].polarity === 'positive');
  const negativeWords = Object.keys(enEmoDict).filter(w => enEmoDict[w].polarity === 'negative');
  return { positiveWords, negativeWords };
}

/* ===== 四维度计算 ===== */
function calculateFourDimensions(content) {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim());
  const words = content.toLowerCase().match(/\b[\w']+\b/g) || [];
  const dims = { ts: 5, fd: 5, eb: 5, cs: 5 };

  if (!enEmoDictLoaded || !words.length) return dims;

  const emotWords = words.filter(w => enEmoDict[w]);
  if (emotWords.length) {
    const avgInt = emotWords.reduce((s, w) => s + enEmoDict[w].intensity, 0) / emotWords.length;
    dims.ts = Math.max(1, 10 - avgInt);
  } else dims.ts = 8;

  const factualRatio = (words.length - emotWords.length) / words.length;
  dims.fd = factualRatio * 10;

  const pos = words.filter(w => enEmoDict[w]?.polarity === 'positive').length;
  const neg = words.filter(w => enEmoDict[w]?.polarity === 'negative').length;
  const total = pos + neg;
  if (total) {
    const balance = 1 - Math.abs(pos - neg) / total;
    dims.eb = balance * 10;
  } else dims.eb = 10;

  if (sentences.length > 1) {
    const sentScores = sentences.map(s => {
      const w = s.toLowerCase().match(/\b[\w']+\b/g) || [];
      const p = w.filter(x => enEmoDict[x]?.polarity === 'positive').length;
      const n = w.filter(x => enEmoDict[x]?.polarity === 'negative').length;
      const t = p + n;
      return t ? (p - n) / t : 0;
    });
    const avg = sentScores.reduce((a, b) => a + b, 0) / sentScores.length;
    const variance = sentScores.reduce((s, x) => s + Math.pow(x - avg, 2), 0) / sentScores.length;
    dims.cs = Math.max(1, 10 - variance * 50);
  }
  return dims;
}

/* ===== 雷达图 ===== */
function createRadarChart(dimensions) {
  if (!ui.radarEl) return;
  if (radarChart) radarChart.destroy();
  radarChart = new Chart(ui.radarEl, {
    type: 'radar',
    data: {
      labels: ['Source Credibility', 'Fact Density', 'Emotional Balance', 'Consistency'],
      datasets: [{
        label: 'Analysis Score',
        data: [dimensions.ts, dimensions.fd, dimensions.eb, dimensions.cs],
        backgroundColor: 'rgba(37, 99, 235, 0.2)',
        borderColor: 'rgba(37, 99, 235, 1)',
        pointBackgroundColor: 'rgba(37, 99, 235, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(37, 99, 235, 1)'
      }]
    },
    options: {
      scales: { r: { beginAtZero: true, max: 10, ticks: { stepSize: 2 } } },
      plugins: { legend: { display: true, position: 'top' } }
    }
  });
}

/* ===== 渲染 ===== */
function render(report) {
  try {
    if (ui.summary) { ui.summary.textContent = report.summary; ui.summary.classList.remove('hidden'); }
    if (ui.fourDim) {
      ui.fourDim.classList.remove('hidden');
      ['ts', 'fd', 'eb', 'cs'].forEach(d => {
        const val = report.dimensions[d];
        document.getElementById(d + 'Val').textContent = val.toFixed(1);
        document.getElementById(d + 'Bar').style.width = `${Math.min(100, val * 10)}%`;
      });
      createRadarChart(report.dimensions);
    }
    const lists = ['fact', 'opinion', 'bias'];
    lists.forEach(type => {
      const ul = ui[type];
      if (!ul) return;
      ul.innerHTML = '';
      const items = report[type + 's'] || [];
      if (!items.length) ul.innerHTML = `<li>No ${type} detected</li>`;
      items.forEach(it => {
        const li = document.createElement('li');
        li.innerHTML = `${it.content} <span style="color:#6b7280;font-size:0.8em;">(conf:${(it.confidence * 100).toFixed(0)}%)</span>`;
        const cls = it.confidence >= 0.8 ? 'conf-high' : it.confidence >= 0.5 ? 'conf-mid' : 'conf-low';
        li.classList.add(cls);
        ul.appendChild(li);
      });
    });
    if (ui.pub) ui.pub.textContent = report.publisherAdvice || 'No advice provided';
    if (ui.pr) ui.pr.textContent = report.prReply || 'No reply provided';
    if (ui.results) ui.results.classList.remove('hidden');
  } catch (e) {
    console.error('渲染失败', e);
    alert('Rendering error: ' + e.message);
  }
}

/* ===== 进度条 ===== */
function showProgress() {
  ui.progress.classList.remove('hidden');
  ui.summary.classList.add('hidden');
  ui.fourDim.classList.add('hidden');
  ui.results.classList.add('hidden');
  document.getElementById('pct').textContent = '0';
  document.getElementById('progressInner').style.width = '0%';
}
function hideProgress() {
  ui.progress.classList.add('hidden');
}

/* ===== 分析主流程 ===== */
async function analyzeContent(content, title) {
  let progressInterval;
  try {
    let progress = 0;
    progressInterval = setInterval(() => {
      if (progress < 95) {
        progress += 5;
        document.getElementById('progressInner').style.width = progress + '%';
        document.getElementById('pct').textContent = Math.round(progress);
      }
    }, 500);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, title }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    clearInterval(progressInterval);

    if (!response.ok) throw new Error(`API ${response.status} ${await response.text()}`);
    const data = await response.json();
    const resultText = data.choices?.[0]?.message?.content || '';
    return parseResult(resultText);
  } catch (e) {
    clearInterval(progressInterval);
    throw e;
  }
}

/* ===== 入口 ===== */
async function handleAnalyze() {
  const raw = ui.input?.value.trim();
  if (!raw) { alert('Please enter content to analyze'); return; }
  if (isAnalyzing) return;
  isAnalyzing = true;
  ui.btn.disabled = true;
  ui.btn.textContent = 'Analyzing...';
  showProgress();
  try {
    const { content, title } = await fetchContent(raw);
    const cached = await getCache(content, title);
    const report = cached || await analyzeContent(content, title);
    if (!cached) await setCache(content, title, report);
    render(report);
  } catch (e) {
    console.error(e);
    ui.summary.textContent = 'Analysis failed: ' + e.message;
    ui.summary.classList.remove('hidden');
    ui.fourDim.classList.add('hidden');
    ui.results.classList.add('hidden');
  } finally {
    hideProgress(); isAnalyzing = false; ui.btn.disabled = false; ui.btn.textContent = 'Analyze';
  }
}

/* ===== 辅助 ===== */
async function fetchContent(input) {
  // 简易：非 http 直接返回
  if (!input.startsWith('http')) return { content: input, title: 'User Input' };
  // 如需真正去拉网页可在此扩展
  return { content: input, title: 'Web Page' };
}

/* ===== 事件绑定 ===== */
document.addEventListener('DOMContentLoaded', () => {
  if (ui.btn) ui.btn.addEventListener('click', handleAnalyze);
  if (ui.input) {
    ui.input.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnalyze(); }
    });
  }
  if (ui.radarTgl && ui.radarEl) {
    ui.radarTgl.addEventListener('click', () => {
      ui.radarEl.classList.toggle('hidden');
      ui.radarTgl.textContent = ui.radarEl.classList.contains('hidden') ? 'View Radar Chart' : 'Hide Radar Chart';
    });
  }
});
