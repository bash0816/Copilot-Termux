'use strict';

const crypto = require('crypto');
const { uniqueSorted } = require('./napi-audit.js');

// 署名対象は監査結果全体ではなく、以下3配列のみ。
// version/patchApplied/summary等、バージョンや実行状態に依存するフィールドは
// 意図的に一切含めない。これにより「内容が同一なら異なるバージョン間でも
// fingerprintが一致する」という設計目的(同一の未実装バックログが繰り返し検出される
// だけの状況ではsafe-mergeを許容する)を実現する。この cross-version reuse は
// バグではなく意図した挙動である(issue #30参照)。
function computeFingerprint(candidateLists, hmacKey) {
  if (!hmacKey) throw new Error('hmacKey is required and must be non-empty');
  if (!candidateLists || typeof candidateLists !== 'object') {
    throw new Error('candidateLists must be an object with newPendingGitAsync/newStreamRisk/newUnknown arrays');
  }
  const canonical = JSON.stringify({
    schema: 'napi-fingerprint-v1',
    newPendingGitAsync: uniqueSorted(candidateLists.newPendingGitAsync || []),
    newStreamRisk: uniqueSorted(candidateLists.newStreamRisk || []),
    newUnknown: uniqueSorted(candidateLists.newUnknown || []),
  });
  return crypto.createHmac('sha256', hmacKey).update(canonical).digest('hex');
}

function isValidBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object') return false;
  if (baseline.schema_version !== 1) return false;
  if (typeof baseline.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(baseline.fingerprint)) return false;
  if (!baseline.counts || typeof baseline.counts !== 'object') return false;
  const requiredCountKeys = ['newPendingGitAsync', 'newStreamRisk', 'newUnknown'];
  for (const k of requiredCountKeys) {
    if (typeof baseline.counts[k] !== 'number' || baseline.counts[k] < 0) return false;
  }
  return true;
}

// safe-merge判定表:
// audit_skipped=true                          -> safeMerge=false, reason='audit_skipped'
// tokioPatchOk!==true                         -> safeMerge=false, reason='tokio_patch_not_ok'
// hmacKey未設定                                -> safeMerge=false, reason='hmac_key_missing'
// baseline欠損/不正(isValidBaseline===false)   -> safeMerge=false, reason='baseline_missing_or_invalid'
// fingerprint不一致                            -> safeMerge=false, reason='fingerprint_mismatch'
// fingerprint一致                              -> safeMerge=true,  reason='matches_baseline'
function decideSafeMerge({ updates, tokioPatchOk, auditSkipped, baseline, hmacKey }) {
  if (auditSkipped) return { safeMerge: false, reason: 'audit_skipped' };
  if (tokioPatchOk !== true) return { safeMerge: false, reason: 'tokio_patch_not_ok' };
  if (!hmacKey) return { safeMerge: false, reason: 'hmac_key_missing' };
  if (!isValidBaseline(baseline)) return { safeMerge: false, reason: 'baseline_missing_or_invalid' };
  const currentFingerprint = computeFingerprint(updates, hmacKey);
  if (currentFingerprint !== baseline.fingerprint) return { safeMerge: false, reason: 'fingerprint_mismatch' };
  return { safeMerge: true, reason: 'matches_baseline' };
}

module.exports = { computeFingerprint, isValidBaseline, decideSafeMerge };
