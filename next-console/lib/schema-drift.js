/**
 * Schema drift detection for Webflow CMS payloads.
 * Validates lane page payloads against data/webflow_lanes_contract.json
 * to catch field additions, removals, type mismatches, and constraint violations.
 */
import contract from "@/data/webflow_lanes_contract.json";

/**
 * Validate a single CMS payload object against the contract.
 * @param {object} payload — the Webflow fieldData object
 * @returns {{ pass: boolean, violations: Array<{rule_id: string, field: string, detail: string, severity: string}> }}
 */
export function validatePayload(payload) {
  const result = runSchemaDriftCheck(payload);
  return { pass: result.pass, violations: result.violations };
}

/**
 * Check for unexpected fields not in the contract (drift detection).
 * @param {object} payload
 * @returns {string[]} — list of unknown field names
 */
export function detectUnknownFields(payload) {
  const contractFields = new Set(Object.keys(contract.fields));
  return Object.keys(payload).filter((key) => !contractFields.has(key));
}

/**
 * Check for missing required fields.
 * @param {object} payload
 * @returns {string[]} — list of missing required field names
 */
export function detectMissingRequired(payload) {
  const missing = [];
  for (const [field, spec] of Object.entries(contract.fields)) {
    if (spec.required && !(field in payload)) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Full schema drift check with structured violations.
 * Rule IDs:
 *   SD-MISSING-01: Required field missing
 *   SD-TYPE-01:    Field type mismatch
 *   SD-LENGTH-01:  Field length below minimum
 *   SD-LENGTH-02:  Field length above maximum
 *   SD-PATTERN-01: Field value doesn't match pattern
 *   SD-ENUM-01:    Field value not in allowed enum
 *   SD-UNKNOWN-01: Unknown field not in contract
 *
 * @param {object} payload
 * @returns {{ pass: boolean, violations: object[], contractVersion: string }}
 */
export function runSchemaDriftCheck(payload) {
  const violations = [];

  // ---- Check each contracted field ----
  for (const [field, spec] of Object.entries(contract.fields)) {
    const value = payload[field];

    // SD-MISSING-01 — required field missing
    if (spec.required && (value === undefined || value === null)) {
      violations.push({
        rule_id: "SD-MISSING-01",
        field,
        detail: `Required field "${field}" is missing from payload`,
        severity: "block",
      });
      // No further checks possible for a missing field
      continue;
    }

    // Skip remaining checks if field is absent and not required
    if (value === undefined || value === null) {
      continue;
    }

    // SD-TYPE-01 — type mismatch
    const expectedType = spec.type; // "string" | "richtext" | "number" | "option"
    if (expectedType === "number") {
      if (typeof value !== "number" || Number.isNaN(value)) {
        violations.push({
          rule_id: "SD-TYPE-01",
          field,
          detail: `Expected type "number" but got "${typeof value}"`,
          severity: "block",
        });
        continue; // skip further constraint checks on wrong type
      }
    } else if (
      expectedType === "string" ||
      expectedType === "richtext" ||
      expectedType === "option"
    ) {
      if (typeof value !== "string") {
        violations.push({
          rule_id: "SD-TYPE-01",
          field,
          detail: `Expected type "${expectedType}" but got "${typeof value}"`,
          severity: "block",
        });
        continue;
      }
    }

    // The remaining checks apply only to string-like values
    if (typeof value === "string") {
      // SD-LENGTH-01 — minLength
      if (
        spec.minLength !== undefined &&
        value.length < spec.minLength
      ) {
        violations.push({
          rule_id: "SD-LENGTH-01",
          field,
          detail: `Value length ${value.length} is below minimum ${spec.minLength}`,
          severity: "block",
        });
      }

      // SD-LENGTH-02 — maxLength
      if (
        spec.maxLength !== undefined &&
        value.length > spec.maxLength
      ) {
        violations.push({
          rule_id: "SD-LENGTH-02",
          field,
          detail: `Value length ${value.length} exceeds maximum ${spec.maxLength}`,
          severity: "block",
        });
      }

      // SD-PATTERN-01 — regex pattern
      if (spec.pattern !== undefined) {
        const re = new RegExp(spec.pattern);
        if (!re.test(value)) {
          violations.push({
            rule_id: "SD-PATTERN-01",
            field,
            detail: `Value does not match pattern ${spec.pattern}`,
            severity: "block",
          });
        }
      }

      // SD-ENUM-01 — enum values
      if (spec.enum !== undefined && !spec.enum.includes(value)) {
        violations.push({
          rule_id: "SD-ENUM-01",
          field,
          detail: `Value "${value}" is not in allowed enum [${spec.enum.join(", ")}]`,
          severity: "block",
        });
      }
    }
  }

  // ---- SD-UNKNOWN-01 — unknown fields not in contract ----
  const contractFields = new Set(Object.keys(contract.fields));
  for (const key of Object.keys(payload)) {
    if (!contractFields.has(key)) {
      violations.push({
        rule_id: "SD-UNKNOWN-01",
        field: key,
        detail: `Field "${key}" is not defined in the contract`,
        severity: "warn",
      });
    }
  }

  // pass = true only if zero "block" severity violations
  const pass = !violations.some((v) => v.severity === "block");

  return {
    pass,
    violations,
    contractVersion: contract.version,
  };
}
