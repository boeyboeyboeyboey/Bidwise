// Minimal Node typings for the build-time data reader (lib/data/server.ts), instead of adding @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: { cwd(): string };
