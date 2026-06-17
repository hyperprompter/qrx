import { createServer } from 'http';
import { writeFile, readFile, mkdir, stat, readdir } from 'fs/promises';
import { join, dirname, resolve, extname } from 'path';
import { createReadStream, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import url from 'url';

// Proxy Dependencies
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import axios from 'axios';
import puppeteer from 'puppeteer';
import { PDFParse } from 'pdf-parse';
import path from 'path'

// Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- QRx Configuration ---
const PORT = 3000;
const DATA_DIR = resolve(join(process.cwd(), 'data'));
const INDEX_PATH = resolve(join(process.cwd(), 'public', 'data', 'index.json'));
const DIST_DIR = resolve(join(process.cwd(), 'dist'));
const SECRET = process.env.QRX_SYNC_KEY;
const clients = new Set();

// Include list setup
const includeRaw = process.env.QRX_INCLUDE_NAMESPACES || 'main';
const includeParsed = includeRaw.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
const INCLUDE_SET = new Set([...includeParsed, 'main']);

const isNamespaceAllowed = (ns) => ns && INCLUDE_SET.has(ns.toLowerCase());

// --- Proxy Configuration ---
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const SECRET_PARAM = 'thoughtformgardenproxy';
const args = process.argv.slice(2);
const isLocalMode = args.includes('--proxyall');
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

function loadAllowlist() {
  const allowlistPath = path.join(__dirname, 'allowlist.txt');
  if (!existsSync(allowlistPath)) return null;
  try {
    const content = readFileSync(allowlistPath, 'utf-8');
    const domains = content.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#')).map(line => line.toLowerCase());
    return new Set(domains);
  } catch (error) {
    return null;
  }
}

const allowlist = isLocalMode ? null : loadAllowlist();

function isAllowedDomain(targetUrl) {
  if (isLocalMode || !allowlist) return true;
  try {
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (allowlist.has(hostname)) return true;
    for (const domain of allowlist) {
      if (hostname.endsWith('.' + domain) || hostname === domain) return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function checkRateLimit(ip) {
  if (isLocalMode) return true;
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW;
    rateLimitMap.set(ip, record);
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) return false;
  record.count++;
  rateLimitMap.set(ip, record);
  return true;
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.headers['fly-client-ip'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.socket.remoteAddress;
}

async function fetchAndParse(targetUrl, queryParams) {
  if (cache.has(targetUrl)) {
    const entry = cache.get(targetUrl);
    if (Date.now() - entry.timestamp < CACHE_TTL) return { content: entry.content, contentType: entry.contentType };
    cache.delete(targetUrl);
  }

  const forceHeadless = queryParams.forceheadless === 'true';
  if (!forceHeadless) {
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      };
      if (queryParams.braveapikey) headers['X-Subscription-Token'] = queryParams.braveapikey;

      const response = await axios.get(targetUrl, { headers, timeout: 15000, responseType: 'arraybuffer' });
      const contentType = (response.headers['content-type'] || '').toLowerCase();

      if (contentType.includes('xml') || contentType.includes('rss') || contentType.includes('json')) {
        const content = Buffer.from(response.data).toString('utf-8');
        cache.set(targetUrl, { content, contentType, timestamp: Date.now() });
        return { content, contentType };
      }

      if (contentType.includes('application/pdf')) {
        const parser = new PDFParse({ data: response.data });
        try {
            const data = await parser.getText();
            const content = `Title: ${data.info?.Title || path.basename(targetUrl)}\n\n${data.text.trim()}`;
            cache.set(targetUrl, { content, contentType: 'text/plain', timestamp: Date.now() });
            await parser.destroy();
            return { content, contentType: 'text/plain' };
        } catch (pdfError) {
            await parser.destroy();
            throw pdfError;
        }
      }
      
      const html = Buffer.from(response.data).toString('utf-8');
      const dom = new JSDOM(html, { url: targetUrl });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (!article || !article.textContent) throw new Error('Readability could not extract content via lightweight fetch.');
      
      const cleanedText = article.textContent.replace(/\s{2,}/g, ' ').trim();
      const content = `Title: ${article.title}\nBy: ${article.byline || 'Unknown'}\n\n${cleanedText}`;
      cache.set(targetUrl, { content, contentType: 'text/plain', timestamp: Date.now() });
      return { content, contentType: 'text/plain' };
    } catch (error) {
      if (error.response && (error.response.status === 429 || error.response.status === 403)) {}
      else {
        let errorMessage = error.message;
        if (error.response && error.response.status) errorMessage = `Request failed with status ${error.response.status}`;
      }
    }
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args:['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions', '--no-zygote', '--single-process']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    
    try { await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 }); }
    catch (timeoutError) { await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }); }

    const html = await page.content();
    if (targetUrl.includes('duckduckgo.com')) {
        cache.set(targetUrl, { content: html, contentType: 'text/html', timestamp: Date.now() });
        return { content: html, contentType: 'text/html' };
    }

    const dom = new JSDOM(html, { url: targetUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article || !article.textContent) throw new Error('Readability could not extract content after browser load.');

    const cleanedText = article.textContent.replace(/\s{2,}/g, ' ').trim();
    const content = `Title: ${article.title}\nBy: ${article.byline || 'Unknown'}\n\n${cleanedText}`;
    cache.set(targetUrl, { content, contentType: 'text/plain', timestamp: Date.now() });
    return { content, contentType: 'text/plain' };
  } catch (error) {
    return { content: `Error: Could not retrieve content from ${targetUrl}. Reason: ${error.message}`, contentType: 'text/plain' };
  } finally {
    if (browser) await browser.close();
  }
}

