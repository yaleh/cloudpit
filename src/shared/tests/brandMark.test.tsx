import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { test } from 'vitest';

import { BRAND } from '@/shared/constants';
import { BrandMark } from '@/shared/ui';

/** The size classes the two current consumers rely on (64px auth screens, 56px consent page). */
test('brand mark renders the logo as its own tile at the requested size', () => {
  const { container, rerender } = render(<BrandMark />);
  const image = container.querySelector('img');

  assert.ok(image instanceof HTMLImageElement, 'the mark is the logo image itself');
  assert.equal(image.getAttribute('src'), '/logo.svg');
  assert.equal(image.getAttribute('alt'), BRAND.name);
  assert.match(image.className, /\bh-16 w-16\b/);
  assert.match(image.className, /\brounded-2xl\b/);
  // The artwork already carries its navy field; an accent-colored wrapper is the defect
  // this component replaced (a bright-blue frame around the navy square).
  assert.doesNotMatch(image.className, /bg-gradient-to-br|from-primary/);

  rerender(<BrandMark size="sm" />);
  const compact = container.querySelector('img');
  assert.ok(compact instanceof HTMLImageElement);
  assert.match(compact.className, /\bh-14 w-14\b/);
});
