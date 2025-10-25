/* public/js/app.js  (ESM)  Final - 修正API调用 - 只发送原始文本 */
const $ = s => document.querySelector(s);
const url = '/api/analyze'; // 更新API端点

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

/* ===== 浏览器 LRU 48 h ===== */
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

/* ===== 偏见检测词典和规则 ===== */
let enEmoDict = {};
let enEmoDictLoaded = false;

// 异步加载情感词典
async function loadEmotionDict() {
  try {
    const response = await fetch('/dict/en-emotionDict.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    enEmoDict = data.reduce((acc, item) => {
      acc[item.word.toLowerCase()] = { intensity: item.intensity, polarity: item.polarity };
      return acc;
    }, {});
    
    console.log('情感词典加载完成，共', Object.keys(enEmoDict).length, '个词条');
    enEmoDictLoaded = true;
  } catch (err) {
    console.error('情感词典加载失败:', err);
    // 即使词典加载失败，也要继续运行，只是不使用情感分析功能
    enEmoDictLoaded = false;
  }
}

// 对立词典 - 从情感词典中自动识别
function findOppositionPairs() {
  const positiveWords = [];
  const negativeWords = [];
  
  for (const [word, data] of Object.entries(enEmoDict)) {
    if (data.polarity === "positive") {
      positiveWords.push(word);
    } else if (data.polarity === "negative") {
      negativeWords.push(word);
    }
  }
  
  return { positiveWords, negativeWords };
}

// 意图动词词典
const intentVerbs = [
  "think", "believe", "feel", "assume", "presume", "imagine", "guess", "suppose",
  "wonder", "doubt", "suspect", "expect", "anticipate", "predict", "foresee"
];

// 逻辑谬误模式
const logicalFallacyPatterns = [
  { type: "slippery slope", regex: /\b(will lead to|inevitably lead|eventually result in|start down the path|begin the trend)\b/gi },
  { type: "ad hominem", regex: /\b(idiot|liar|fool|stupid|moron|jerk|foolish|ignorant|dumb|crazy)\b/gi },
  { type: "straw man", regex: /\b(they claim|they say|they argue)\s+.*\b(extreme|ridiculous|absurd|unreasonable|crazy)\b/gi },
  { type: "false dilemma", regex: /\b(either.*or|only two options|black and white|no middle ground|one or the other)\b/gi },
  { type: "appeal to authority", regex: /\b(expert says|famous person said|authority figure claims|professor states)\b/gi },
  { type: "hasty generalization", regex: /\b(all.*are|every.*is|never.*not|always.*will|everyone.*thinks)\b/gi },
  { type: "correlation implies causation", regex: /\b(therefore|so|caused by|because of|leads to)\b/gi }
];

// 启动词典加载
loadEmotionDict();

