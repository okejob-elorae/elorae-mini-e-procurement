import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogDrafts, resolveItemSku } from './map-catalog';
import type { JubelioItemsPayload } from './types';

describe('resolveItemSku', () => {
  it('uses family code when only one Jubelio group has that family', () => {
    assert.equal(resolveItemSku('100006', 50, 1), '100006');
  });

  it('appends Jubelio group id when family is shared', () => {
    assert.equal(resolveItemSku('240000', 109, 8), '240000-G109');
  });
});

describe('buildCatalogDrafts', () => {
  it('merges color style segments within one Jubelio group', () => {
    const payload: JubelioItemsPayload = {
      data: [
        {
          item_group_id: 109,
          item_name: 'Brenda Top',
          sell_price: '100000',
          variants: [
            {
              item_group_id: 109,
              item_id: 1,
              item_code: '24000040T-BLK-L',
              variation_values: [
                { label: 'Warna', value: 'Black' },
                { label: 'Ukuran', value: 'L' },
              ],
            },
            {
              item_group_id: 109,
              item_id: 2,
              item_code: '24000045T-NUD-M',
              variation_values: [
                { label: 'Warna', value: 'Nude' },
                { label: 'Ukuran', value: 'M' },
              ],
            },
          ],
        },
      ],
    };

    const { drafts, warnings } = buildCatalogDrafts(payload);
    assert.equal(warnings.length, 0);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].parentSku, '240000');
    assert.equal(drafts[0].itemSku, '240000');
    assert.equal(drafts[0].variants.length, 2);
    assert.deepEqual(
      drafts[0].variants.map((v) => v.sku).sort(),
      ['24000040T-L', '24000045T-M']
    );
  });
});
