// ============================================================
//  The Wanderer Outdoors — Google Reviews API Route for Vercel
//  ------------------------------------------------------------
//  Path: /api/google-reviews (Vercel Serverless Function)
//
//  Serves GET /api/google-reviews?placeId=...&limit=5
//  Fetches reviews securely using the server-side environment variable
//  GOOGLE_PLACES_API_KEY. The key is never exposed to browser-side code.
// ============================================================

export default async function handler(req, res) {
  // Set CORS and JSON headers
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;
  const { placeId, limit: rawLimit } = req.query;
  const limit = Math.max(1, Math.min(10, parseInt(rawLimit || '5', 10) || 5));

  if (!key) {
    return res.status(501).json({
      error: 'Google Places API key is not configured on the server. Set GOOGLE_PLACES_API_KEY in your Vercel Project Settings > Environment Variables.'
    });
  }

  if (!placeId) {
    return res.status(400).json({ error: 'Missing placeId query parameter.' });
  }

  try {
    const apiUrl =
      'https://maps.googleapis.com/maps/api/place/details/json' +
      '?place_id=' + encodeURIComponent(placeId) +
      '&fields=rating,reviews' +
      '&reviews_sort=newest' +
      '&key=' + encodeURIComponent(key);

    const apiRes = await fetch(apiUrl);
    const data = await apiRes.json();

    if (!data || data.status !== 'OK') {
      return res.status(502).json({
        error: 'Google API: ' + (data && data.status ? data.status : 'unknown') +
          (data && data.error_message ? ' — ' + data.error_message : '')
      });
    }

    const result = data.result || {};
    const reviews = (result.reviews || []).slice(0, limit).map(r => ({
      author_name: r.author_name,
      rating: r.rating,
      text: r.text,
      time: r.time
    }));

    // Cache responses for 1 hour to prevent quota exhaustion
    res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=3600');
    return res.status(200).json({
      rating: result.rating || '',
      reviews: reviews
    });
  } catch (err) {
    return res.status(502).json({
      error: 'Proxy error: ' + (err && err.message ? err.message : 'unknown')
    });
  }
}