function correctEmotionEN(rawEmo, text) { 
  // 如果词典未加载完成，直接返回原始值
  if (!enEmoDictLoaded || !text) return rawEmo; 
  const tokens = text.toLowerCase().match(/\b[\w']+\b/g) || []; 
  let maxPhrase = 0; 
  for (let n = 1; n <= 3; n++) { 
    for (let i = 0; i <= tokens.length - n; i++) { 
      const w = tokens.slice(i, i + n).join(' '); 
      if (enEmoDict[w]) maxPhrase = Math.max(maxPhrase, enEmoDict[w].intensity); 
    } 
  } 
  return Math.max(rawEmo, maxPhrase); 
}

// 显示进度条
function showProgress() {
  if (ui.progress) ui.progress.classList.remove('hidden');
  if (ui.summary) ui.summary.classList.add('hidden');
  if (ui.fourDim) ui.fourDim.classList.add('hidden');
  if (ui.results) ui.results.classList.add('hidden');
  const pctElement = document.getElementById('pct');
  const progressInner = document.getElementById('progressInner');
  if (pctElement) pctElement.textContent = '0';
  if (progressInner) progressInner.style.width = '0%';
}

// 隐藏进度条
function hideProgress() {
  if (ui.progress) ui.progress.classList.add('hidden');
}

// 获取网页内容的函数（简化版）
async function fetchContent(input) {
  // 如果输入是URL，则提取内容，否则直接返回输入内容
  if (input.startsWith('http')) {
    // 这里应该有获取网页内容的逻辑，但简化为返回输入
    return { content: input, title: 'Web Page' };
  } else {
    return { content: input, title: 'User Input' };
  }
}

// 基于词典和规则的偏见检测
function detectBiasWithRules(content) {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const biasResults = {
    emotionalWords: 0,
    binaryOpposition: 0,
    mindReading: 0,
    logicalFallacy: 0,
    overallStance: 'neutral'
  };
  
  console.log('开始检测偏见，内容句子数:', sentences.length);
  
  // 情感词检测
  sentences.forEach(sentence => {
    const words = sentence.toLowerCase().match(/\b[\w']+\b/g) || [];
    const emotionalWords = words.filter(word => enEmoDict[word]);
    biasResults.emotionalWords += emotionalWords.length;
  });
  
  console.log('情感词检测结果:', biasResults.emotionalWords);
  
  // 二元对立检测 - 基于情感词典中的正负情感词
  const { positiveWords, negativeWords } = findOppositionPairs();
  sentences.forEach(sentence => {
    const lowerSentence = sentence.toLowerCase();
    let hasPositive = false;
    let hasNegative = false;
    
    // 检查是否同时出现正负情感词
    for (const posWord of positiveWords) {
      if (lowerSentence.includes(posWord)) {
        hasPositive = true;
        break;
      }
    }
    
    for (const negWord of negativeWords) {
      if (lowerSentence.includes(negWord)) {
        hasNegative = true;
        break;
      }
    }
    
    if (hasPositive && hasNegative) {
      biasResults.binaryOpposition++;
    }
  });
  
  console.log('二元对立检测结果:', biasResults.binaryOpposition);
  
  // 心理揣测检测
  sentences.forEach(sentence => {
    const lowerSentence = sentence.toLowerCase();
    const mindReadingPattern = new RegExp(
      `\\b(they|he|she|the government|people|someone|anyone)\\s+.*\\b(${intentVerbs.join('|')})\\b`,
      'i'
    );
    if (mindReadingPattern.test(lowerSentence)) {
      biasResults.mindReading++;
    }
  });
  
  console.log('心理揣测检测结果:', biasResults.mindReading);
  
  // 逻辑谬误检测
  sentences.forEach(sentence => {
    logicalFallacyPatterns.forEach(pattern => {
      if (pattern.regex.test(sentence)) {
        biasResults.logicalFallacy++;
      }
    });
  });
  
  console.log('逻辑谬误检测结果:', biasResults.logicalFallacy);
  
  // 总体立场检测 - 基于情感词典的极性
  let positiveCount = 0;
  let negativeCount = 0;
  let totalEmotionalWords = 0;
  
  sentences.forEach(sentence => {
    const words = sentence.toLowerCase().match(/\b[\w']+\b/g) || [];
    words.forEach(word => {
      if (enEmoDict[word]) {
        totalEmotionalWords++;
        if (enEmoDict[word].polarity === "positive") {
          positiveCount++;
        } else if (enEmoDict[word].polarity === "negative") {
          negativeCount++;
        }
      }
    });
  });
  
  if (totalEmotionalWords > 0) {
    const positiveRatio = positiveCount / totalEmotionalWords;
    const negativeRatio = negativeCount / totalEmotionalWords;
    
    if (positiveRatio > negativeRatio + 0.1) {
      biasResults.overallStance = `leaning positive ${Math.min(100, Math.round(positiveRatio * 100))}%`;
    } else if (negativeRatio > positiveRatio + 0.1) {
      biasResults.overallStance = `leaning negative ${Math.min(100, Math.round(negativeRatio * 100))}%`;
    } else {
      biasResults.overallStance = 'neutral';
    }
  }
  
  console.log('总体立场检测结果:', biasResults.overallStance);
  return biasResults;
}

// 计算四维度 - 充分利用情感词典
function calculateFourDimensions(content) {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = content.toLowerCase().match(/\b[\w']+\b/g) || [];
  
  // 初始化四维度
  const dimensions = { ts: 5, fd: 5, eb: 5, cs: 5 };
  
  // TS (Trustworthiness Score) - 可信度
  // 基于情感强度：高强度情感词可能降低可信度
  if (enEmoDictLoaded) {
    const emotionalWords = words.filter(word => enEmoDict[word]);
    if (emotionalWords.length > 0) {
      const avgIntensity = emotionalWords.reduce((sum, word) => sum + enEmoDict[word].intensity, 0) / emotionalWords.length;
      // 高强度情感词降低可信度
      dimensions.ts = Math.max(1, 10 - avgIntensity);
    } else {
      dimensions.ts = 7; // 没有情感词反而更可信
    }
  }
  
  // FD (Factual Density) - 事实密度
  // 基于情感词比例：情感词越少，事实密度越高
  if (enEmoDictLoaded) {
    const emotionalWordCount = words.filter(word => enEmoDict[word]).length;
    const factualDensity = (words.length - emotionalWordCount) / Math.max(1, words.length);
    dimensions.fd = factualDensity * 10;
  }
  
  // EB (Emotional Balance) - 情感平衡
  // 基于正负情感词平衡：越平衡分数越高
  if (enEmoDictLoaded) {
    let positiveCount = 0;
    let negativeCount = 0;
    
    words.forEach(word => {
      if (enEmoDict[word]) {
        if (enEmoDict[word].polarity === "positive") positiveCount++;
        else if (enEmoDict[word].polarity === "negative") negativeCount++;
      }
    });
    
    const totalEmotional = positiveCount + negativeCount;
    if (totalEmotional > 0) {
      const balance = 1 - Math.abs(positiveCount - negativeCount) / totalEmotional;
      dimensions.eb = balance * 10;
    } else {
      dimensions.eb = 10; // 没有情感词最平衡
    }
  }
  
  // CS (Consistency Score) - 一致性
  // 基于段落间情感倾向的一致性
  if (enEmoDictLoaded && sentences.length > 1) {
    const paragraphScores = [];
    
    for (const sentence of sentences) {
      const sentWords = sentence.toLowerCase().match(/\b[\w']+\b/g) || [];
      let posCount = 0;
      let negCount = 0;
      
      sentWords.forEach(word => {
        if (enEmoDict[word]) {
          if (enEmoDict[word].polarity === "positive") posCount++;
          else if (enEmoDict[word].polarity === "negative") negCount++;
        }
      });
      
      const total = posCount + negCount;
      if (total > 0) {
        paragraphScores.push((posCount - negCount) / total);
      }
    }
    
    if (paragraphScores.length > 1) {
      // 计算段落间情感倾向的差异
      let variance = 0;
      if (paragraphScores.length > 0) {
        const avg = paragraphScores.reduce((a, b) => a + b, 0) / paragraphScores.length;
        const squaredDiffs = paragraphScores.map(score => Math.pow(score - avg, 2));
        variance = squaredDiffs.reduce((a, b) => a + b, 0) / paragraphScores.length;
      }
      
      // 差异越小，一致性越高
      dimensions.cs = Math.max(1, 10 - variance * 50);
    }
  }
  
  console.log('四维度计算结果:', dimensions);
  return dimensions;
}

// 提取事实和观点的函数
function extractFactsAndOpinions(content) {
  const facts = [];
  const opinions = [];
  
  // 标准格式提取
  if (content.includes('Credibility:') && (content.includes('<fact>') || content.includes('<opinion>'))) {
    // 提取事实
    const factMatches = content.match(/(\d+\.?\d*)\.conf:\s*(\d+\.?\d+)\s*<fact>(.*?)<\/fact>/gs);
    if (factMatches) {
      factMatches.forEach(fact => {
        const confMatch = fact.match(/conf:\s*(\d+\.?\d+)/);
        const contentMatch = fact.match(/<fact>(.*?)<\/fact>/s);
        const confidence = confMatch ? parseFloat(confMatch[1]) : 0;
        const text = contentMatch ? contentMatch[1].trim() : fact.replace(/<\/?fact>/g, '').trim();
        if (text) {
          facts.push({ content: text, confidence });
        }
      });
    }
    
    // 提取观点
    const opinionMatches = content.match(/(\d+\.?\d*)\.conf:\s*(\d+\.?\d+)\s*<opinion>(.*?)<\/opinion>/gs);
    if (opinionMatches) {
      opinionMatches.forEach(op => {
        const confMatch = op.match(/conf:\s*(\d+\.?\d+)/);
        const contentMatch = op.match(/<opinion>(.*?)<\/opinion>/s);
        const confidence = confMatch ? parseFloat(confMatch[1]) : 0;
        const text = contentMatch ? contentMatch[1].trim() : op.replace(/<\/?opinion>/g, '').trim();
        if (text) {
          opinions.push({ content: text, confidence });
        }
      });
    }
  } else {
    // 自然语言格式提取
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    // 事实关键词
    const factKeywords = ['according to', 'studies show', 'research indicates', 'data shows', 
                         'statistics reveal', 'findings suggest', 'evidence shows', 'study found',
                         'report states', 'document shows', 'figures indicate', 'results show',
                         'is', 'are', 'was', 'were', 'has', 'have', 'had', 'can be', 'shows that',
                         'demonstrates', 'proves', 'confirms', 'reveals', 'reports'];
    
    // 观点关键词
    const opinionKeywords = ['think', 'believe', 'feel', 'opinion', 'view', 'perspective', 
                            'seems', 'appears', 'suggests', 'argues', 'claims', 'believes',
                            'in my opinion', 'in my view', 'from my perspective', 'I think',
                            'I believe', 'should', 'must', 'ought to', 'probably', 'likely',
                            'possibly', 'perhaps', 'maybe', 'might', 'could', 'I feel'];
    
    sentences.forEach(sentence => {
      const lowerSentence = sentence.toLowerCase();
      let isFact = false;
      let isOpinion = false;
      
      // 检查是否包含事实关键词
      if (factKeywords.some(keyword => lowerSentence.includes(keyword))) {
        isFact = true;
      }
      
      // 检查是否包含观点关键词
      if (opinionKeywords.some(keyword => lowerSentence.includes(keyword))) {
        isOpinion = true;
      }
      
      // 如果句子包含事实特征但不含观点特征，则认为是事实
      if (isFact && !isOpinion) {
        facts.push({ 
          content: sentence.trim(), 
          confidence: 0.8 
        });
      } 
      // 如果句子包含观点特征，则认为是观点
      else if (isOpinion) {
        opinions.push({ 
          content: sentence.trim(), 
          confidence: 0.7 
        });
      }
      // 其他情况根据上下文判断
      else {
        // 默认分配，基于句子特征
        if (sentence.includes('that') || sentence.match(/\d+/) || sentence.includes('percent') || 
            sentence.includes('number') || sentence.includes('study') || sentence.includes('data')) {
          facts.push({ 
            content: sentence.trim(), 
            confidence: 0.6 
          });
        } else {
          opinions.push({ 
            content: sentence.trim(), 
            confidence: 0.5 
          });
        }
      }
    });
  }
  
  console.log('提取的事实:', facts);
  console.log('提取的观点:', opinions);
  
  return { facts, opinions };
}

// 解析API返回的结果 - 使用基于词典的偏见检测
function parseResult(resultText) {
  try {
    console.log('开始解析结果:', resultText);
    
    // 初始化解析结果
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

    // 检查是否包含标准格式标记
    const hasStandardFormat = resultText.includes('Credibility:') && 
                             (resultText.includes('<fact>') || resultText.includes('<opinion>'));
    
    if (hasStandardFormat) {
      // 处理标准格式
      console.log('检测到标准格式');
      
      // 解析可信度
      const credibilityMatch = resultText.match(/Credibility:\s*(\d+(?:\.\d+)?)\/10/i);
      if (credibilityMatch) {
        parsed.credibility = parseFloat(credibilityMatch[1]);
      }

      // 解析事实
      const factMatches = resultText.match(/(\d+\.?\d*)\.conf:\s*(\d+\.?\d+)\s*<fact>(.*?)<\/fact>/gs);
      if (factMatches) {
        parsed.facts = factMatches.map(fact => {
          const confMatch = fact.match(/conf:\s*(\d+\.?\d+)/);
          const contentMatch = fact.match(/<fact>(.*?)<\/fact>/s);
          const confidence = confMatch ? parseFloat(confMatch[1]) : 0;
          const content = contentMatch ? contentMatch[1].trim() : fact.replace(/<\/?fact>/g, '').trim();
          return { content, confidence };
        });
      }

      // 解析观点
      const opinionMatches = resultText.match(/(\d+\.?\d*)\.conf:\s*(\d+\.?\d+)\s*<opinion>(.*?)<\/opinion>/gs);
      if (opinionMatches) {
        parsed.opinions = opinionMatches.map(op => {
          const confMatch = op.match(/conf:\s*(\d+\.?\d+)/);
          const contentMatch = op.match(/<opinion>(.*?)<\/opinion>/s);
          const confidence = confMatch ? parseFloat(confMatch[1]) : 0;
          const content = contentMatch ? contentMatch[1].trim() : op.replace(/<\/?opinion>/g, '').trim();
          return { content, confidence };
        });
      }

      // 解析摘要
      const sumMatch = resultText.match(/Sum:\s*(.*?)(?=\n|$)/i);
      if (sumMatch) {
        parsed.summary = sumMatch[1].replace(/\(≤\d+w\)/g, '').trim();
      } else {
        // 如果没有Sum，使用Text行
        const textMatch = resultText.match(/Text:\s*(.*?)(?=\n$|$)/s);
        if (textMatch) {
          parsed.summary = textMatch[1].trim();
        }
      }

      // 使用基于词典的偏见检测
      const biasResults = detectBiasWithRules(parsed.summary || resultText);
      
      // 格式化偏见结果 - 确保所有指标都显示，即使为0
      const biasComponents = [];
      biasComponents.push(`Emotional words: ${biasResults.emotionalWords} detected`);
      biasComponents.push(`Binary opposition: ${biasResults.binaryOpposition} detected`);
      biasComponents.push(`Mind-reading: ${biasResults.mindReading} detected`);
      biasComponents.push(`Logical fallacy: ${biasResults.logicalFallacy} detected`);
      biasComponents.push(`Overall stance: ${biasResults.overallStance}`);
      
      parsed.bias = biasComponents;
      
      // 计算四维度
      parsed.dimensions = calculateFourDimensions(parsed.summary || resultText);

    } else {
      // 处理自然语言格式
      console.log('检测到自然语言格式');
      
      // 提取文本内容
      const lines = resultText.split('\n');
      
      // 尝试提取可信度
      const credPhrases = ['credibility', 'credibility score', 'credibility might be'];
      for (const line of lines) {
        if (credPhrases.some(phrase => line.toLowerCase().includes(phrase))) {
          const numMatch = line.match(/(\d+(?:\.\d+)?)/);
          if (numMatch) {
            parsed.credibility = parseFloat(numMatch[1]);
            break;
          }
        }
      }
      
      // 如果没有明确的可信度，根据内容判断
      if (parsed.credibility === 0) {
        if (resultText.toLowerCase().includes('low') || 
            resultText.toLowerCase().includes('skepticism') ||
            resultText.toLowerCase().includes('lacking evidence')) {
          parsed.credibility = 3;
        } else if (resultText.toLowerCase().includes('high') || 
                   resultText.toLowerCase().includes('well')) {
          parsed.credibility = 7;
        } else {
          parsed.credibility = 5;
        }
      }

      // 使用新的提取函数来处理事实和观点
      const extracted = extractFactsAndOpinions(resultText);
      parsed.facts = extracted.facts;
      parsed.opinions = extracted.opinions;
      
      // 提取摘要
      const summaryPhrases = ['based on this analysis', 'in summary', 'conclusion', 'important to approach'];
      for (const line of lines) {
        if (summaryPhrases.some(phrase => line.toLowerCase().includes(phrase))) {
          parsed.summary = line.replace(/^\*\*.*?\*\*:\s*/g, '').trim();
          break;
        }
      }
      
      if (!parsed.summary) {
        const meaningfulLines = lines.filter(line => 
          line.length > 50 && 
          !line.toLowerCase().includes('structured format') &&
          !line.toLowerCase().includes('provided') &&
          !line.toLowerCase().includes('given')
        );
        if (meaningfulLines.length > 0) {
          parsed.summary = meaningfulLines[meaningfulLines.length - 1].substring(0, 150) + '...';
        } else {
          parsed.summary = 'Analysis completed based on provided text.';
        }
      }
      
      // 使用基于词典的偏见检测
      const biasResults = detectBiasWithRules(parsed.summary || resultText);
      
      // 格式化偏见结果 - 确保所有指标都显示，即使为0
      const biasComponents = [];
      biasComponents.push(`Emotional words: ${biasResults.emotionalWords} detected`);
      biasComponents.push(`Binary opposition: ${biasResults.binaryOpposition} detected`);
      biasComponents.push(`Mind-reading: ${biasResults.mindReading} detected`);
      biasComponents.push(`Logical fallacy: ${biasResults.logicalFallacy} detected`);
      biasComponents.push(`Overall stance: ${biasResults.overallStance}`);
      
      parsed.bias = biasComponents;
      
      // 计算四维度
      parsed.dimensions = calculateFourDimensions(parsed.summary || resultText);
    }

    console.log('解析完成:', parsed);
    return parsed;
  } catch (e) {
    console.error('解析结果失败:', e);
    return {
      credibility: 0,
      facts: [{ content: '解析失败: ' + e.message, confidence: 0 }],
      opinions: [{ content: '解析失败: ' + e.message, confidence: 0 }],
      bias: ['解析失败: ' + e.message],
      publisherAdvice: '解析失败: ' + e.message,
      prReply: '解析失败: ' + e.message,
      summary: '解析失败: ' + e.message,
      dimensions: { ts: 0, fd: 0, eb: 0, cs: 0 }
    };
  }
}

// 创建雷达图
function createRadarChart(dimensions) {
  if (!ui.radarEl) return;
  
  // 销毁现有图表
  if (radarChart) {
    radarChart.destroy();
  }
  
  // 确保数据有效
  const chartData = [
    dimensions.ts || 0,
    dimensions.fd || 0,
    dimensions.eb || 0,
    dimensions.cs || 0
  ];
  
  // 创建新图表
  radarChart = new Chart(ui.radarEl, {
    type: 'radar',
    data: {
      labels: ['Source Credibility', 'Fact Density', 'Emotional Balance', 'Consistency'],
      datasets: [{
        label: 'Analysis Score',
        data: chartData,
        backgroundColor: 'rgba(37, 99, 235, 0.2)',
        borderColor: 'rgba(37, 99, 235, 1)',
        pointBackgroundColor: 'rgba(37, 99, 235, 1)',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: 'rgba(37, 99, 235, 1)'
      }]
    },
    options: {
      scales: {
        r: {
          beginAtZero: true,
          max: 10,
          ticks: {
            stepSize: 2
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
        }
      }
    }
  });
}

// 渲染结果
function render(report) {
  try {
    console.log('渲染结果:', report);
    
    // 显示摘要
    if (ui.summary) {
      ui.summary.textContent = report.summary || 'Analysis completed';
      ui.summary.classList.remove('hidden');
    }

    // 显示四维度
    if (ui.fourDim && report.dimensions) {
      ui.fourDim.classList.remove('hidden');
      
      // 更新四维度条形图
      const tsVal = document.getElementById('tsVal');
      const fdVal = document.getElementById('fdVal');
      const ebVal = document.getElementById('ebVal');
      const csVal = document.getElementById('csVal');
      const tsBar = document.getElementById('tsBar');
      const fdBar = document.getElementById('fdBar');
      const ebBar = document.getElementById('ebBar');
      const csBar = document.getElementById('csBar');
      
      // 显示具体的数字值
      if (tsVal) tsVal.textContent = report.dimensions.ts.toFixed(1);
      if (fdVal) fdVal.textContent = report.dimensions.fd.toFixed(1);
      if (ebVal) ebVal.textContent = report.dimensions.eb.toFixed(1);
      if (csVal) csVal.textContent = report.dimensions.cs.toFixed(1);
      
      // 设置条形图宽度
      if (tsBar) tsBar.style.width = `${Math.min(100, report.dimensions.ts * 10)}%`;
      if (fdBar) fdBar.style.width = `${Math.min(100, report.dimensions.fd * 10)}%`;
      if (ebBar) ebBar.style.width = `${Math.min(100, report.dimensions.eb * 10)}%`;
      if (csBar) csBar.style.width = `${Math.min(100, report.dimensions.cs * 10)}%`;
      
      // 创建雷达图
      createRadarChart(report.dimensions);
    }

    // 清空并填充结果列表
    if (ui.fact) {
      ui.fact.innerHTML = '';
      if (report.facts && report.facts.length > 0) {
        report.facts.forEach(fact => {
          const li = document.createElement('li');
          // 显示内容和置信度 - 修复格式为 (conf: 百分比)
          li.innerHTML = `${fact.content} <span style="color: #6b7280; font-size: 0.8em;">(conf: ${(fact.confidence * 100).toFixed(0)}%)</span>`;
          // 根据置信度添加颜色类
          if (fact.confidence >= 0.8) {
            li.classList.add('conf-high');
          } else if (fact.confidence >= 0.5) {
            li.classList.add('conf-mid');
          } else {
            li.classList.add('conf-low');
          }
          ui.fact.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = 'No explicit facts detected';
        ui.fact.appendChild(li);
      }
    }

    if (ui.opinion) {
      ui.opinion.innerHTML = '';
      if (report.opinions && report.opinions.length > 0) {
        report.opinions.forEach(op => {
          const li = document.createElement('li');
          // 显示内容和置信度 - 修复格式为 (conf: 百分比)
          li.innerHTML = `${op.content} <span style="color: #6b7280; font-size: 0.8em;">(conf: ${(op.confidence * 100).toFixed(0)}%)</span>`;
          // 根据置信度添加颜色类
          if (op.confidence >= 0.8) {
            li.classList.add('conf-high');
          } else if (op.confidence >= 0.5) {
            li.classList.add('conf-mid');
          } else {
            li.classList.add('conf-low');
          }
          ui.opinion.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = 'No explicit opinions detected';
        ui.opinion.appendChild(li);
      }
    }

    if (ui.bias) {
      ui.bias.innerHTML = '';
      if (report.bias && report.bias.length > 0) {
        report.bias.forEach(b => {
          const li = document.createElement('li');
          li.textContent = b;
          ui.bias.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = 'No obvious bias detected';
        ui.bias.appendChild(li);
      }
    }

    // 填充发布商建议和公关回复
    const pubAdvice = document.getElementById('pubAdvice');
    const prAdvice = document.getElementById('prAdvice');
    if (pubAdvice) pubAdvice.textContent = report.publisherAdvice || 'No advice provided';
    if (prAdvice) prAdvice.textContent = report.prReply || 'No reply provided';

    // 显示结果区域
    if (ui.results) ui.results.classList.remove('hidden');
  } catch (e) {
    console.error('渲染结果失败:', e);
    alert('Rendering error: ' + e.message);
  }
}

// 分析内容函数
async function analyzeContent(content, title) {
  let progressInterval; // 在函数开始处声明
  
  try {
    console.log('开始分析内容:', { content: content.substring(0, 100) + '...', title });
    
    // 模拟进度更新
    let progress = 0;
    progressInterval = setInterval(() => {
      if (progress < 95) {
        progress += 5;
        const progressInner = document.getElementById('progressInner');
        const pctElement = document.getElementById('pct');
        if (progressInner) progressInner.style.width = progress + '%';
        if (pctElement) pctElement.textContent = Math.round(progress);
      }
    }, 500);
    
    // 设置超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.log('请求超时');
    }, 45000); // 45秒超时
    
    try {
      console.log('发送请求到API...');
      const response = await fetch('/api/analyze', { // 更新API端点
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, title }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      if (progressInterval) clearInterval(progressInterval);
      
      console.log('API响应状态:', response.status);
      const progressInner = document.getElementById('progressInner');
      const pctElement = document.getElementById('pct');
      if (progressInner) progressInner.style.width = '98%';
      if (pctElement) pctElement.textContent = '98';
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API响应错误:', response.status, errorText);
        throw new Error(`API请求失败: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      console.log('API响应数据:', data);
      
      if (progressInner) progressInner.style.width = '100%';
      if (pctElement) pctElement.textContent = '100';
      
      // 获取结果文本
      const resultText = data.choices?.[0]?.message?.content || 
                        (data.error ? `Error: ${data.error}` : 
                         (data && typeof data === 'object' ? JSON.stringify(data) : String(data)));
      
      console.log('原始结果文本:', resultText);
      
      const parsedResult = parseResult(resultText);
      console.log('解析后的结果:', parsedResult);
      
      return parsedResult;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (progressInterval) clearInterval(progressInterval);
      
      if (fetchError.name === 'AbortError') {
        throw new Error('请求超时，请稍后重试');
      }
      throw fetchError;
    }
  } catch (e) {
    console.error('分析内容失败:', e);
    if (progressInterval) clearInterval(progressInterval);
    throw e;
  }
}

// 主处理函数
async function handleAnalyze() {
  const raw = ui.input?.value.trim(); 
  if (!raw) {
    alert('Please enter content to analyze');
    return; 
  }
  
  if (isAnalyzing) {
    console.log('分析正在进行中，请稍候...');
    return;
  }
  
  isAnalyzing = true;
  if (ui.btn) {
    ui.btn.disabled = true;
    ui.btn.textContent = 'Analyzing...';
  }
  
  showProgress();
  
  try {
    console.log('开始获取内容...');
    const { content, title } = await fetchContent(raw);
    console.log('获取内容完成:', { content: content.substring(0, 100) + '...', title });
    
    // LRU缓存检查
    const cached = await getCache(content, title);
    if (cached) {
      console.log('使用缓存结果');
      render(cached);
      return;
    }
    
    console.log('执行实时分析...');
    const report = await analyzeContent(content, title);
    console.log('分析完成，保存到缓存');
    await setCache(content, title, report);
    render(report);
  } catch (e) {
    console.error('处理分析失败:', e);
    
    // 显示错误信息
    if (ui.summary) {
      ui.summary.textContent = 'Analysis failed: ' + e.message;
      ui.summary.classList.remove('hidden');
      if (ui.summary.classList) {
        ui.summary.classList.add('conf-low');
      }
    }
    
    // 隐藏其他结果
    if (ui.fourDim) ui.fourDim.classList.add('hidden');
    if (ui.results) ui.results.classList.add('hidden');
  } finally {
    hideProgress();
    isAnalyzing = false;
    if (ui.btn) {
      ui.btn.disabled = false;
      ui.btn.textContent = 'Analyze';
    }
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('页面加载完成，初始化事件监听器');
  if (ui.btn) ui.btn.addEventListener('click', handleAnalyze);
  
  // 支持回车键触发分析
  if (ui.input) {
    ui.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAnalyze();
      }
    });
  }
  
  // 雷达图切换功能
  if (ui.radarTgl && ui.radarEl) {
    ui.radarTgl.addEventListener('click', () => {
      ui.radarEl.classList.toggle('hidden');
      const text = ui.radarTgl.textContent;
      if (ui.radarEl.classList.contains('hidden')) {
        ui.radarTgl.textContent = 'View Radar Chart';
      } else {
        ui.radarTgl.textContent = 'Hide Radar Chart';
      }
    });
  }
});



