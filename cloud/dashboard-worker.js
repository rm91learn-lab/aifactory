// AI-Factory online dashboard — Cloudflare Worker.
// The factory daemon pushes the rendered dashboard here; viewing requires the
// factory password (HTTP Basic auth over HTTPS). Client ideas are never public.
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Daemon push endpoint (bearer token, not the viewer password).
    if (url.pathname === '/update' && req.method === 'POST') {
      if (req.headers.get('authorization') !== `Bearer ${env.PUSH_TOKEN}`) {
        return new Response('forbidden', { status: 403 });
      }
      const { html, data } = await req.json();
      await env.DASH.put('html', html || '');
      await env.DASH.put('data', data || '{"products":[]}');
      await env.DASH.put('pushedAt', new Date().toISOString());
      return new Response('ok');
    }

    // Everything else requires the viewer password.
    const expected = 'Basic ' + btoa('factory:' + env.VIEW_PASSWORD);
    if ((req.headers.get('authorization') || '') !== expected) {
      return new Response('AI-Factory dashboard — sign in', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="AI-Factory"' },
      });
    }

    if (url.pathname === '/data.json') {
      return new Response(await env.DASH.get('data') || '{"products":[]}', {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    const html = await env.DASH.get('html');
    return new Response(html || '<h3 style="font-family:sans-serif">No dashboard pushed yet — start the factory daemon.</h3>', {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  },
};
