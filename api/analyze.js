// api/analyze.js - KIMI API 版本（prompt 2.0）
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing KIMI_API_KEY environment variable' });
  }

  try {
    const { content, title } = req.body;
    if (!content || !title) {
      return res.status(400).json({ error: 'content or title empty' });
    }

    // 关键：用「必须替换」指令替代占位符
    const prompt = `FactLens-EN-v2
Title:${title}
Credibility:<fill_number>/10
Facts:1. conf:<fill_0到1> <fact>具体事实句子</fact>
Opinions:1. conf:<fill_0到1> <opinion>具体观点句子</opinion>
Bias:-E:<N|Y> conf:<fill_0到1> -B:<N|Y> -M:<N|Y> -F:<N|Y> -Stance:neutral/leaning <fill_percent>%
Pub:<≤15w> PR:<≤8w> Sum:<≤8w>
Text:${content}

要求：
1. 用真实数字或句子替换所有尖括号内容，不得保留尖括号。
2. 不得出现“你”“用户”“示范”“示例”等教学性文字。
3. 若信息不足，赋最低可信值或“N”。`.trim();

    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 700,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('KIMI API Error:', errorData);
      return res.status(response.status).json({ error: errorData });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    console.error('API Error:', e);
    res.status(500).json({ error: e.message });
  }
}
