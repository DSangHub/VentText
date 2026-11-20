import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVent, resolveMerchant } from '../api/_lib/merchants.js';

test('complaints accept utilities and cable providers with a ZIP and no receipt', () => {
  assert.deepEqual(parseVent('VENT: Utility | Valley Electric | 93720 | My bill doubled without an explanation.'), {
    category: 'Utility', name: 'Valley Electric', zip: '93720',
    complaint: 'My bill doubled without an explanation.', lang:'en',
  });
  assert.deepEqual(parseVent('VENT-ES: Servicios públicos | Luz Local | 93720 | Mi factura aumentó sin explicación.'), {
    category:'Utility', name:'Luz Local', zip:'93720', complaint:'Mi factura aumentó sin explicación.', lang:'es',
  });
  assert.equal(parseVent('VENT: Utility | Valley Electric | not a ZIP | Billing complaint'), null);
  assert.equal(parseVent('VENT: unknown | Provider | 93720 | Billing complaint'), null);
});

test('a provider without a Google listing is saved as unclaimed', async () => {
  const calls = [];
  const db = { async query(sql, args) {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT * FROM merchants WHERE lower')) return { rows: [] };
    if (sql.startsWith('INSERT INTO merchants')) return { rows: [{ id: 'merchant-1', status: 'UNCLAIMED', name: args[0] }] };
    throw new Error('Unexpected query');
  } };
  const result = await resolveMerchant(db, 'VENT: Cable & internet | Example Cable | 93720 | My service has been out for two days.');
  assert.equal(result.merchant.status, 'UNCLAIMED');
  assert.equal(result.vent.zip, '93720');
  assert.equal(calls[1].args[1], '93720');
});

test('device coordinates resolve to a ZIP area without retaining coordinates', async () => {
  const { default: handler } = await import('../api/location/zip.js');
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => {
    requested = new URL(url);
    return { ok: true, async json() { return { result: { geographies: { '2020 Census ZIP Code Tabulation Areas': [{ ZCTA5: '93721' }] } } }; } };
  };
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode=code; return this; }, json(data) { this.data=data; return this; } };
  try {
    await handler({ method:'GET', query:{ latitude:'36.7378', longitude:'-119.7871' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.data, { zip:'93721', approximate:true });
    assert.equal(requested.hostname, 'geocoding.geo.census.gov');
  } finally { globalThis.fetch=original; }
});
