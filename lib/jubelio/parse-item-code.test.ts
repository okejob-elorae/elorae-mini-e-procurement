import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isVariantlessItemCode,
  parseFamilyCode,
  parseParentSku,
  parseStyleCode,
  parseStyleSegment,
  parseVariantSku,
} from './parse-item-code';

describe('parseParentSku (family)', () => {
  it('uses first 6 chars of style segment for multi-color lines', () => {
    assert.equal(parseParentSku('24000040T-BLK-L'), '240000');
    assert.equal(parseParentSku('24000045T-NUD-XL'), '240000');
    assert.equal(parseParentSku('24000041T-WHT-M'), '240000');
  });

  it('keeps short style segment as parent when <= 6 chars', () => {
    assert.equal(parseParentSku('240000-BLK-L'), '240000');
  });

  it('handles pants / other families', () => {
    assert.equal(parseParentSku('27000024P-BON-L'), '270000');
    assert.equal(parseParentSku('27000024PA-STN-M'), '270000');
  });
});

describe('parseVariantSku', () => {
  it('combines style segment and size, drops middle color code', () => {
    assert.equal(parseVariantSku('24000040T-BLK-L'), '24000040T-L');
    assert.equal(parseVariantSku('24000040T-BLK-M'), '24000040T-M');
    assert.equal(parseVariantSku('24000047T-CHA-S'), '24000047T-S');
    assert.equal(parseVariantSku('24000016T-CRM-L'), '24000016T-L');
  });

  it('returns full code when no hyphen', () => {
    assert.equal(parseVariantSku('SIMPLESKU'), 'SIMPLESKU');
    assert.equal(isVariantlessItemCode('SIMPLESKU'), true);
  });
});

describe('parseStyleSegment', () => {
  it('extracts first segment before hyphen', () => {
    assert.equal(parseStyleSegment('24000040T-BLK-L'), '24000040T');
  });
});

describe('style metadata', () => {
  it('parses family and style suffix', () => {
    assert.equal(parseFamilyCode('24000040T-BLK-L'), '240000');
    assert.equal(parseStyleCode('24000040T-BLK-L'), '40T');
  });
});
