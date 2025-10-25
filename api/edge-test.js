// api/edge-test.js - Edge Runtime
export const runtime = 'edge';

export default async function handler(req) {
  // 只处理POST请求
  if (req.method === 'POST') {
    const body = await req.json();
    const result = {
      choices: [{
        message: {
          content: "Summary: Test summary.\n\nFacts: 1. <fact>Test fact</fact>\n\nOpinions: 1. <opinion>Test opinion</opinion>\n\nCredibility: 7.5/10"
        }
      }]
    };
    
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    });
  }
  
  // 处理GET请求（用于测试）
  return new Response(JSON.stringify({ 
    message: 'Edge API is working', 
    timestamp: new Date().toISOString()
  }), {
    headers: { 'content-type': 'application/json' },
  });
}



