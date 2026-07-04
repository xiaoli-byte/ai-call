export const TASK_DESTINATION_PATTERN = /^\+?\d{3,15}$/;

export function isValidTaskDestination(value: string): boolean {
  return TASK_DESTINATION_PATTERN.test(value);
}
