import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Database
const db = new Database('clippings.db');
db.pragma('journal_mode = WAL');

// Create table
db.exec(`
  CREATE TABLE IF NOT EXISTS clippings (
    id TEXT PRIMARY KEY,
    bookTitle TEXT,
    author TEXT,
    location TEXT,
    dateAdded TEXT,
    content TEXT,
    comment TEXT,
    rawDate TEXT,
    timestamp INTEGER
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  
  // WebDAV Proxy to bypass CORS
  // Use express.text to capture raw body for proxying
  app.all('/api/webdav-proxy', express.text({ type: '*/*', limit: '50mb' }), async (req, res) => {
    let targetUrl = req.headers['x-target-url'] as string;
    if (!targetUrl) {
      return res.status(400).json({ error: 'Missing x-target-url header' });
    }

    // 处理可能存在的中文路径编码问题
    try {
      const urlObj = new URL(targetUrl);
      targetUrl = urlObj.toString();
    } catch (e) {
      // 如果已经是编码过的或者格式特殊，保持原样
    }

    try {
      const headers: Record<string, string> = {
        'Authorization': req.headers['authorization'] || '',
        'Content-Type': req.headers['content-type'] || 'application/octet-stream',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      };

      // 转发 WebDAV 特有头
      if (req.headers['depth']) headers['Depth'] = req.headers['depth'] as string;
      if (req.headers['destination']) headers['Destination'] = req.headers['destination'] as string;
      if (req.headers['overwrite']) headers['Overwrite'] = req.headers['overwrite'] as string;

      // 处理请求体
      let body: any = undefined;
      const methodsWithBody = ['PUT', 'POST', 'PROPPATCH', 'LOCK'];
      if (methodsWithBody.includes(req.method.toUpperCase())) {
        body = req.body;
      }
      
      console.log(`[WebDAV Proxy] ${req.method} -> ${targetUrl}`);

      const response = await fetch(targetUrl, {
        method: req.method,
        headers: headers,
        body: body,
      });

      if (!response.ok && !(req.method === 'GET' && response.status === 404)) {
        const errorText = await response.text();
        console.error(`[WebDAV Proxy] Nutstore Error (${response.status}): ${errorText.substring(0, 300)}`);
        return res.status(response.status).send(errorText);
      }

      const contentType = response.headers.get('content-type');
      const responseData = await response.text();

      if (contentType) res.set('Content-Type', contentType);
      res.status(response.status).send(responseData);
    } catch (error: any) {
      console.error('[WebDAV Proxy] Fatal Error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all clippings
  app.get('/api/clippings', (req, res) => {
    try {
      const stmt = db.prepare('SELECT * FROM clippings ORDER BY timestamp DESC');
      const clippings = stmt.all();
      res.set('Cache-Control', 'no-store');
      res.json(clippings);
    } catch (error) {
      console.error('Error fetching clippings:', error);
      res.status(500).json({ error: 'Failed to fetch clippings' });
    }
  });

  // Batch import/upsert clippings
  app.post('/api/clippings/batch', (req, res) => {
    try {
      const clippings = req.body;
      if (!Array.isArray(clippings)) {
        return res.status(400).json({ error: 'Expected an array of clippings' });
      }

      const insert = db.prepare(`
        INSERT OR REPLACE INTO clippings (id, bookTitle, author, location, dateAdded, content, comment, rawDate, timestamp)
        VALUES (@id, @bookTitle, @author, @location, @dateAdded, @content, @comment, @rawDate, @timestamp)
      `);

      const insertMany = db.transaction((items) => {
        for (const item of items) insert.run(item);
      });

      insertMany(clippings);
      
      res.json({ success: true, count: clippings.length });
    } catch (error) {
      console.error('Error batch importing:', error);
      res.status(500).json({ error: 'Failed to import clippings' });
    }
  });

  // Update single clipping (for comments, quotes, etc.)
  app.put('/api/clippings/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { bookTitle, author, location, dateAdded, content, comment, rawDate, timestamp } = req.body;

      const stmt = db.prepare(`
        UPDATE clippings 
        SET bookTitle = ?, author = ?, location = ?, dateAdded = ?, content = ?, comment = ?, rawDate = ?, timestamp = ?
        WHERE id = ?
      `);

      const info = stmt.run(bookTitle, author, location, dateAdded, content, comment, rawDate, timestamp, id);
      
      if (info.changes === 0) {
        return res.status(404).json({ error: 'Clipping not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating clipping:', error);
      res.status(500).json({ error: 'Failed to update clipping' });
    }
  });

  // Rename book
  app.put('/api/books/rename', (req, res) => {
    try {
      const { oldTitle, newTitle } = req.body;
      if (!oldTitle || !newTitle) {
        return res.status(400).json({ error: 'Missing oldTitle or newTitle' });
      }

      const stmt = db.prepare('UPDATE clippings SET bookTitle = ? WHERE bookTitle = ?');
      const info = stmt.run(newTitle, oldTitle);

      res.json({ success: true, changes: info.changes });
    } catch (error) {
      console.error('Error renaming book:', error);
      res.status(500).json({ error: 'Failed to rename book' });
    }
  });

  // Delete single clipping
  app.delete('/api/clippings/:id', (req, res) => {
    try {
      const { id } = req.params;
      const stmt = db.prepare('DELETE FROM clippings WHERE id = ?');
      stmt.run(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting clipping:', error);
      res.status(500).json({ error: 'Failed to delete clipping' });
    }
  });

  // Clear all data
  app.delete('/api/clippings', (req, res) => {
    try {
      db.prepare('DELETE FROM clippings').run();
      res.json({ success: true });
    } catch (error) {
      console.error('Error clearing data:', error);
      res.status(500).json({ error: 'Failed to clear data' });
    }
  });

  // Delete entire book
  app.delete('/api/books/delete', (req, res) => {
    try {
      const { bookTitle } = req.body;
      if (!bookTitle) {
        return res.status(400).json({ error: 'Missing bookTitle' });
      }

      const stmt = db.prepare('DELETE FROM clippings WHERE bookTitle = ?');
      const info = stmt.run(bookTitle);

      res.json({ success: true, changes: info.changes });
    } catch (error) {
      console.error('Error deleting book:', error);
      res.status(500).json({ error: 'Failed to delete book' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production static file serving (if needed, though usually handled by build step)
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
