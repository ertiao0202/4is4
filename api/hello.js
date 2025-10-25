// api/hello.js - Vercel默认API路由
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  
  // 简单的响应
  const data = {
    message: 'Hello from Vercel API',
    timestamp: new Date().toISOString(),
    status: 'success'
  };
  
  res.status(200).json(data);
}



