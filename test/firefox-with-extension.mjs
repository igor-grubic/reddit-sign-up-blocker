// Launch Playwright's Firefox (Nightly build) with the extension installed as a temporary add-on.
// Playwright can't load Firefox extensions itself, so we enable Firefox's Remote Debugging
// Protocol and call the root actor's installTemporaryAddon, exactly like about:debugging does.
import { firefox } from 'playwright';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// Minimal RDP client: packets are "<byteLength>:<json>".
function rdpInstall(port, addonPath, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let sock;
    const connect = () => {
      sock = net.connect(port, '127.0.0.1');
      let buf = Buffer.alloc(0);
      let addonsActor = null;
      const send = (obj) => {
        const body = Buffer.from(JSON.stringify(obj));
        sock.write(`${body.length}:`);
        sock.write(body);
      };
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          const colon = buf.indexOf(':');
          if (colon < 0) return;
          const len = Number(buf.subarray(0, colon).toString());
          if (buf.length < colon + 1 + len) return;
          const msg = JSON.parse(buf.subarray(colon + 1, colon + 1 + len).toString());
          buf = buf.subarray(colon + 1 + len);
          if (msg.error) { sock.destroy(); return reject(new Error(`RDP ${msg.error}: ${msg.message}`)); }
          if (msg.from === 'root' && msg.applicationType) send({ to: 'root', type: 'getRoot' });
          else if (msg.from === 'root' && msg.addonsActor && !addonsActor) {
            addonsActor = msg.addonsActor;
            send({ to: addonsActor, type: 'installTemporaryAddon', addonPath, openDevTools: false });
          } else if (msg.from === addonsActor && msg.addon) { sock.end(); resolve(msg.addon); }
        }
      });
      sock.on('error', (e) => {
        if (Date.now() < deadline && e.code === 'ECONNREFUSED') setTimeout(connect, 200);
        else reject(e);
      });
    };
    connect();
  });
}

export async function launchWithExtension({ headless = !process.env.HEADED, extensionDir } = {}) {
  extensionDir ??= path.resolve(import.meta.dirname, '../extension');
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsb-profile-'));
  const context = await firefox.launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['-start-debugger-server', String(port)],
    firefoxUserPrefs: {
      'devtools.debugger.remote-enabled': true,
      'devtools.chrome.enabled': true,
      'devtools.debugger.prompt-connection': false,
    },
  });
  const addon = await rdpInstall(port, extensionDir);
  const close = async () => {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  };
  return { context, addon, close };
}
