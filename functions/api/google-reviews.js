// ============================================================
//  The Wanderer Outdoors — Google Reviews server proxy
//  ------------------------------------------------------------
//  Cloudflare Pages Function (module format). Serves GET /api/google-reviews
//  and returns a small JSON envelope of Google reviews for a given Place ID.
//
//  WHY A PROXY?
//    * The Google Places API key must stay SECRET. If it lived in the browser
//      anyone could steal it and rack up billing. Here it is read from the
//      server environment (GOOGLE_PLACES_API_KEY) and never reaches the client.
//    * It also lets us cache results (1 hour) to stay within Google quota.
//
//  DEPLOY:
//    Cloudflare Pages: drop this file at functions/api/google-reviews.js and
//      set GOOGLE_PLACES_API_KEY in the Pages project environment variables.
//    Netlify:      use netlify/functions/google-reviews.js (see README note).
//    Vercel/Node:  replicate this logic in an /api route; the front-end only
//      needs a JSON response of { rating, reviews:[{author_name,rating,text,time}] }.
// ============================================================

export async function onRequestGet(context) {
  const env = (context && context.env) || {};
  const key = env.GOOGLE_PLACES_API_KEY;

  const reqUrl = new URL(context.request.url);
  const placeId = reqUrl.searchParams.get('placeId');
  const limit = Math.max(1, Math.min(10, parseInt(reqUrl.searchParams.get('limit') || '5', 10) || 5));

  if (!key) {
    return json(
      { error: 'Google Places API key is not configured on the server. Set GOOGLE_PLACES_API_KEY in your hosting environment (see .env.example).' },
      501
    );
  }
  if (!placeId) {
    return json({ error: 'Missing placeId parameter.' }, 400);
  }

  try {
    const apiUrl =
      'https://maps.googleapis.com/maps/api/place/details/json' +
      '?place_id=' + encodeURIComponent(placeId) +
      '&fields=rating,reviews' +
      '&reviews_sort=newest' +
      '&key=' + encodeURIComponent(key);

    const res = await fetch(apiUrl);
    const data = await res.json();

    if (!data || data.status !== 'OK') {
      return json(
        { error: 'Google API: ' + (data && data.status ? data.status : 'unknown') +
          (data && data.error_message ? ' — ' + data.error_message : '') },
        502
      );
    }

    const result = data.result || {};
    const reviews = (result.reviews || []).slice(0, limit).map(r => ({
      author_name: r.author_name,
      rating: r.rating,
      text: r.text,
      time: r.time
    }));

    return json({ rating: result.rating || '', reviews }, 200, {
      'cache-control': 'public, max-age=3600'
    });
  } catch (e) {
    return json({ error: 'Proxy error: ' + (e && e.message ? e.message : 'unknown') }, 502);
  }
}

function json(obj, status, extraHeaders) {
  const headers = Object.assign(
    { 'content-type': 'application/json; charset=utf-8' },
    extraHeaders || {}
  );
  return new Response(JSON.stringify(obj), { status: status || 200, headers: headers });
}
