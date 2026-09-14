/** Resolves the URL-backed library tab without leaking query parsing into the
 * two independently stateful list views. */
export function templateListKind(value) {
  return value === "html" ? "html" : "manual";
}
