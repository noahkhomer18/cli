import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { scanNodeProjects } from '../src/core-open/scanners/node-scanner.js';
import {
  isSemverSpec,
  parseNpmAliasSpec,
  resolveNpmDependencySpec,
  NpmCache,
} from '../src/core-open/scanners/npm-cache.js';
import { Semaphore } from '../src/core-open/utils/semaphore.js';
import type { PackageVersionManifest } from '../src/core-open/package-version-manifest.js';
import type { DependencyRow } from '../src/core-open/types.js';

const MANIFEST: PackageVersionManifest = {
  npm: {
    // Decoy: fetching the alias name instead of the target would report this.
    'string-width-cjs': { latest: '0.0.1', versions: ['0.0.1'] },
    'scoped-ui': { latest: '0.0.1', versions: ['0.0.1'] },
    'react-17': { latest: '0.0.1', versions: ['0.0.1'] },
    'chalk-alias': { latest: '0.0.1', versions: ['0.0.1'] },
    'string-width': { latest: '5.1.0', versions: ['4.2.0', '4.2.3', '5.0.0', '5.1.0'] },
    '@isaacs/cliui': { latest: '9.0.0', versions: ['8.0.0', '8.0.2', '9.0.0'] },
    react: { latest: '18.3.1', versions: ['17.0.2', '18.2.0', '18.3.1'] },
    chalk: { latest: '5.3.0', versions: ['4.1.2', '5.3.0'] },
    'left-pad': { latest: '1.3.0', versions: ['1.1.0', '1.2.0', '1.3.0'] },
  },
};

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'vibgrate-npm-alias-'));
  dirs.push(dir);
  await Promise.all(
    Object.entries(files).map(async ([name, text]) => {
      const file = path.join(dir, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
    }),
  );
  return dir;
}

async function scan(dir: string) {
  const cache = new NpmCache(dir, new Semaphore(1), MANIFEST, true);
  const projects = await scanNodeProjects(dir, cache);
  expect(projects).toHaveLength(1);
  return projects[0]!;
}

function row(rows: DependencyRow[], name: string): DependencyRow {
  const found = rows.find((dep) => dep.package === name);
  expect(found, name).toBeTruthy();
  return found!;
}

const PACKAGE_JSON = JSON.stringify({
  name: 'alias-fixture',
  version: '1.0.0',
  dependencies: {
    'string-width-cjs': 'npm:string-width@^4.2.0',
    'react-17': 'npm:react@^17.0.2',
    'chalk-alias': 'npm:chalk',
    'left-pad': '^1.1.0',
    local: 'file:../local',
    'workspace-lib': 'workspace:*',
  },
  devDependencies: {
    'scoped-ui': 'npm:@isaacs/cliui@^8',
  },
});

