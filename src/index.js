import { createPass } from './pass-builder.js';
import { generateStripPng, generateIconPng } from './image-gen.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function pkpassResponse(buffer, filename = 'walletmemo.pkpass') {
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename=${filename}`,
      ...CORS_HEADERS,
    },
  });
}

async function buildPass(env, { text, color, drawingDataUrl }) {
  const stripPng = generateStripPng(color, drawingDataUrl);
  const iconPng = generateIconPng(color);

  const passBuffer = await createPass(env, {
    text,
    color,
    drawingDataUrl,
    stripPng,
    iconPng,
  });

  return passBuffer;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Health check
      if (path === '/api/health') {
        const hasCerts = !!(env.P12_BASE64 && env.WWDR_PEM);
        return jsonResponse({
          status: hasCerts ? 'ready' : 'missing-certs',
          build: env.BUILD_NUMBER || '100',
          message: hasCerts ? 'Server ready to generate passes' : 'Please configure certificates',
        });
      }

      // Generate pass (direct download)
      if (path === '/api/generate-pass' && request.method === 'POST') {
        const body = await request.json();
        const { text, color, drawingDataUrl } = body;
        const buffer = await buildPass(env, { text, color, drawingDataUrl });
        return pkpassResponse(buffer);
      }

      // Prepare pass (Safari iOS two-step flow) — step 1
      if (path === '/api/prepare-pass' && request.method === 'POST') {
        const body = await request.json();
        const { text, color, drawingDataUrl } = body;
        const token = `${Date.now()}-${Math.random().toString(36).substr(2, 12)}`;

        await env.PENDING_PASSES.put(token, JSON.stringify({ text, color, drawingDataUrl }), {
          expirationTtl: 300, // 5 minutes
        });

        return jsonResponse({ token });
      }

      // Download pass (Safari iOS two-step flow) — step 2
      const downloadMatch = path.match(/^\/api\/download-pass\/(.+)$/);
      if (downloadMatch && request.method === 'GET') {
        const token = downloadMatch[1];
        const stored = await env.PENDING_PASSES.get(token);
        if (!stored) {
          return jsonResponse({ error: 'Pass token expired or invalid. Please try again.' }, 404);
        }
        await env.PENDING_PASSES.delete(token);
        const passData = JSON.parse(stored);
        const buffer = await buildPass(env, passData);
        return pkpassResponse(buffer);
      }

      // QR code redirect
      if (path === '/api/pass-redirect') {
        const t = url.searchParams.get('t');
        const c = url.searchParams.get('c') || 'blue';
        let text = '';
        if (t) {
          try {
            text = decodeURIComponent(escape(atob(t)));
          } catch {
            text = atob(t);
          }
        }
        const buffer = await buildPass(env, { text, color: c, drawingDataUrl: null });
        return pkpassResponse(buffer);
      }

      // Debug: test drawing decode
      if (path === '/api/debug-drawing' && request.method === 'POST') {
        const body = await request.json();
        const { drawingDataUrl } = body;
        const info = {
          hasDrawing: !!drawingDataUrl,
          length: drawingDataUrl ? drawingDataUrl.length : 0,
          prefix: drawingDataUrl ? drawingDataUrl.substring(0, 50) : null,
          matchesRegex: drawingDataUrl ? /^data:image\/[^;]+;base64,(.+)$/.test(drawingDataUrl) : false,
        };
        if (drawingDataUrl) {
          try {
            const base64Match = drawingDataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
            if (base64Match) {
              const binStr = atob(base64Match[1]);
              info.decodedLength = binStr.length;
              const bytes = new Uint8Array(binStr.length);
              for (let i = 0; i < binStr.length; i++) {
                bytes[i] = binStr.charCodeAt(i);
              }
              info.bytesLength = bytes.length;
              info.firstBytes = Array.from(bytes.slice(0, 8)).map(b => b.toString(16)).join(' ');
              const { decode: decodePng } = await import('fast-png');
              const decoded = decodePng(bytes);
              info.drawingWidth = decoded.width;
              info.drawingHeight = decoded.height;
              info.firstPixel = [decoded.data[0], decoded.data[1], decoded.data[2], decoded.data[3]];
              info.decodeSuccess = true;
            }
          } catch (e) {
            info.decodeSuccess = false;
            info.error = e.message;
            info.stack = e.stack?.split('\n').slice(0, 3);
          }
        }
        return jsonResponse(info);
      }

      // Test route
      if (path === '/test-pass') {
        const text = url.searchParams.get('text') || 'Test Memo';
        const color = url.searchParams.get('color') || 'blue';
        const buffer = await buildPass(env, { text, color, drawingDataUrl: null });
        return pkpassResponse(buffer, 'test-walletmemo.pkpass');
      }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },
};
