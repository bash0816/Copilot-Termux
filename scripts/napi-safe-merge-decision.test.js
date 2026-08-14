'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeFingerprint, isValidBaseline, decideSafeMerge } = require('./napi-safe-merge-decision.js');

test('napi-safe-merge-decision module', async (t) => {
  // ======================
  // computeFingerprint tests
  // ======================
  await t.test('computeFingerprint: identical input produces identical fingerprint', () => {
    const candidateLists = {
      newPendingGitAsync: ['funcA', 'funcB'],
      newStreamRisk: ['streamX', 'streamY'],
      newUnknown: ['unknownP', 'unknownQ'],
    };
    const hmacKey = 'test-key-123';

    const fp1 = computeFingerprint(candidateLists, hmacKey);
    const fp2 = computeFingerprint(candidateLists, hmacKey);

    assert.strictEqual(fp1, fp2, 'Same input should produce same fingerprint');
    assert.match(fp1, /^[0-9a-f]{64}$/, 'Fingerprint should be 64-char hex');
  });

  await t.test('computeFingerprint: different hmacKey produces different fingerprint', () => {
    const candidateLists = {
      newPendingGitAsync: ['funcA'],
      newStreamRisk: [],
      newUnknown: [],
    };

    const fp1 = computeFingerprint(candidateLists, 'key1');
    const fp2 = computeFingerprint(candidateLists, 'key2');

    assert.notStrictEqual(fp1, fp2, 'Different keys should produce different fingerprints');
  });

  await t.test('computeFingerprint: missing hmacKey throws error', () => {
    const candidateLists = {
      newPendingGitAsync: ['funcA'],
      newStreamRisk: [],
      newUnknown: [],
    };

    assert.throws(() => computeFingerprint(candidateLists, undefined), 'Should throw for undefined key');
    assert.throws(() => computeFingerprint(candidateLists, ''), 'Should throw for empty string key');
  });

  await t.test('computeFingerprint: empty arrays handled correctly', () => {
    const candidateLists = {
      newPendingGitAsync: [],
      newStreamRisk: [],
      newUnknown: [],
    };
    const hmacKey = 'test-key';

    const fp = computeFingerprint(candidateLists, hmacKey);
    assert.match(fp, /^[0-9a-f]{64}$/, 'Should produce valid fingerprint for empty arrays');
  });

  await t.test('computeFingerprint: undefined array fields treated as empty arrays', () => {
    const candidateLists1 = {
      newPendingGitAsync: [],
      newStreamRisk: [],
      newUnknown: [],
    };
    const candidateLists2 = {
      // newPendingGitAsync is undefined
      newStreamRisk: undefined,
      newUnknown: undefined,
    };
    const hmacKey = 'test-key';

    const fp1 = computeFingerprint(candidateLists1, hmacKey);
    const fp2 = computeFingerprint(candidateLists2, hmacKey);

    assert.strictEqual(fp1, fp2, 'Undefined arrays should be treated as empty');
  });

  await t.test('computeFingerprint: order normalization (uniqueSorted applies)', () => {
    const candidateLists1 = {
      newPendingGitAsync: ['funcB', 'funcA'],
      newStreamRisk: ['streamY', 'streamX'],
      newUnknown: ['unknownQ', 'unknownP'],
    };
    const candidateLists2 = {
      newPendingGitAsync: ['funcA', 'funcB'],
      newStreamRisk: ['streamX', 'streamY'],
      newUnknown: ['unknownP', 'unknownQ'],
    };
    const hmacKey = 'test-key';

    const fp1 = computeFingerprint(candidateLists1, hmacKey);
    const fp2 = computeFingerprint(candidateLists2, hmacKey);

    assert.strictEqual(fp1, fp2, 'Order should not affect fingerprint (uniqueSorted)');
  });

  // ======================
  // isValidBaseline tests
  // ======================
  await t.test('isValidBaseline: valid baseline returns true', () => {
    const baseline = {
      schema_version: 1,
      fingerprint: 'a'.repeat(64),
      counts: {
        newPendingGitAsync: 2,
        newStreamRisk: 1,
        newUnknown: 3,
      },
    };

    assert.ok(isValidBaseline(baseline), 'Valid baseline should return true');
  });

  await t.test('isValidBaseline: null or non-object returns false', () => {
    assert.ok(!isValidBaseline(null), 'null should return false');
    assert.ok(!isValidBaseline(undefined), 'undefined should return false');
    assert.ok(!isValidBaseline('string'), 'string should return false');
  });

  await t.test('isValidBaseline: missing schema_version returns false', () => {
    const baseline = {
      fingerprint: 'a'.repeat(64),
      counts: {
        newPendingGitAsync: 2,
        newStreamRisk: 1,
        newUnknown: 3,
      },
    };

    assert.ok(!isValidBaseline(baseline), 'Missing schema_version should return false');
  });

  await t.test('isValidBaseline: wrong schema_version returns false', () => {
    const baseline = {
      schema_version: 2,
      fingerprint: 'a'.repeat(64),
      counts: {
        newPendingGitAsync: 2,
        newStreamRisk: 1,
        newUnknown: 3,
      },
    };

    assert.ok(!isValidBaseline(baseline), 'schema_version !== 1 should return false');
  });

  await t.test('isValidBaseline: invalid fingerprint format returns false', () => {
    const invalidFingerprints = [
      'a'.repeat(63),  // too short
      'a'.repeat(65),  // too long
      'G' + 'a'.repeat(63),  // invalid hex char
      'a'.repeat(64).toUpperCase(),  // uppercase hex (invalid)
    ];

    for (const fp of invalidFingerprints) {
      const baseline = {
        schema_version: 1,
        fingerprint: fp,
        counts: {
          newPendingGitAsync: 2,
          newStreamRisk: 1,
          newUnknown: 3,
        },
      };
      assert.ok(!isValidBaseline(baseline), `Invalid fingerprint "${fp}" should return false`);
    }
  });

  await t.test('isValidBaseline: missing counts returns false', () => {
    const baseline = {
      schema_version: 1,
      fingerprint: 'a'.repeat(64),
    };

    assert.ok(!isValidBaseline(baseline), 'Missing counts should return false');
  });

  await t.test('isValidBaseline: counts not object returns false', () => {
    const baseline = {
      schema_version: 1,
      fingerprint: 'a'.repeat(64),
      counts: 'not-an-object',
    };

    assert.ok(!isValidBaseline(baseline), 'Non-object counts should return false');
  });

  await t.test('isValidBaseline: missing count keys returns false', () => {
    const baseline1 = {
      schema_version: 1,
      fingerprint: 'a'.repeat(64),
      counts: {
        newPendingGitAsync: 2,
        newStreamRisk: 1,
        // missing newUnknown
      },
    };

    assert.ok(!isValidBaseline(baseline1), 'Missing newUnknown key should return false');
  });

  await t.test('isValidBaseline: negative count values return false', () => {
    const baseline = {
      schema_version: 1,
      fingerprint: 'a'.repeat(64),
      counts: {
        newPendingGitAsync: 2,
        newStreamRisk: -1,  // negative
        newUnknown: 3,
      },
    };

    assert.ok(!isValidBaseline(baseline), 'Negative count should return false');
  });

  await t.test('isValidBaseline: non-number count values return false', () => {
    const baseline = {
      schema_version: 1,
      fingerprint: 'a'.repeat(64),
      counts: {
        newPendingGitAsync: 'two',  // string instead of number
        newStreamRisk: 1,
        newUnknown: 3,
      },
    };

    assert.ok(!isValidBaseline(baseline), 'Non-number count should return false');
  });

  // ======================
  // decideSafeMerge tests (7 required patterns)
  // ======================
  await t.test('decideSafeMerge: auditSkipped=true -> safeMerge=false, reason=audit_skipped', () => {
    const result = decideSafeMerge({
      updates: { newPendingGitAsync: [], newStreamRisk: [], newUnknown: [] },
      tokioPatchOk: true,
      auditSkipped: true,
      baseline: {
        schema_version: 1,
        fingerprint: 'a'.repeat(64),
        counts: { newPendingGitAsync: 0, newStreamRisk: 0, newUnknown: 0 },
      },
      hmacKey: 'test-key',
    });

    assert.deepStrictEqual(result, { safeMerge: false, reason: 'audit_skipped' });
  });

  await t.test('decideSafeMerge: tokioPatchOk=false -> safeMerge=false, reason=tokio_patch_not_ok', () => {
    const result = decideSafeMerge({
      updates: { newPendingGitAsync: [], newStreamRisk: [], newUnknown: [] },
      tokioPatchOk: false,  // key condition
      auditSkipped: false,
      baseline: {
        schema_version: 1,
        fingerprint: 'a'.repeat(64),
        counts: { newPendingGitAsync: 0, newStreamRisk: 0, newUnknown: 0 },
      },
      hmacKey: 'test-key',
    });

    assert.deepStrictEqual(result, { safeMerge: false, reason: 'tokio_patch_not_ok' });
  });

  await t.test('decideSafeMerge: hmacKey="" -> safeMerge=false, reason=hmac_key_missing', () => {
    const result = decideSafeMerge({
      updates: { newPendingGitAsync: [], newStreamRisk: [], newUnknown: [] },
      tokioPatchOk: true,
      auditSkipped: false,
      baseline: {
        schema_version: 1,
        fingerprint: 'a'.repeat(64),
        counts: { newPendingGitAsync: 0, newStreamRisk: 0, newUnknown: 0 },
      },
      hmacKey: '',  // empty string
    });

    assert.deepStrictEqual(result, { safeMerge: false, reason: 'hmac_key_missing' });
  });

  await t.test('decideSafeMerge: hmacKey=undefined -> safeMerge=false, reason=hmac_key_missing', () => {
    const result = decideSafeMerge({
      updates: { newPendingGitAsync: [], newStreamRisk: [], newUnknown: [] },
      tokioPatchOk: true,
      auditSkipped: false,
      baseline: {
        schema_version: 1,
        fingerprint: 'a'.repeat(64),
        counts: { newPendingGitAsync: 0, newStreamRisk: 0, newUnknown: 0 },
      },
      hmacKey: undefined,
    });

    assert.deepStrictEqual(result, { safeMerge: false, reason: 'hmac_key_missing' });
  });

  await t.test('decideSafeMerge: baseline=null -> safeMerge=false, reason=baseline_missing_or_invalid', () => {
    const result = decideSafeMerge({
      updates: { newPendingGitAsync: [], newStreamRisk: [], newUnknown: [] },
      tokioPatchOk: true,
      auditSkipped: false,
      baseline: null,
      hmacKey: 'test-key',
    });

    assert.deepStrictEqual(result, { safeMerge: false, reason: 'baseline_missing_or_invalid' });
  });

  await t.test('decideSafeMerge: baseline with invalid fingerprint -> safeMerge=false, reason=baseline_missing_or_invalid', () => {
    const result = decideSafeMerge({
      updates: { newPendingGitAsync: [], newStreamRisk: [], newUnknown: [] },
      tokioPatchOk: true,
      auditSkipped: false,
      baseline: {
        schema_version: 1,
        fingerprint: 'a'.repeat(32),  // too short, invalid
        counts: { newPendingGitAsync: 0, newStreamRisk: 0, newUnknown: 0 },
      },
      hmacKey: 'test-key',
    });

    assert.deepStrictEqual(result, { safeMerge: false, reason: 'baseline_missing_or_invalid' });
  });

  await t.test('decideSafeMerge: fingerprint mismatch -> safeMerge=false, reason=fingerprint_mismatch', () => {
    const updates = {
      newPendingGitAsync: ['funcA', 'funcB'],
      newStreamRisk: ['streamX'],
      newUnknown: ['unknownP'],
    };
    const hmacKey = 'test-key';
    const correctFingerprint = computeFingerprint(updates, hmacKey);
    const wrongFingerprint = 'b'.repeat(64);  // different fingerprint

    const result = decideSafeMerge({
      updates,
      tokioPatchOk: true,
      auditSkipped: false,
      baseline: {
        schema_version: 1,
        fingerprint: wrongFingerprint,  // not matching current updates
        counts: {
          newPendingGitAsync: 2,
          newStreamRisk: 1,
          newUnknown: 1,
        },
      },
      hmacKey,
    });

    assert.deepStrictEqual(result, { safeMerge: false, reason: 'fingerprint_mismatch' });
    assert.notStrictEqual(correctFingerprint, wrongFingerprint, 'Fingerprints should differ');
  });

  await t.test('decideSafeMerge: fingerprint matches baseline -> safeMerge=true, reason=matches_baseline', () => {
    const updates = {
      newPendingGitAsync: ['funcA', 'funcB'],
      newStreamRisk: ['streamX'],
      newUnknown: ['unknownP'],
    };
    const hmacKey = 'test-key';
    const correctFingerprint = computeFingerprint(updates, hmacKey);

    const result = decideSafeMerge({
      updates,
      tokioPatchOk: true,
      auditSkipped: false,
      baseline: {
        schema_version: 1,
        fingerprint: correctFingerprint,  // matching
        counts: {
          newPendingGitAsync: 2,
          newStreamRisk: 1,
          newUnknown: 1,
        },
      },
      hmacKey,
    });

    assert.deepStrictEqual(result, { safeMerge: true, reason: 'matches_baseline' });
  });

  // ======================
  // Regression tests: newUnknown exclusion from fingerprint (issue #30)
  // ======================
  await t.test('computeFingerprint: newUnknown difference does not affect fingerprint', () => {
    const candidateLists1 = {
      newPendingGitAsync: ['funcA', 'funcB'],
      newStreamRisk: ['streamX', 'streamY'],
      newUnknown: ['unknownP', 'unknownQ'],  // 2 items
    };
    const candidateLists2 = {
      newPendingGitAsync: ['funcA', 'funcB'],
      newStreamRisk: ['streamX', 'streamY'],
      newUnknown: ['unknownP', 'unknownQ', 'unknownR', 'unknownS', 'unknownT'],  // 5 items
    };
    const hmacKey = 'test-key';

    const fp1 = computeFingerprint(candidateLists1, hmacKey);
    const fp2 = computeFingerprint(candidateLists2, hmacKey);

    assert.strictEqual(fp1, fp2, 'Fingerprints should be identical even when newUnknown differs (issue #30)');
  });

  await t.test('decideSafeMerge: matches baseline even when newUnknown count differs', () => {
    const updates = {
      newPendingGitAsync: ['funcA', 'funcB'],
      newStreamRisk: ['streamX'],
      newUnknown: ['unknownP', 'unknownQ', 'unknownR'],  // 3 items in current
    };
    const hmacKey = 'test-key';
    const fingerprint = computeFingerprint(updates, hmacKey);

    const result = decideSafeMerge({
      updates,
      tokioPatchOk: true,
      auditSkipped: false,
      baseline: {
        schema_version: 1,
        fingerprint,
        counts: {
          newPendingGitAsync: 2,
          newStreamRisk: 1,
          newUnknown: 10,  // different from current (3 items), but should not affect safe-merge decision
        },
      },
      hmacKey,
    });

    assert.deepStrictEqual(result, { safeMerge: true, reason: 'matches_baseline' }, 'Should allow safe-merge when fingerprints match, regardless of newUnknown count difference');
  });
});
