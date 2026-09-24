import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WP_SITE_URL = 'https://blog.theseniorlivingexperience.com';
process.env.FACILITY_SITE_URL = 'https://www.avibrantliving.com';

const { config } = await import('../src/config.js');
const { isInternal, isSourceDomain } = await import('../src/validate.js');

test('blog and facility site on different domains', () => {
  assert.equal(config.facility.servicesUrl, 'https://www.avibrantliving.com/services/');
  assert.equal(config.facility.contactUrl, 'https://www.avibrantliving.com/contact/');
  assert.ok(isInternal('https://www.avibrantliving.com/services/'));
  assert.ok(isInternal('https://blog.theseniorlivingexperience.com/other-post/'));
  assert.ok(!isInternal('https://example.com/'));
  assert.ok(isSourceDomain('https://www.nia.nih.gov/health'));
});
