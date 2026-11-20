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
  if (!process.env.GOOGLE_GEOCODING_API_KEY) {
    return res.status(503).json({ error: 'Location lookup is not set up. Enter your ZIP code instead.' });
  }
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${latitude.toFixed(5)},${longitude.toFixed(5)}`);
    url.searchParams.set('result_type', 'postal_code');
    url.searchParams.set('key', process.env.GOOGLE_GEOCODING_API_KEY);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
    const data = await response.json();
    if (data.status !== 'OK') throw new Error(`Geocoder status: ${data.status}`);
    const postal = data.results.flatMap(item => item.address_components || [])
      .find(component => component.types?.includes('postal_code'))?.long_name;
    const zip = String(postal || '').match(/^\d{5}$/)?.[0];
    if (!zip) return res.status(404).json({ error: 'No US ZIP found here. Enter a ZIP code instead.' });
    return res.status(200).json({ zip });
  } catch (error) {
    console.error('Location lookup error:', error);
    return res.status(502).json({ error: 'Could not find your ZIP. Enter it instead.' });
  }
}
