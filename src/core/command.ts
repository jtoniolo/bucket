/**
 * Work Source Command templating.
 *
 * The Engine never talks to a Work Source directly (see CONTEXT.md); it runs
 * the opaque `list` / `view` / `close` command strings a Preset (or the Engine
 * defaults) supply. `view` and `close` operate on a single Task, so their
 * templates carry an `{id}` placeholder the Engine fills in before running.
 */

export interface CommandVars {
  id?: number | string;
}

/**
 * Substitute `{id}` in a Work Source Command template.
 *
 * @throws if the template references `{id}` but no id was provided.
 */
export function fillCommand(template: string, vars: CommandVars = {}): string {
  if (typeof template !== "string" || template.length === 0) {
    throw new Error("fillCommand: command template must be a non-empty string");
  }
  if (template.includes("{id}") && (vars.id === undefined || vars.id === null)) {
    throw new Error(
      `fillCommand: template needs an "{id}" but none was provided (template: "${template}")`,
    );
  }
  return template.replaceAll("{id}", vars.id === undefined ? "" : String(vars.id));
}
