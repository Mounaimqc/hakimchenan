const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8997;
const WORKSPACE = __dirname;

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && urlObj.pathname === '/save-image') {
    const filename = urlObj.searchParams.get('name') || 'output.png';
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const outPath = path.join(WORKSPACE, 'images', 'products', filename);
      fs.writeFileSync(outPath, buffer);
      console.log(`Saved: ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  if (req.method === 'POST' && urlObj.pathname === '/done') {
    console.log('All images processed successfully!');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true }));
    setTimeout(() => {
      process.exit(0);
    }, 500);
    return;
  }

  // Static files
  let safePath = path.normalize(path.join(WORKSPACE, urlObj.pathname));
  if (!safePath.startsWith(WORKSPACE) || !fs.existsSync(safePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(safePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.webp': 'image/webp',
    '.png': 'image/png'
  };

  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(safePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browserBin = fs.existsSync(chromePath) ? chromePath : edgePath;

  const chrome = spawn(browserBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `http://localhost:${PORT}/process-transparency.html`
  ]);

  chrome.on('exit', code => {
    console.log(`Browser exited with code ${code}`);
  });

  setTimeout(() => {
    console.log('Timeout. Exiting...');
    chrome.kill();
    process.exit(0);
  }, 15000);
});
