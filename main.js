// Flicker — Electron main process
// Owns everything filesystem-related: native folder picker, listing media
// files, streaming media to the renderer (via a custom "flicker-media://"
// protocol so <img>/<video> can use plain URLs with Range support),
// moving/deleting files, and opening the real _deleted folder in
// Explorer/Finder.

const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');
const { Readable } = require('stream');

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'ogg'];
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogg: 'video/ogg'
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'flicker-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

function kindForExt(ext) {
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return null;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// Chromium parses a bare "C:" right after "//" as a host:port pair and
// drops it — that's a leniency the spec only grants the literal "file"
// scheme. Giving our custom scheme an explicit host ("local") keeps the
// drive letter safely inside the path portion instead.
function toMediaUrl(filePath) {
  const fileHref = pathToFileURL(filePath).href; // file:///C:/Users/...
  const pathPart = fileHref.slice('file://'.length); // /C:/Users/...
  return 'flicker-media://local' + pathPart;
}

function listMediaFiles(dirPath) {
  const names = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of names) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    const ext = path.extname(entry.name).slice(1).toLowerCase();
    const kind = kindForExt(ext);
    if (kind) files.push({ name: entry.name, kind, url: toMediaUrl(path.join(dirPath, entry.name)) });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return files;
}

function safeMoveFile(fromPath, toPath) {
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  try {
    fs.renameSync(fromPath, toPath);
  } catch (e) {
    if (e.code === 'EXDEV') {
      fs.copyFileSync(fromPath, toPath);
      fs.unlinkSync(fromPath);
    } else {
      throw e;
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0B0C0F',
    title: 'Flicker',
    icon: path.join(__dirname, 'build/flicker.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('console-message', (_event, _level, message) => {
    console.log('[renderer]', message);
  });
  win.loadFile('flicker.html');
}

app.whenReady().then(() => {
  // flicker-media://<encoded absolute path> -> stream the real file straight off
  // disk. Electron's net.fetch() on a file:// URL ignores Range headers (always
  // 200s the whole file), which breaks video scrubbing — so Range is handled
  // manually here, same as the old server.js did.
  protocol.handle('flicker-media', (request) => {
    try {
      const encodedPath = request.url.slice('flicker-media://local'.length); // /C:/Users/...
      const filePath = fileURLToPath('file://' + encodedPath);
      const stat = fs.statSync(filePath);
      const mime = mimeFor(filePath);
      const range = request.headers.get('Range');

      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        const start = m && m[1] ? parseInt(m[1], 10) : 0;
        const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(end - start + 1),
            'Content-Type': mime
          }
        });
      }

      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream), {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': String(stat.size),
          'Content-Type': mime
        }
      });
    } catch (e) {
      console.log('[flicker-media] error:', e.message);
      return new Response('Not found', { status: 404 });
    }
  });

  ipcMain.handle('pick-folder', async (_event, promptText) => {
    const result = await dialog.showOpenDialog({
      title: promptText || 'Select a folder',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('list-files', (_event, dir) => {
    if (!dir || !fs.existsSync(dir)) return { ok: false, error: 'Folder not found.' };
    try {
      return { ok: true, files: listMediaFiles(dir) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('file-op', (_event, { op, sourceDir, destDir, name }) => {
    try {
      if (!op || !sourceDir || !name) return { ok: false, error: 'Missing parameters.' };
      if (op === 'delete') {
        safeMoveFile(path.join(sourceDir, name), path.join(sourceDir, '_deleted', name));
      } else if (op === 'undo-delete') {
        safeMoveFile(path.join(sourceDir, '_deleted', name), path.join(sourceDir, name));
      } else if (op === 'move') {
        if (!destDir) return { ok: false, error: 'Missing destination folder.' };
        safeMoveFile(path.join(sourceDir, name), path.join(destDir, name));
      } else if (op === 'undo-move') {
        if (!destDir) return { ok: false, error: 'Missing destination folder.' };
        safeMoveFile(path.join(destDir, name), path.join(sourceDir, name));
      } else {
        return { ok: false, error: 'Unknown op.' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('open-folder', async (_event, { sourceDir }) => {
    if (!sourceDir) return { ok: false, error: 'Missing sourceDir.' };
    try {
      const deleteDir = path.join(sourceDir, '_deleted');
      fs.mkdirSync(deleteDir, { recursive: true });
      const err = await shell.openPath(deleteDir);
      if (err) return { ok: false, error: err };
      return { ok: true, path: deleteDir };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
