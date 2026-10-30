// Places content is used only to match a customer-supplied business and location.
// Only its place ID is saved; Google does not grant permission to text its listed phone.
const normalize = value => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const nameForClaim = value => normalize(String(value || '').replace(/['’]/g, '').replace(/&/g, ' and '))
  .replace(/\s+(?:llc|inc|incorporated|ltd|limited|corp|corporation)$/, '');

const states = 'alabama:al|alaska:ak|arizona:az|arkansas:ar|california:ca|colorado:co|connecticut:ct|delaware:de|florida:fl|georgia:ga|hawaii:hi|idaho:id|illinois:il|indiana:in|iowa:ia|kansas:ks|kentucky:ky|louisiana:la|maine:me|maryland:md|massachusetts:ma|michigan:mi|minnesota:mn|mississippi:ms|missouri:mo|montana:mt|nebraska:ne|nevada:nv|new hampshire:nh|new jersey:nj|new mexico:nm|new york:ny|north carolina:nc|north dakota:nd|ohio:oh|oklahoma:ok|oregon:or|pennsylvania:pa|rhode island:ri|south carolina:sc|south dakota:sd|tennessee:tn|texas:tx|utah:ut|vermont:vt|virginia:va|washington:wa|west virginia:wv|wisconsin:wi|wyoming:wy|district of columbia:dc'
  .split('|').map(entry => entry.split(':')).sort((a,b) => b[0].length-a[0].length);
const streetWords = { street:'st', avenue:'ave', boulevard:'blvd', road:'rd', drive:'dr', lane:'ln', court:'ct', circle:'cir', highway:'hwy', parkway:'pkwy', place:'pl', terrace:'ter', north:'n', south:'s', east:'e', west:'w', northeast:'ne', northwest:'nw', southeast:'se', southwest:'sw', suite:'ste', apartment:'apt' };
function addressForClaim(value) {
  let result = normalize(String(value || '').replace(/(\d{5})-\d{4}\b/g, '$1'))
    .replace(/\s+(?:usa|us|united states(?: of america)?)$/, '');
  for (const [full,short] of states) result = result.replace(new RegExp('\\b'+full+'\\b','g'),short);
  return result.split(' ').map(word => streetWords[word] || word).join(' ');
}

export async function findBusinessPlace(name, location, fetcher = fetch, { businessSignup = false } = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    if (businessSignup) throw Object.assign(new Error('Google business lookup is not configured'), {code:'PLACES_NOT_CONFIGURED'});
    return null;
  }
  if (!name || !location || name.length > 120 || location.length > 160) return null;
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
  if (!response.ok) throw Object.assign(new Error(`Google Places lookup returned ${response.status}`), {code:'PLACES_SEARCH_FAILED',status:response.status});
  const { places = [] } = await response.json();
  const matches = places.filter(place => {
    if (!place.id || place.businessStatus === 'CLOSED_PERMANENTLY') return false;
    if (businessSignup) {
      const suppliedAddress = addressForClaim(location);
      return suppliedAddress && nameForClaim(place.displayName?.text) === nameForClaim(name) &&
        (' '+addressForClaim(place.formattedAddress)+' ').includes(' '+suppliedAddress+' ');
    }
    return normalize(place.displayName?.text) === normalize(name) &&
      normalize(place.formattedAddress).includes(normalize(location));
  });
  // Never guess between similarly named locations.
  return matches.length === 1 ? matches[0].id : null;
}

// Compare temporarily with an applicant-supplied number; never retain Places content.
export async function matchesListedPhone(placeId, phone, fetcher = fetch) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !placeId) return false;
  const response = await fetcher('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId), {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask':'internationalPhoneNumber' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Object.assign(new Error(`Google phone lookup returned ${response.status}`), {code:'PLACES_PHONE_FAILED',status:response.status});
  const place = await response.json();
  return String(place.internationalPhoneNumber || '').replace(/\D/g,'') === phone.replace(/\D/g,'');
}
