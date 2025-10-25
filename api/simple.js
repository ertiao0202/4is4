// api/simple.js  Node.js Runtime - 最简API
export const runtime = 'nodejs';

export default async function handler(req) {
  return new Response(JSON.stringify({ 
    message: 'API is working', 
    timestamp: new Date().toISOString(),
    received: req.method === 'POST' ? 'POST request processed' : 'Other request'
  }), { 
    headers: { 
      'content-type': 'application/json' 
    } 
  });
}



