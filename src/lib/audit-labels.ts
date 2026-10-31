/** Audit actions are dotted ("circle.created"); translation keys use underscores because dots nest. */
export function auditKey(action: string): string {
  return action.replaceAll(".", "_");
}
