/**
 * Content constraint handler — length, blocked patterns, URL/domain policies.
 */

import type {
  ConstraintHandler,
  GraphConstraint,
  GovernanceValidationResult,
  TripleInput,
  ValidationContext,
} from '@living-web/capability-framework';
import { VOCAB } from './predicates.js';

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

function parseCommaSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function parsePipeSeparated(val: string | undefined): string[] {
  if (!val || val.trim() === '') return [];
  return val.split('|').map(s => s.trim()).filter(Boolean);
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function testRegex(pattern: string, text: string): boolean | null {
  try {
    return new RegExp(pattern, 'i').test(text);
  } catch {
    return null;
  }
}

export const contentConstraintHandler: ConstraintHandler = {
  kind: 'content',

  async validate(
    triple: TripleInput,
    constraint: GraphConstraint,
    _ctx: ValidationContext,
  ): Promise<GovernanceValidationResult> {
    const appliesTo = parseCommaSeparated(constraint.properties[VOCAB.CONTENT_APPLIES_TO_PREDICATES]);

    if (appliesTo.length > 0 && triple.predicate && !appliesTo.includes(triple.predicate)) {
      return { allowed: true };
    }
    if (appliesTo.length > 0 && !triple.predicate) return { allowed: true };

    const text = triple.object;

    const maxLengthStr = constraint.properties[VOCAB.CONTENT_MAX_LENGTH];
    if (maxLengthStr) {
      const maxLength = parseInt(maxLengthStr, 10);
      if (!isNaN(maxLength) && text.length > maxLength) {
        return {
          allowed: false,
          module: 'content',
          reason: `Content exceeds maximum length of ${maxLength} characters`,
          rejectedBy: constraint.id,
        };
      }
    }

    const blockedPatternsStr = constraint.properties[VOCAB.CONTENT_BLOCKED_PATTERNS];
    if (blockedPatternsStr) {
      const patterns = parsePipeSeparated(blockedPatternsStr);
      for (const pattern of patterns) {
        if (testRegex(pattern, text) === true) {
          return {
            allowed: false,
            module: 'content',
            reason: 'Content matches blocked pattern',
            rejectedBy: constraint.id,
          };
        }
      }
    }

    const allowUrls = constraint.properties[VOCAB.CONTENT_ALLOW_URLS];
    if (allowUrls === 'false') {
      const urls = text.match(URL_REGEX);
      if (urls && urls.length > 0) {
        return {
          allowed: false,
          module: 'content',
          reason: 'URLs are not permitted',
          rejectedBy: constraint.id,
        };
      }
    }

    const allowedDomainsStr = constraint.properties[VOCAB.CONTENT_ALLOWED_DOMAINS];
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
                rejectedBy: constraint.id,
              };
            }
          }
        }
      }
    }

    return { allowed: true };
  },
};
