// api/health.js  Node.js Runtime - 健康检查
export const runtime = 'nodejs';

export default async function handler(req, res) {
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  
  return new Response(JSON.stringify({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    hasApiKey: hasApiKey,
    message: hasApiKey ? 'API key is configured' : 'API key is missing - please set OPENAI_API_KEY in environment variables'
  }), { 
    headers: { 
      'content-type': 'application/json' 
    } 
  });
}



