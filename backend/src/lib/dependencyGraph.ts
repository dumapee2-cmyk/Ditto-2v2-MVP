/**
 * Dependency Graph — parses import statements to understand file relationships.
 *
 * Used by the refine flow to make intelligent decisions about which files
 * to include when editing a specific file:
 *   - Dependencies: files this file imports (need context for editing)
 *   - Dependents: files that import this file (may need updating if exports change)
 *
 * Handles:
 *   - ES module imports: import X from './Y', import { A } from './B'
 *   - Re-exports: export { X } from './Y'
 *   - Relative paths: ./components/Button → src/components/Button.tsx
 *   - Alias paths: @/components/Button → src/components/Button.tsx
 */

export interface ImportInfo {
  /** Raw import source as written: './Button', '@/hooks/useAuth' */
  source: string;
  /** Resolved file path (or null if external package) */
  resolved: string | null;
  /** Named imports: ['Button', 'ButtonProps'] */
  names: string[];
  /** Whether it's a default import */
  isDefault: boolean;
}

export interface DependencyNode {
  /** File path */
  path: string;
  /** Files this file imports (dependencies) */
  imports: ImportInfo[];
  /** Files that import this file (dependents) */
  importedBy: string[];
  /** Exported names from this file */
  exports: string[];
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
}

/**
 * Parse import statements from a source file.
 */
function parseImports(content: string): Array<{ source: string; names: string[]; isDefault: boolean }> {
  const imports: Array<{ source: string; names: string[]; isDefault: boolean }> = [];

  // Match: import X from 'source'
  // Match: import { A, B } from 'source'
  // Match: import X, { A, B } from 'source'
  // Match: import * as X from 'source'
  // Match: import 'source' (side-effect)
  // Match: export { A } from 'source'
  const importRegex = /(?:import|export)\s+(?:(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?(?:\*\s+as\s+(\w+))?)\s*from\s*['"]([^'"]+)['"]/g;
  const sideEffectRegex = /import\s+['"]([^'"]+)['"]/g;

  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const defaultImport = match[1] || null;
    const namedImports = match[2]
      ? match[2].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)
      : [];
    const namespaceImport = match[3] || null;
    const source = match[4];

    const names: string[] = [...namedImports];
    if (defaultImport) names.push(defaultImport);
    if (namespaceImport) names.push(namespaceImport);

    imports.push({
      source,
      names,
      isDefault: !!defaultImport,
    });
  }

  while ((match = sideEffectRegex.exec(content)) !== null) {
    // Only add if not already captured by the main regex
    const source = match[1];
    if (!imports.some(i => i.source === source)) {
      imports.push({ source, names: [], isDefault: false });
    }
  }

  return imports;
}

/**
 * Parse exported names from a source file.
 */
function parseExports(content: string): string[] {
  const exports: string[] = [];

  // export default function/class/const Name
  const defaultMatch = content.match(/export\s+default\s+(?:function|class|const)\s+(\w+)/g);
  if (defaultMatch) {
    for (const m of defaultMatch) {
      const name = m.match(/(\w+)$/)?.[1];
      if (name) exports.push(name);
    }
  }

  // export function/class/const Name
  const namedMatch = content.match(/export\s+(?:function|class|const|let|var|type|interface)\s+(\w+)/g);
  if (namedMatch) {
    for (const m of namedMatch) {
      const name = m.match(/(\w+)$/)?.[1];
      if (name && !exports.includes(name)) exports.push(name);
    }
  }

  // export { A, B, C }
  const bracketMatch = content.match(/export\s+\{([^}]+)\}/g);
  if (bracketMatch) {
    for (const m of bracketMatch) {
      const inner = m.match(/\{([^}]+)\}/)?.[1] ?? "";
      const names = inner.split(",").map(s => s.trim().split(/\s+as\s+/).pop()?.trim()).filter(Boolean);
      for (const name of names) {
        if (name && !exports.includes(name)) exports.push(name);
      }
    }
  }

  return exports;
}

/**
 * Resolve a relative or alias import to a file path in the project.
 */
function resolveImportPath(
  importSource: string,
  fromFile: string,
  allPaths: string[],
): string | null {
  // Skip external packages
  if (!importSource.startsWith(".") && !importSource.startsWith("@/")) {
    return null;
  }

  let basePath: string;

  if (importSource.startsWith("@/")) {
    // @/ alias → src/
    basePath = "src/" + importSource.slice(2);
  } else {
    // Relative import
    const fromDir = fromFile.split("/").slice(0, -1).join("/");
    const parts = importSource.split("/");
    const resolved: string[] = fromDir ? fromDir.split("/") : [];

    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") { resolved.pop(); continue; }
      resolved.push(part);
    }
    basePath = resolved.join("/");
  }

  // Try exact match, then with extensions
  const extensions = ["", ".tsx", ".ts", ".jsx", ".js", ".css"];
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (allPaths.includes(candidate)) return candidate;
  }

  // Try index file (import from directory)
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const candidate = basePath + "/index" + ext;
    if (allPaths.includes(candidate)) return candidate;
  }

  return null;
}

/**
 * Build a dependency graph from a map of file paths → contents.
 */
export function buildDependencyGraph(files: Record<string, string>): DependencyGraph {
  const allPaths = Object.keys(files);
  const nodes = new Map<string, DependencyNode>();

  // Initialize nodes
  for (const path of allPaths) {
    nodes.set(path, {
      path,
      imports: [],
      importedBy: [],
      exports: parseExports(files[path]),
    });
  }

  // Parse imports and build edges
  for (const [path, content] of Object.entries(files)) {
    const rawImports = parseImports(content);
    const node = nodes.get(path)!;

    for (const raw of rawImports) {
      const resolved = resolveImportPath(raw.source, path, allPaths);
      node.imports.push({
        source: raw.source,
        resolved,
        names: raw.names,
        isDefault: raw.isDefault,
      });

      // Register reverse edge (importedBy)
      if (resolved) {
        const depNode = nodes.get(resolved);
        if (depNode && !depNode.importedBy.includes(path)) {
          depNode.importedBy.push(path);
        }
      }
    }
  }

  return { nodes };
}

/**
 * Get all files impacted by changes to a given file.
 *
 * Returns the file's direct dependencies (files it imports) AND
 * its direct dependents (files that import it).
 * Does NOT recurse beyond 1 level to avoid pulling in the entire project.
 */
export function getImpactedFiles(graph: DependencyGraph, filePath: string): string[] {
  const node = graph.nodes.get(filePath);
  if (!node) return [];

  const impacted = new Set<string>();

  // Direct dependencies (files this file imports — needed for context)
  for (const imp of node.imports) {
    if (imp.resolved) impacted.add(imp.resolved);
  }

  // Direct dependents (files that import this file — may need updating)
  for (const dependent of node.importedBy) {
    impacted.add(dependent);
  }

  // Remove self
  impacted.delete(filePath);

  return [...impacted];
}
