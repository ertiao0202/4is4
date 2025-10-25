// api/health.js - 传统API路由格式
export default async function handler(req, res) {
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    hasApiKey: hasApiKey,
    message: hasApiKey ? 'API key is configured' : 'API key is missing - please set OPENAI_API_KEY in environment variables'
  });
}



