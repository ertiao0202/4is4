/* public/js/app.js  (ESM)  Final - 修复解析函数 */
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

/* 英文词典校正 - 异步加载，不阻塞其他功能 */
let enEmoDict = {};
let enEmoDictLoaded = false;

// 异步加载情感词典，不阻塞页面初始化
async function loadEmotionDict() {
  try {
    const response = await fetch('/dict/en-emotionDict.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    enEmoDict = data.reduce((acc, item) => {
      acc[item.word] = { intensity: item.intensity, polarity: item.polarity };
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

// 解析API返回的结果 - 修复版本，能正确处理KIMI API格式
function parseResult(resultText) {
  try {
    console.log('开始解析结果:', resultText);
    
    // 简化解析逻辑，实际项目中需要根据API返回格式进行解析
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

    // 如果结果是错误信息，直接返回错误
    if (resultText.includes('Error') || resultText.includes('error')) {
      parsed.summary = 'API Error: ' + resultText;
      return parsed;
    }

    // 解析可信度 - 支持两种格式
    let credibilityMatch = resultText.match(/Credibility:\s*(\d+(?:\.\d+)?)\/10/i);
    if (!credibilityMatch) {
      credibilityMatch = resultText.match(/Credibility:\s*(\d+(?:\.\d+)?)/i);
    }
    if (credibilityMatch) {
      parsed.credibility = parseFloat(credibilityMatch[1]);
    }

    // 解析事实 - 支持新旧格式
    const factsMatches = resultText.match(/<fact>(.*?)<\/fact>/gi);
    if (factsMatches) {
      parsed.facts = factsMatches.map(fact => fact.replace(/<\/?fact>/gi, '').trim());
    }

    // 解析观点 - 支持新旧格式
    const opinionsMatches = resultText.match(/<opinion>(.*?)<\/opinion>/gi);
    if (opinionsMatches) {
      parsed.opinions = opinionsMatches.map(op => op.replace(/<\/?opinion>/gi, '').trim());
    }

    // 解析偏见
    const biasMatches = resultText.match(/Bias:.*?(?=\n\n|$)/i);
    if (biasMatches) {
      parsed.bias = biasMatches;
    }

    // 解析发布商建议
    const pubMatch = resultText.match(/Pub:\s*(.*?)(?=\nPR:|$)/i);
    if (pubMatch) {
      parsed.publisherAdvice = pubMatch[1].trim();
    }

    // 解析公关回复
    const prMatch = resultText.match(/PR:\s*(.*?)(?=\nSum:|$)/i);
    if (prMatch) {
      parsed.prReply = prMatch[1].trim();
    }

    // 解析总结 - 如果API直接返回了总结部分
    const sumMatch = resultText.match(/Sum:\s*(.*?)(?=\n|$)/i);
    if (sumMatch) {
      parsed.summary = sumMatch[1].trim();
    } else {
      // 尝试从结果中提取第一行作为总结
      const lines = resultText.split('\n');
      const summaryLine = lines.find(line => !line.includes('Title:') && 
                                              !line.includes('Credibility:') && 
                                              !line.includes('Facts:') && 
                                              !line.includes('Opinions:') && 
                                              !line.includes('Bias:') && 
                                              !line.includes('Pub:') && 
                                              !line.includes('PR:') && 
                                              line.trim().length > 0);
      parsed.summary = summaryLine ? summaryLine : resultText.substring(0, 200) + '...';
    }

    // 解析四维度（如果API返回这些信息）
    const tsMatch = resultText.match(/Source Credibility:\s*(\d+(?:\.\d+)?)/i);
    const fdMatch = resultText.match(/Fact Density:\s*(\d+(?:\.\d+)?)/i);
    const ebMatch = resultText.match(/Emotional Neutrality:\s*(\d+(?:\.\d+)?)/i);
    const csMatch = resultText.match(/Consistency:\s*(\d+(?:\.\d+)?)/i);
    
    parsed.dimensions = {
      ts: tsMatch ? parseFloat(tsMatch[1]) : (parsed.credibility || 5),
      fd: fdMatch ? parseFloat(fdMatch[1]) : 5,
      eb: ebMatch ? parseFloat(ebMatch[1]) : 5,
      cs: csMatch ? parseFloat(csMatch[1]) : 5
    };

    console.log('解析完成:', parsed);
    return parsed;
  } catch (e) {
    console.error('解析结果失败:', e);
    return {
      credibility: 0,
      facts: ['解析失败: ' + e.message],
      opinions: ['解析失败: ' + e.message],
      bias: ['解析失败: ' + e.message],
      publisherAdvice: '解析失败: ' + e.message,
      prReply: '解析失败: ' + e.message,
      summary: '解析失败: ' + e.message,
      dimensions: { ts: 0, fd: 0, eb: 0, cs: 0 }
    };
  }
}

// 渲染结果
function render(report) {
  try {
    console.log('渲染结果:', report);
    
    // 显示摘要
    if (ui.summary) {
      ui.summary.textContent = report.summary || '分析完成';
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
      
      if (tsVal) tsVal.textContent = report.dimensions.ts.toFixed(1);
      if (fdVal) fdVal.textContent = report.dimensions.fd.toFixed(1);
      if (ebVal) ebVal.textContent = report.dimensions.eb.toFixed(1);
      if (csVal) csVal.textContent = report.dimensions.cs.toFixed(1);
      
      if (tsBar) tsBar.style.width = `${Math.min(100, report.dimensions.ts * 10)}%`;
      if (fdBar) fdBar.style.width = `${Math.min(100, report.dimensions.fd * 10)}%`;
      if (ebBar) ebBar.style.width = `${Math.min(100, report.dimensions.eb * 10)}%`;
      if (csBar) csBar.style.width = `${Math.min(100, report.dimensions.cs * 10)}%`;
    }

    // 清空并填充结果列表
    if (ui.fact) {
      ui.fact.innerHTML = '';
      if (report.facts && report.facts.length > 0) {
        report.facts.forEach(fact => {
          const li = document.createElement('li');
          li.textContent = fact;
          ui.fact.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = '未检测到明确的事实';
        ui.fact.appendChild(li);
      }
    }

    if (ui.opinion) {
      ui.opinion.innerHTML = '';
      if (report.opinions && report.opinions.length > 0) {
        report.opinions.forEach(op => {
          const li = document.createElement('li');
          li.textContent = op;
          ui.opinion.appendChild(li);
        });
      } else {
        const li = document.createElement('li');
        li.textContent = '未检测到明确的观点';
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
        li.textContent = '未检测到明显的偏见';
        ui.bias.appendChild(li);
      }
    }

    // 填充发布商建议和公关回复
    const pubAdvice = document.getElementById('pubAdvice');
    const prAdvice = document.getElementById('prAdvice');
    if (pubAdvice) pubAdvice.textContent = report.publisherAdvice || '暂无建议';
    if (prAdvice) prAdvice.textContent = report.prReply || '暂无回复';

    // 显示结果区域
    if (ui.results) ui.results.classList.remove('hidden');
  } catch (e) {
    console.error('渲染结果失败:', e);
    alert('渲染结果时出现错误: ' + e.message);
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
    alert('请输入要分析的内容');
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
      ui.summary.textContent = '分析失败: ' + e.message;
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
});



