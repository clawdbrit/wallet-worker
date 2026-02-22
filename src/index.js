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

async function buildPass(env, { text, color, clientStripPng }) {
  // Use client-rendered strip if provided, otherwise generate solid color
  const stripPng = clientStripPng || generateStripPng(color);
  const iconPng = generateIconPng(color);

  const passBuffer = await createPass(env, {
    text,
    color,
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
        const { text, color } = body;
        const buffer = await buildPass(env, { text, color });
        return pkpassResponse(buffer);
      }

      // Prepare pass (Safari iOS two-step flow) — step 1
      if (path === '/api/prepare-pass' && request.method === 'POST') {
        let text, color, stripPngBytes;
        const contentType = request.headers.get('content-type') || '';
        
        if (contentType.includes('multipart/form-data')) {
          const formData = await request.formData();
          text = formData.get('text') || '';
          color = formData.get('color') || 'blue';
          const stripFile = formData.get('strip');
          if (stripFile && stripFile.size > 0) {
            stripPngBytes = new Uint8Array(await stripFile.arrayBuffer());
          }
        } else {
          const body = await request.json();
          text = body.text || '';
          color = body.color || 'blue';
        }

        const token = `${Date.now()}-${Math.random().toString(36).substr(2, 12)}`;

        // Store metadata in KV
        await env.PENDING_PASSES.put(token, JSON.stringify({ text, color }), {
          expirationTtl: 300,
        });

        // Store strip PNG separately if provided (binary, avoids base64 bloat)
        if (stripPngBytes) {
          await env.PENDING_PASSES.put(`${token}:strip`, stripPngBytes, {
            expirationTtl: 300,
          });
        }

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
        // Fetch strip PNG if it was stored
        const stripPngBytes = await env.PENDING_PASSES.get(`${token}:strip`, { type: 'arrayBuffer' });
        await env.PENDING_PASSES.delete(token);
        await env.PENDING_PASSES.delete(`${token}:strip`);
        const passData = JSON.parse(stored);
        if (stripPngBytes) {
          passData.clientStripPng = new Uint8Array(stripPngBytes);
        }
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
        const buffer = await buildPass(env, { text, color: c });
        return pkpassResponse(buffer);
      }

      // Test route
      if (path === '/test-pass') {
        const text = url.searchParams.get('text') || 'Test Memo';
        const color = url.searchParams.get('color') || 'blue';
        const buffer = await buildPass(env, { text, color });
        return pkpassResponse(buffer, 'test-walletmemo.pkpass');
      }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message }, 500);
    }
  },
};
