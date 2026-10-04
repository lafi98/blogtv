// Shared helpers for CLI scripts (run with `tsx`, from the project root).
export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split('=').slice(1).join('=');
}
export const flag = (name: string) => process.argv.includes(`--${name}`);