async function updateDataIndex() {
  try {
    let results = [];
    const namespaces = await readdir(DATA_DIR, { withFileTypes: true });
    const IGNORE_LIST = ['.DS_Store', '.git', 'node_modules'];

    for (let ns of namespaces) {
      if (!ns.isDirectory() || IGNORE_LIST.includes(ns.name)) continue;
      async function walk(currentDir, currentPath) {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (let e of entries) {
          if (IGNORE_LIST.includes(e.name)) continue;
          const itemPath = currentPath ? `${currentPath}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(join(currentDir, e.name), itemPath);
          else results.push(`${ns.name}/${itemPath}`);
        }
      }
      await walk(join(DATA_DIR, ns.name), '');
    }
    await writeFile(INDEX_PATH, JSON.stringify(results));
  } catch (err) {
    console.error('Failed to generate data index:', err);
  }
}
updateDataIndex();

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  
  const parsedUrl = url.parse(req.url, true);
  const myUrl = new URL(req.url, `http://localhost`);

  if (req.method === 'GET' && parsedUrl.pathname === '/proxy') {
    const clientIp = getClientIp(req);
    if (!checkRateLimit(clientIp)) return res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Rate limit exceeded.' }));
    const targetUrl = parsedUrl.query[SECRET_PARAM] || parsedUrl.query['url'];
    if (!targetUrl) return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Missing parameter.' }));
    try {
      const parsedTarget = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsedTarget.protocol)) throw new Error('Invalid protocol');
    } catch (e) {
      return res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Invalid URL.' }));
    }
    if (!isAllowedDomain(targetUrl)) return res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Domain not allowed.' }));
    try {
      const { content, contentType } = await fetchAndParse(targetUrl, parsedUrl.query);
      res.writeHead(200, { 'Content-Type': contentType });
      return res.end(content);
    } catch (e) {
      return res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Failed to process request.' }));
    }
  }
  
  if (req.method === 'GET' && myUrl.pathname === '/stream') {
    if (SECRET && parsedUrl.query.auth !== SECRET) {
      return res.writeHead(401).end('Unauthorized');
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET') {
    let safePath = myUrl.pathname === '/' ? 'index.html' : myUrl.pathname;
    let filePath;

    // Block direct /data/* access except for index.json typeahead
    if (safePath === '/data/index.json') {
      filePath = resolve(INDEX_PATH);
    } else if (safePath.startsWith('/data/')) {
      return res.writeHead(403).end('Direct data access blocked. Use /read endpoint.');
    } else {
      filePath = resolve(join(DIST_DIR, safePath));
      if (!filePath.startsWith(DIST_DIR)) return res.writeHead(403).end('Forbidden');
      try {
        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) throw new Error('is_dir');
      } catch {
        if (!extname(safePath)) filePath = resolve(join(DIST_DIR, 'index.html'));
        else return res.writeHead(404).end('Not Found');
      }
      try { await stat(filePath); } catch { return res.writeHead(404).end('Not Found'); }
    }

    const mimes = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': mimes[extname(filePath)] || 'application/octet-stream' });
    
    const stream = createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500).end(); });
    stream.pipe(res);
    return;
  }

  if (req.method === 'POST' && myUrl.pathname === '/write') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { namespace, key, value, clientId } = JSON.parse(body);
        if (!SECRET || req.headers.authorization !== SECRET) {
          return res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' }));
        }

        const targetPath = resolve(join(DATA_DIR, namespace, key));
        if (!targetPath.startsWith(DATA_DIR)) throw new Error("Path traversal blocked");
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, value || '');
        await updateDataIndex();
        const msg = "data: " + JSON.stringify({ namespace, key, clientId }) + "\n\n";
        clients.forEach(client => client.write(msg));
        res.writeHead(200).end(JSON.stringify({ status: 'saved' }));
      } catch (err) { res.writeHead(400).end(JSON.stringify({ error: err.message })); }
    });
    return;
  }

  if (req.method === 'POST' && myUrl.pathname === '/read') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { namespace, key } = JSON.parse(body);
        const hasValidKey = SECRET && req.headers.authorization === SECRET;
        
        if (!hasValidKey && !isNamespaceAllowed(namespace)) {
          return res.writeHead(404).end(JSON.stringify({ error: 'Namespace not in allowlist' }));
        }
        
        let targetPath = resolve(join(DATA_DIR, namespace, key));
        if (!targetPath.startsWith(DATA_DIR)) throw new Error("Path traversal blocked");
        let data;
        try {
          data = await readFile(targetPath, 'utf-8');
        } catch (err) {
          if (namespace !== 'main') {
            targetPath = resolve(join(DATA_DIR, 'main', key));
            if (!targetPath.startsWith(DATA_DIR)) throw new Error("Path traversal blocked");
            data = await readFile(targetPath, 'utf-8');
          } else { throw err; }
        }
        res.writeHead(200).end(JSON.stringify({ value: data }));
      } catch (err) { res.writeHead(404).end(JSON.stringify({ error: 'Not found' })); }
    });
    return;
  }

  res.writeHead(404).end('Not Found');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Fog Node active on http://0.0.0.0:${PORT}`);
  console.log(`[Proxy] Mounted on /proxy?url=<target>`);
});
