/**
 * Umbrella apps and path dependencies become project references.
 * They stay out of the Hex dependency rows, so drift matches a scan of the
 * same mix.exs on its own.
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, makeProject } from './helpers.js';
import { FileCache } from '../src/core-open/utils/fs.js';
import type { ProjectScan } from '../src/core-open/types.js';

const { fetchHexVersionsBulk } = vi.hoisted(() => {
  const latest: Record<string, string> = {
    jason: '1.4.4',
    decimal: '2.3.0',
    plug: '1.17.0',
  };
  const fetchHexVersionsBulk = vi.fn(async (names: string[]) => {
    const results = new Map<string, string>();
    for (const name of names) {
      const version = latest[name];
      if (version) results.set(name, version);
    }
    return results;
  });
  return { fetchHexVersionsBulk };
});

vi.mock('../src/core-open/scanners/hex-cache.js', () => ({
  fetchHexVersionsBulk,
}));

import { scanElixir, scanElixirProjects } from '../src/core-open/scanners/elixir-scanner.js';

const fixture = fileURLToPath(new URL('./fixtures/elixir-umbrella/', import.meta.url));

function appMix(app: string, deps: string): string {
  return `defmodule ${app}.MixProject do
  use Mix.Project

  def project do
    [
      app: :${app},
      version: "0.1.0",
      elixir: "~> 1.15",
      deps: deps()
    ]
  end

  defp deps do
    [
${deps}
    ]
  end
end
`;
}

function umbrellaMix(appsPath: string | null, deps = '{:decimal, "~> 2.0"}'): string {
  const appsLine = appsPath === null ? '' : `apps_path: "${appsPath}",`;
  return `defmodule Umbrella.MixProject do
  use Mix.Project

  def project do
    [
      ${appsLine}
      version: "0.1.0",
      elixir: "~> 1.15",
      deps: deps()
    ]
  end

  defp deps do
    [
      ${deps}
    ]
  end
end
`;
}

function byPath(projects: ProjectScan[]): Map<string, ProjectScan> {
  return new Map(projects.map((project) => [project.path, project]));
}

function sortedProjects(projects: ProjectScan[]): ProjectScan[] {
  return [...projects].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

describe('Elixir umbrella and path project references', () => {
  const dirs: string[] = [];

  afterEach(() => {
    fetchHexVersionsBulk.mockClear();
    while (dirs.length) cleanup(dirs.pop()!);
  });

  async function scan(root: string): Promise<ProjectScan[]> {
    return scanElixirProjects(root, undefined, new FileCache(), undefined, true);
  }

  it('links in_umbrella and path deps without adding Hex rows', async () => {
    const first = await scan(fixture);
    const second = await scan(fixture);
    expect(sortedProjects(first)).toEqual(sortedProjects(second));

    const projects = byPath(first);
    expect([...projects.keys()].sort()).toEqual(['.', 'apps/core', 'apps/web', 'libs/logger_json']);

    const web = projects.get('apps/web');
    const core = projects.get('apps/core');
    expect(web?.projectReferences).toEqual([
      { path: 'apps/core', name: 'core', refType: 'workspace' },
    ]);
    expect(core?.projectReferences).toEqual([
      { path: 'libs/logger_json', name: 'logger_json', refType: 'workspace' },
    ]);
    expect(projects.get('.')?.projectReferences).toBeUndefined();
    expect(projects.get('libs/logger_json')?.projectReferences).toBeUndefined();

    const webAlone = await scanElixir(path.join(fixture, 'apps/web'), undefined, undefined, true);
    expect(webAlone).not.toBeNull();
    expect(web?.dependencies).toEqual(webAlone?.dependencies);
    expect(web?.dependencyAgeBuckets).toEqual(webAlone?.dependencyAgeBuckets);
    expect(web?.dependencies).toHaveLength(webAlone?.dependencies.length ?? -1);
    expect(web?.dependencies.map((dep) => dep.package)).toEqual(['jason']);
    expect(core?.dependencies.map((dep) => dep.package)).toEqual(['plug']);
    expect(projects.get('.')?.dependencies.map((dep) => dep.package)).toEqual(['decimal']);
    expect(projects.get('libs/logger_json')?.dependencies.map((dep) => dep.package)).toEqual(['jason']);

    const webBuckets = web?.dependencyAgeBuckets;
    expect(webBuckets).toBeDefined();
    expect(
      (webBuckets?.current ?? 0) + (webBuckets?.oneBehind ?? 0)
      + (webBuckets?.twoPlusBehind ?? 0) + (webBuckets?.unknown ?? 0),
    ).toBe(web?.dependencies.length);
  });

  it('resolves in_umbrella through apps_path, including the default', async () => {
    const custom = makeProject({
      'mix.exs': umbrellaMix('components'),
      'components/web/mix.exs': appMix('web', '      {:core, in_umbrella: true},\n      {:jason, "~> 1.4"}'),
      'components/core/mix.exs': appMix('core', '      {:plug, "~> 1.16"}'),
    });
    dirs.push(custom);
    const customProjects = byPath(await scan(custom));
    expect(customProjects.get('components/web')?.projectReferences).toEqual([
      { path: 'components/core', name: 'core', refType: 'workspace' },
    ]);
    expect(customProjects.get('components/web')?.dependencies).toHaveLength(1);

    const defaults = makeProject({
      'mix.exs': umbrellaMix(null),
      'apps/web/mix.exs': appMix('web', '      {:core, in_umbrella: true},\n      {:jason, "~> 1.4"}'),
      'apps/core/mix.exs': appMix('core', '      {:plug, "~> 1.16"}'),
    });
    dirs.push(defaults);
    const defaultProjects = byPath(await scan(defaults));
    expect(defaultProjects.get('apps/web')?.projectReferences).toEqual([
      { path: 'apps/core', name: 'core', refType: 'workspace' },
    ]);
    expect(defaultProjects.get('apps/web')?.dependencies).toHaveLength(1);
    expect(defaultProjects.get('.')?.dependencies).toHaveLength(1);

    const appsOnly = makeProject({
      'web/mix.exs': appMix('web', '      {:core, in_umbrella: true},\n      {:extra, path: "../extra"}'),
      'core/mix.exs': appMix('core', '      {:jason, "~> 1.4"}'),
      'extra/mix.exs': appMix('extra', '      {:plug, "~> 1.16"}'),
    });
    dirs.push(appsOnly);
    const siblingProjects = byPath(await scan(appsOnly));
    expect(siblingProjects.get('web')?.projectReferences).toEqual([
      { path: 'core', name: 'core', refType: 'workspace' },
      { path: 'extra', name: 'extra', refType: 'workspace' },
    ]);
    expect(siblingProjects.get('web')?.dependencies).toHaveLength(0);
    expect(siblingProjects.get('core')?.dependencies).toHaveLength(1);
  });
});
