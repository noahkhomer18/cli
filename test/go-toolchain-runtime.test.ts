/**
 * The Go runtime is the `go` directive, unless a top-level `toolchain`
 * major.minor is numerically newer. Lag and end-of-life use that same version.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GoCache } from '../src/core-open/scanners/go-cache.js';
import { scanGoProjects } from '../src/core-open/scanners/go-scanner.js';
import type { RuntimeCatalog } from '../src/core-open/runtimes/types.js';
import type { ProjectScan } from '../src/core-open/types.js';
import { Semaphore } from '../src/core-open/utils/semaphore.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** Newest released cycle is 1.25. 1.23 and 1.21 are already end-of-life; 1.25 is not. */
const catalog: RuntimeCatalog = {
  generatedAt: '2020-01-01T00:00:00.000Z',
  source: 'endoflife.date',
  products: {
    go: {
      product: 'go',
      cycles: [
        { cycle: '1.25', releaseDate: '2025-08-13', eol: '2027-08-13' },
        { cycle: '1.23', releaseDate: '2024-08-13', eol: '2025-08-13' },
        { cycle: '1.21', releaseDate: '2023-08-08', eol: '2024-08-13' },
        { cycle: '1.9', releaseDate: '2017-08-24', eol: '2018-08-24' },
      ],
    },
  },
};

async function scan(goMod: string): Promise<ProjectScan> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-go-toolchain-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'go.mod'), goMod);
  const projects = await scanGoProjects(root, new GoCache(new Semaphore(1), undefined, true), undefined, undefined, catalog);
  expect(projects).toHaveLength(1);
  return projects[0]!;
}

function runtimeOf(project: ProjectScan) {
  return {
    runtime: project.runtime,
    runtimeLatest: project.runtimeLatest,
    runtimeMajorsBehind: project.runtimeMajorsBehind,
    runtimeEol: project.runtimeEol,
    runtimeEolDate: project.runtimeEolDate,
  };
}

describe('go.mod toolchain directive', () => {
  it('keeps the go directive when there is no toolchain line', async () => {
    const project = await scan(`module example.com/app

go 1.21

require example.com/dep v1.2.3
`);
    expect(runtimeOf(project)).toEqual({
      runtime: '1.21',
      runtimeLatest: '1.25',
      runtimeMajorsBehind: 4,
      runtimeEol: true,
      runtimeEolDate: '2024-08-13',
    });
    expect(project.dependencies.map((d) => d.package)).toEqual(['example.com/dep']);
  });

  it('reports a newer toolchain for runtime, lag, and end-of-life', async () => {
    const goMod = `module example.com/app

go 1.21

toolchain go1.23.4

require example.com/dep v1.2.3
`;
    const first = await scan(goMod);
    const second = await scan(goMod);
    expect(runtimeOf(first)).toEqual(runtimeOf(second));
    expect(runtimeOf(first)).toEqual({
      runtime: '1.23',
      runtimeLatest: '1.25',
      runtimeMajorsBehind: 2,
      runtimeEol: true,
      runtimeEolDate: '2025-08-13',
    });
    expect(first.dependencies.map((d) => ({ package: d.package, currentSpec: d.currentSpec }))).toEqual([
      { package: 'example.com/dep', currentSpec: 'v1.2.3' },
    ]);
  });

  it('ignores toolchain default and keeps the go version', async () => {
    const project = await scan(`module example.com/app

go 1.21

toolchain default
`);
    expect(runtimeOf(project)).toEqual({
      runtime: '1.21',
      runtimeLatest: '1.25',
      runtimeMajorsBehind: 4,
      runtimeEol: true,
      runtimeEolDate: '2024-08-13',
    });
  });

  it('ignores a malformed toolchain value', async () => {
    const project = await scan(`module example.com/app

go 1.21

toolchain go1

toolchain not-a-version
`);
    expect(runtimeOf(project)).toEqual({
      runtime: '1.21',
      runtimeLatest: '1.25',
      runtimeMajorsBehind: 4,
      runtimeEol: true,
      runtimeEolDate: '2024-08-13',
    });
  });

  it('keeps the go version when the toolchain is not numerically newer', async () => {
    const older = await scan(`module example.com/app

go 1.21

toolchain go1.9.0
`);
    const same = await scan(`module example.com/app

go 1.21

toolchain go1.21.9
`);
    expect(runtimeOf(older).runtime).toBe('1.21');
    expect(runtimeOf(older)).toMatchObject({
      runtimeLatest: '1.25',
      runtimeMajorsBehind: 4,
      runtimeEol: true,
      runtimeEolDate: '2024-08-13',
    });
    expect(runtimeOf(same)).toEqual(runtimeOf(older));
  });

  it('uses the toolchain version when the file has no go line', async () => {
    const project = await scan(`module example.com/app

toolchain go1.23.4
`);
    expect(runtimeOf(project)).toEqual({
      runtime: '1.23',
      runtimeLatest: '1.25',
      runtimeMajorsBehind: 2,
      runtimeEol: true,
      runtimeEolDate: '2025-08-13',
    });
  });

  it('ignores a toolchain line inside a block', async () => {
    const project = await scan(`module example.com/app

go 1.21

require (
	toolchain go1.23.4
	example.com/dep v1.2.3
)

exclude (
	toolchain go1.24.1
)

retract (
	toolchain go1.25.0
)
`);
    expect(runtimeOf(project)).toEqual({
      runtime: '1.21',
      runtimeLatest: '1.25',
      runtimeMajorsBehind: 4,
      runtimeEol: true,
      runtimeEolDate: '2024-08-13',
    });
    expect(project.dependencies.map((d) => d.package)).toEqual(['example.com/dep']);
  });
});
