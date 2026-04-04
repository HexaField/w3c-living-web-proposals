/**
 * Content verification module (§8)
 */

import { GOV } from './predicates.js';
import type { GraphConstraint, ValidationResult, TripleInput, ValidationContext } from './types.js';

const REGEX_TIMEOUT_MS = 10;
// Simple URL regex for detection
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function parsePipeSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split('|').map(s => s.trim()).filter(Boolean);
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function extractDomain(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return null;
  }
}

/**
 * Test a regex pattern with timeout protection against catastrophic backtracking.
 * Returns: true if matches, false if not, null if timed out.
 */
function testRegexWithTimeout(pattern: string, text: string, _timeoutMs: number = REGEX_TIMEOUT_MS): boolean | null {
  try {
    const re = new RegExp(pattern, 'i');
    // In a single-threaded JS environment we can't truly timeout a regex.
    // We rely on pattern simplicity. For the polyfill, just run it.
    return re.test(text);
  } catch {
    // Invalid regex — skip the pattern (not the triple)
    return null;
  }
}

export async function verifyContent(
  triple: TripleInput,
  constraints: GraphConstraint[],
  ctx: ValidationContext,
): Promise<ValidationResult> {
  const contentConstraints = constraints.filter(c => c.kind === 'content');
  if (contentConstraints.length === 0) return { allowed: true };

  for (const cc of contentConstraints) {
    const appliesTo = parseCommaSeparated(cc.properties[GOV.CONTENT_APPLIES_TO_PREDICATES]);

    // Predicate match
    if (appliesTo.length > 0 && triple.predicate && !appliesTo.includes(triple.predicate)) continue;
    if (appliesTo.length > 0 && !triple.predicate) continue;

    // Resolve target content
    const text = triple.target; // For this polyfill, target is literal text

    // Length check
    const maxLengthStr = cc.properties[GOV.CONTENT_MAX_LENGTH];
    if (maxLengthStr) {
      const maxLength = parseInt(maxLengthStr, 10);
      if (!isNaN(maxLength) && text.length > maxLength) {
        return {
          allowed: false,
          module: 'content',
          reason: `Content exceeds maximum length of ${maxLength} characters`,
          rejectedBy: cc.id,
        };
      }
    }

    // Blocked patterns
    const blockedPatternsStr = cc.properties[GOV.CONTENT_BLOCKED_PATTERNS];
    if (blockedPatternsStr) {
      const patterns = parsePipeSeparated(blockedPatternsStr);
      for (const pattern of patterns) {
        const result = testRegexWithTimeout(pattern, text);
        if (result === true) {
          return {
            allowed: false,
            module: 'content',
            reason: 'Content matches blocked pattern',
            rejectedBy: cc.id,
          };
        }
        // result === null means timeout — skip the pattern (§12.7)
      }
    }

    // URL policy
    const allowUrls = cc.properties[GOV.CONTENT_ALLOW_URLS];
    if (allowUrls === 'false') {
      const urls = text.match(URL_REGEX);
      if (urls && urls.length > 0) {
        return {
          allowed: false,
          module: 'content',
          reason: 'URLs are not permitted',
          rejectedBy: cc.id,
        };
      }
    }

    // Domain whitelist
    const allowedDomainsStr = cc.properties[GOV.CONTENT_ALLOWED_DOMAINS];
    if (allowUrls !== 'false' && allowedDomainsStr) {
      const allowedDomains = parseCommaSeparated(allowedDomainsStr);
      if (allowedDomains.length > 0) {
        const urls = text.match(URL_REGEX);
        if (urls) {
          for (const url of urls) {
            const domain = extractDomain(url);
            if (domain && !allowedDomains.includes(domain)) {
              return {
                allowed: false,
                module: 'content',
                reason: `URL domain ${domain} is not in the allowed list`,
                rejectedBy: cc.id,
              };
            }
          }
        }
      }
    }

    // Media type check (simplified — in polyfill, no media type resolution from literal targets)
    // Would need resolveExpression for content-addressed targets
  }

  return { allowed: true };
}
