import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceListItem } from '@gatehouse/contract';
import {
  preferredWorkspace,
  preferredWorkspacePath,
  rememberWorkspaceId,
  workspaceIdFromPath,
  workspacePath,
  workspaceSuffix,
} from '../src/lib/workspace-routes';

function webSourceFiles(): string[] {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? visit(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
  return visit(root);
}

function workspace(id: string, status: WorkspaceListItem['status'], repositories = 0): WorkspaceListItem {
  return {
    id,
    status,
    repositories: Array.from({ length: repositories }, () => ({})) as WorkspaceListItem['repositories'],
  } as WorkspaceListItem;
}

describe('workspace route helpers', () => {
  let stored: string | null;

  beforeEach(() => {
    stored = null;
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_key: string, value: string) => { stored = value; },
      removeItem: () => { stored = null; },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('builds and parses workspace paths without leaking route state into the store', () => {
    expect(workspacePath('ws-1')).toBe('/w/ws-1');
    expect(workspacePath('ws-1', '/review/42')).toBe('/w/ws-1/review/42');
    expect(workspaceIdFromPath('/w/ws-1/review/42')).toBe('ws-1');
    expect(workspaceIdFromPath('/analytics')).toBeNull();
    expect(workspaceSuffix('/w/ws-1/review/42')).toBe('review/42');
  });

  it('prefers an active workspace with a repository and reuses an accessible remembered workspace', () => {
    const disabled = workspace('disabled', 'disabled', 3);
    const emptyActive = workspace('active-empty', 'active');
    const ready = workspace('ready', 'active', 1);

    expect(preferredWorkspace([disabled, emptyActive, ready])?.id).toBe('ready');
    rememberWorkspaceId('active-empty');
    expect(preferredWorkspacePath([disabled, emptyActive, ready], 'review')).toBe('/w/active-empty/review');
    rememberWorkspaceId('missing');
    expect(preferredWorkspacePath([disabled, emptyActive, ready])).toBe('/w/ready');
  });
});

describe('frontend architecture boundaries', () => {
  it('keeps router concerns out of the workspace state provider', () => {
    const source = readFileSync(new URL('../src/hooks/useWorkspace.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain("react-router-dom");
    expect(source).not.toContain('workspaceIdFromPath');
    expect(source).not.toContain('localStorage');
  });

  it('rejects legacy prop typing and any escapes in web source', () => {
    const violations = webSourceFiles().flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return /\bReact\.FC\b|\bPropTypes\b|:\s*any\b|\bas\s+any\b|<any>/u.test(source) ? [file] : [];
    });
    expect(violations).toEqual([]);
  });

  it('keeps the root App module as composition only and route definitions in the router', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const routes = readFileSync(new URL('../src/router/AppRoutes.tsx', import.meta.url), 'utf8');
    expect(app).not.toMatch(/<Routes|useLocation|useAuth|useWorkspace/);
    expect(routes).toContain('<Routes>');
    expect(routes).not.toContain('useWorkspace');
  });
});
