// Reverse geocode only when the visitor asks to use device location. Never
// store coordinates; only the resulting ZIP is used to filter the feed.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();
  const latitude = Number(req.query?.latitude);
  const longitude = Number(req.query?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: 'Invalid location.' });
  }
  try {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/coordinates');
    url.searchParams.set('x', longitude.toFixed(5));
    url.searchParams.set('y', latitude.toFixed(5));
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('vintage', 'Current_Current');
    url.searchParams.set('layers', '2020 Census ZIP Code Tabulation Areas');
    url.searchParams.set('format', 'json');
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const data = await response.json();
    // A ZCTA approximates a postal ZIP; allow manual correction in the form.
    const zcta = data.result?.geographies?.['2020 Census ZIP Code Tabulation Areas']?.[0]?.ZCTA5;
    const zip = String(zcta || '').match(/^\d{5}$/)?.[0];
    if (!zip) return res.status(404).json({ error: 'No nearby ZIP area found. Enter a ZIP code instead.' });
    return res.status(200).json({ zip, approximate: true });
  } catch (error) {
    console.error('Location lookup error:', error);
    return res.status(502).json({ error: 'Could not find your ZIP. Enter it instead.' });
  }
}
