/**
 * Validation test for apps.ts translation files (Activity page).
 *
 * Verifies:
 * 1. EN and ZH apps.ts have the same keys
 * 2. All required keys are present
 * 3. Nav files have updated nav.apps key
 * 4. i18next {{var}} format is used (not {var})
 */

import { describe, it, expect } from 'vitest';
import enApps from '../locales/en/apps';
import zhApps from '../locales/zh/apps';
import enNav from '../locales/en/nav';
import zhNav from '../locales/zh/nav';

describe('apps translations', () => {
  const requiredKeys = [
    'apps.title',
    'apps.activityTitle',
    'apps.subtitle',
    'apps.empty',
    'apps.emptyDesc',
    'apps.search',
    'apps.filterAll',
    'apps.filterEdit',
    'apps.filterWrite',
    'apps.jumpToSession',
    'apps.filesCount',
    'apps.opsCount',
    'apps.opsDetail',
    'apps.wrote',
    'apps.loading',
    'apps.loadError',
    'apps.noResults',
    // CreateAppDialog keys
    'apps.createTitle',
    'apps.workingDir',
    'apps.workingDirHint',
    'apps.workingDirPlaceholder',
    'apps.dirRequired',
    'apps.dirMustBeAbsolute',
    'apps.browse',
    'apps.descLabel',
    'apps.createPlaceholder',
    'apps.descPlaceholderShort',
    'apps.startCreate',
    // DirectoryBrowser keys
    'apps.selectDirectory',
    'apps.enterPathPlaceholder',
    'apps.noSubDirs',
    'apps.selectThisDir',
  ] as const;

  it('EN has all required keys', () => {
    const enKeys = Object.keys(enApps);
    for (const key of requiredKeys) {
      expect(enKeys).toContain(key);
    }
  });

  it('ZH has all required keys', () => {
    const zhKeys = Object.keys(zhApps);
    for (const key of requiredKeys) {
      expect(zhKeys).toContain(key);
    }
  });

  it('EN and ZH have exactly the same keys', () => {
    const enKeys = Object.keys(enApps).sort();
    const zhKeys = Object.keys(zhApps).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('title values are correct', () => {
    expect(enApps['apps.title']).toBe('Activity');
    expect(zhApps['apps.title']).toBe('活动');
  });

  it('nav.apps values are correct', () => {
    expect(enNav['nav.apps']).toBe('Activity');
    expect(zhNav['nav.apps']).toBe('活动');
  });

  it('uses {{var}} format (not {var}) for i18next interpolation', () => {
    const allValues = [
      ...Object.values(enApps),
      ...Object.values(zhApps),
    ];
    for (const val of allValues) {
      const singleBrace = val.match(/(?<!\{)\{[a-zA-Z]+\}(?!\})/);
      if (singleBrace) {
        throw new Error(`Found single-brace param in: "${val}" — should use {{var}} format`);
      }
    }
  });

  it('no old app factory keys remain', () => {
    const oldKeys = ['apps.create', 'apps.createFirst', 'apps.publish', 'apps.delete'];
    for (const key of oldKeys) {
      expect(key in enApps).toBe(false);
      expect(key in zhApps).toBe(false);
    }
  });
});