describe('npm alias specs', () => {
  it('parses plain, scoped, and rangeless aliases', () => {
    expect(parseNpmAliasSpec('npm:string-width@^4.2.0')).toEqual({
      package: 'string-width',
      range: '^4.2.0',
    });
    expect(parseNpmAliasSpec('npm:@scope/pkg@^1')).toEqual({ package: '@scope/pkg', range: '^1' });
    expect(parseNpmAliasSpec('npm:pkg')).toEqual({ package: 'pkg', range: '*' });
    expect(parseNpmAliasSpec('npm:@scope/pkg')).toEqual({ package: '@scope/pkg', range: '*' });
    expect(parseNpmAliasSpec('  npm:pkg@latest  ')).toEqual({ package: 'pkg', range: 'latest' });
    expect(parseNpmAliasSpec('^1.2.0')).toBeNull();
    expect(parseNpmAliasSpec('npm:^1.2.0')).toBeNull();
    expect(parseNpmAliasSpec('npm:pkg@')).toBeNull();
    expect(parseNpmAliasSpec('npm:@scope')).toBeNull();

    expect(isSemverSpec('npm:string-width@^4.2.0')).toBe(true);
    expect(isSemverSpec('npm:@scope/pkg@^1')).toBe(true);
    expect(isSemverSpec('npm:pkg')).toBe(true);
    expect(isSemverSpec('npm:@scope/pkg')).toBe(true);
    expect(isSemverSpec('npm:pkg@latest')).toBe(true);
    expect(isSemverSpec('npm:pkg@*')).toBe(true);
    expect(isSemverSpec('npm:pkg@file:../x')).toBe(false);
    expect(isSemverSpec('npm:pkg@workspace:*')).toBe(false);
    expect(isSemverSpec('npm:^4.17.21')).toBe(false);

    expect(isSemverSpec('^1.2.0')).toBe(true);
    expect(isSemverSpec('*')).toBe(true);
    expect(isSemverSpec('latest')).toBe(true);
    expect(isSemverSpec('workspace:*')).toBe(false);
    expect(isSemverSpec('file:../x')).toBe(false);
    expect(isSemverSpec('link:../x')).toBe(false);
    expect(isSemverSpec('git+https://example.com/a.git')).toBe(false);
    expect(isSemverSpec('github:foo/bar')).toBe(false);
    expect(isSemverSpec('https://example.com/pkg.tgz')).toBe(false);

    expect(resolveNpmDependencySpec('string-width-cjs', 'npm:string-width@^4.2.0')).toEqual({
      package: 'string-width',
      range: '^4.2.0',
      alias: true,
    });
    expect(resolveNpmDependencySpec('left-pad', '^1.1.0')).toEqual({
      package: 'left-pad',
      range: '^1.1.0',
      alias: false,
    });
  });

  it('scores plain and scoped aliases against the target and keeps the manifest name', async () => {
    const dir = await writeProject({ 'package.json': PACKAGE_JSON });
    const project = await scan(dir);
    const width = row(project.dependencies, 'string-width-cjs');
    const scoped = row(project.dependencies, 'scoped-ui');
    const chalk = row(project.dependencies, 'chalk-alias');
    const react = row(project.dependencies, 'react-17');
    const leftPad = row(project.dependencies, 'left-pad');

    expect(width).toMatchObject({
      package: 'string-width-cjs',
      registryPackage: 'string-width',
      section: 'dependencies',
      currentSpec: 'npm:string-width@^4.2.0',
      resolvedVersion: '4.2.3',
      latestSatisfying: '4.2.3',
      latestStable: '5.1.0',
      majorsBehind: 1,
      drift: 'major-behind',
    });
    expect(scoped).toMatchObject({
      package: 'scoped-ui',
      registryPackage: '@isaacs/cliui',
      section: 'devDependencies',
      currentSpec: 'npm:@isaacs/cliui@^8',
      resolvedVersion: '8.0.2',
      latestSatisfying: '8.0.2',
      latestStable: '9.0.0',
      majorsBehind: 1,
      drift: 'major-behind',
    });
    expect(chalk).toMatchObject({
      package: 'chalk-alias',
      registryPackage: 'chalk',
      currentSpec: 'npm:chalk',
      resolvedVersion: '5.3.0',
      latestSatisfying: '5.3.0',
      latestStable: '5.3.0',
      drift: 'current',
    });
    expect(react).toMatchObject({
      registryPackage: 'react',
      currentSpec: 'npm:react@^17.0.2',
      resolvedVersion: '17.0.2',
      latestSatisfying: '17.0.2',
      latestStable: '18.3.1',
      drift: 'major-behind',
    });
    expect(leftPad).toMatchObject({
      package: 'left-pad',
      section: 'dependencies',
      currentSpec: '^1.1.0',
      resolvedVersion: '1.3.0',
      latestSatisfying: '1.3.0',
      latestStable: '1.3.0',
      majorsBehind: 0,
      drift: 'current',
    });
    expect(leftPad.registryPackage).toBeUndefined();
    expect(project.dependencies.find((dep) => dep.package === 'local')).toBeUndefined();
    expect(row(project.dependencies, 'workspace-lib')).toMatchObject({
      currentSpec: 'workspace:*',
      resolvedVersion: null,
      drift: 'unknown',
    });
    expect(project.frameworks.map((fw) => fw.name)).toEqual(['React']);
  });

  it('keeps a lockfile hit on the alias name and ignores a lock outside the target range', async () => {
    const dir = await writeProject({
      'package.json': PACKAGE_JSON,
      'package-lock.json': JSON.stringify({
        name: 'alias-fixture',
        lockfileVersion: 3,
        packages: {
          '': { name: 'alias-fixture' },
          'node_modules/string-width-cjs': { name: 'string-width', version: '4.2.0' },
          'node_modules/scoped-ui': { name: '@isaacs/cliui', version: '8.0.0' },
          'node_modules/chalk-alias': { name: 'chalk', version: '4.1.2' },
          'node_modules/react-17': { name: 'react', version: '18.2.0' },
          'node_modules/left-pad': { version: '1.2.0' },
        },
      }),
    });
    const project = await scan(dir);

    expect(row(project.dependencies, 'string-width-cjs')).toMatchObject({
      registryPackage: 'string-width',
      currentSpec: 'npm:string-width@^4.2.0',
      resolvedVersion: '4.2.0',
      latestSatisfying: '4.2.3',
      latestStable: '5.1.0',
      drift: 'major-behind',
    });
    expect(row(project.dependencies, 'scoped-ui')).toMatchObject({
      registryPackage: '@isaacs/cliui',
      resolvedVersion: '8.0.0',
      latestSatisfying: '8.0.2',
    });
    expect(row(project.dependencies, 'chalk-alias')).toMatchObject({
      registryPackage: 'chalk',
      currentSpec: 'npm:chalk',
      resolvedVersion: '4.1.2',
      latestSatisfying: '5.3.0',
      drift: 'major-behind',
    });
    // 18.2.0 is installed under the alias path but does not satisfy ^17.0.2.
    expect(row(project.dependencies, 'react-17')).toMatchObject({
      registryPackage: 'react',
      resolvedVersion: '17.0.2',
      latestSatisfying: '17.0.2',
      latestStable: '18.3.1',
    });
    expect(row(project.dependencies, 'left-pad')).toMatchObject({
      currentSpec: '^1.1.0',
      resolvedVersion: '1.2.0',
      latestSatisfying: '1.3.0',
      latestStable: '1.3.0',
      majorsBehind: 0,
      drift: 'minor-behind',
    });
    expect(row(project.dependencies, 'left-pad').registryPackage).toBeUndefined();
  });

  it('reads a pnpm lock entry by the alias name', async () => {
    const dir = await writeProject({
      'package.json': JSON.stringify({
        name: 'alias-fixture',
        dependencies: { 'string-width-cjs': 'npm:string-width@^4.2.0' },
      }),
      'pnpm-lock.yaml': [
        "lockfileVersion: '9.0'",
        'importers:',
        '  .:',
        '    dependencies:',
        '      string-width-cjs:',
        '        specifier: npm:string-width@^4.2.0',
        '        version: 4.2.0',
        '',
      ].join('\n'),
    });
    const project = await scan(dir);
    expect(project.dependencies).toHaveLength(1);
    expect(project.dependencies[0]).toMatchObject({
      package: 'string-width-cjs',
      registryPackage: 'string-width',
      currentSpec: 'npm:string-width@^4.2.0',
      resolvedVersion: '4.2.0',
      latestSatisfying: '4.2.3',
      latestStable: '5.1.0',
    });
  });

  it('reads a yarn lock entry by the alias spec', async () => {
    const dir = await writeProject({
      'package.json': JSON.stringify({
        name: 'alias-fixture',
        dependencies: { 'string-width-cjs': 'npm:string-width@^4.2.0' },
      }),
      'yarn.lock': [
        'string-width-cjs@npm:string-width@^4.2.0:',
        '  version "4.2.0"',
        '  resolved "https://registry.yarnpkg.com/string-width/-/string-width-4.2.0.tgz"',
        '',
      ].join('\n'),
    });
    const project = await scan(dir);
    expect(project.dependencies[0]).toMatchObject({
      package: 'string-width-cjs',
      registryPackage: 'string-width',
      currentSpec: 'npm:string-width@^4.2.0',
      resolvedVersion: '4.2.0',
    });
  });
});
