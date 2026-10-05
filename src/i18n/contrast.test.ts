/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

const tokens = Object.fromEntries([...css.matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6});/gi)].map(match => [match[1], match[2]]));
const luminance = (hex: string) => {
  const rgb = hex.slice(1).match(/../g)!.map(pair => parseInt(pair, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const left = luminance(a); const right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
};

describe('text contrast on the theme surfaces', () => {
  it.each(['--gold-text', '--text', '--text-muted'])('%s meets 4.5:1 on every solid theme background', foreground => {
    for (const background of ['--bg-top', '--bg-mid', '--bg-accent', '--bg-bottom', '--surface']) {
      expect(contrast(tokens[foreground], tokens[background]), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('primary and selected dice labels keep 4.5:1 contrast on their bright fills', () => {
    for (const fill of ['--gold-button', '--gold-button-hover', '--gold-soft']) {
      expect(contrast(tokens['--accent-fg'], tokens[fill]), fill).toBeGreaterThanOrEqual(4.5);
    }
  });
});
