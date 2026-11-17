// Compilation identifiers are intentionally unique; all other diagnostic fields
// must agree between independent executions through the public transports.
export function stableDiagnostics(errors) {
  return errors.map((error) => ({
    ...error,
    locations: error.locations.map((location) => ({
      ...location,
      source: location.role === "generated" ? "generated:template" : location.source,
    })),
  }));
}
