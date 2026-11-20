import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVent, resolveMerchant } from '../api/_lib/merchants.js';

test('complaints accept utilities and cable providers with a ZIP and no receipt', () => {
  assert.deepEqual(parseVent('VENT: Utility | Valley Electric | 93720 | My bill doubled without an explanation.'), {
    category: 'Utility', name: 'Valley Electric', zip: '93720',
    complaint: 'My bill doubled without an explanation.',
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
