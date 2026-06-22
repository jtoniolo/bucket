/**
 * Prompt template substitution.
 *
 * Phase prompts live as Markdown files in `prompts/` and get inlined into
 * the Workflow bundle at build time (ADR-0005 — the sandbox has no filesystem
 * access). At runtime the Workflow fills `{{VAR}}` placeholders from config
 * and per-Task values before passing the prompt to an agent.
 *
 * Uses double-brace `{{key}}` syntax so it never collides with the
 * single-brace `{id}` placeholders in Work Source Command templates.
 */

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string): string => {
    const val = vars[key];
    return val !== undefined ? val : "";
  });
}
