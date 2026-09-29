// Places content is used only to match a customer-supplied business and location.
// Only its place ID is saved; Google does not grant permission to text its listed phone.
const normalize = value => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

export async function findBusinessPlace(name, location, fetcher = fetch) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !name || !location || name.length > 120 || location.length > 160) return null;
  const response = await fetcher('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.businessStatus',
    },
    body: JSON.stringify({ textQuery: `${name}, ${location}`, pageSize: 5 }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Google Places lookup returned ${response.status}`);
  const { places = [] } = await response.json();
  const matches = places.filter(place =>
    place.id && place.businessStatus !== 'CLOSED_PERMANENTLY' &&
    normalize(place.displayName?.text) === normalize(name) &&
    normalize(place.formattedAddress).includes(normalize(location))
  );
  // Never guess between similarly named locations.
  return matches.length === 1 ? matches[0].id : null;
}
