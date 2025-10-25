// api/analyze.js - KIMI API版本
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 检查KIMI API密钥
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing KIMI_API_KEY environment variable' });
  }

  try {
    const { content, title } = req.body;
    
    if (!content || !title) {
      return res.status(400).json({ error: 'content or title empty' });
    }

    // 构建KIMI API请求的prompt
    const prompt = `FactLens-EN-v2
Title:${title}
Credibility:X/10
Facts:1.conf:0.XX<fact>sentence</fact>
Opinions:1.conf:0.XX<opinion>sentence</opinion>
Bias:-E:N conf:0.XX -B:N -M:N -F:N -Stance:neutral/leaning X%
Pub:xxx(≤15w) PR:xxx(≤8w) Sum:xxx(≤8w)
Text:${content}`.trim();

    // 调用KIMI API
    const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',  // 或者使用其他KIMI模型
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 600,
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



