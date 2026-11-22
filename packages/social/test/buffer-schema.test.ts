import { readFileSync } from 'node:fs';
import {
  buildSchema,
  extendSchema,
  isObjectType,
  parse,
  validate,
  validateInputValue,
  type GraphQLInputType,
  type GraphQLSchema,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { buildCreatePostInput, OPERATIONS, type CreateImagePostInput } from '../src/index.ts';

const SDL = readFileSync(new URL('../../../docs/research/buffer-schema.graphql', import.meta.url), 'utf8');

/**
 * The saved schema was reconstructed from introspection without `implements` clauses, while
 * Buffer documents that every error member of a payload union implements `MutationError`. Restore
 * that relation for the `*Error` object types with `message: String!` before validating.
 */
function loadSchema(): GraphQLSchema {
  const schema = buildSchema(SDL);
  const errorTypes = Object.values(schema.getTypeMap()).filter(
    (t) => isObjectType(t) && t.name.endsWith('Error') && String(t.getFields().message?.type) === 'String!',
  );
  return extendSchema(schema, parse(errorTypes.map((t) => `extend type ${t.name} implements MutationError`).join('\n')));
}

const schema = loadSchema();

describe('Buffer operations against docs/research/buffer-schema.graphql', () => {
  it('needs the MutationError restoration (the saved file has no implements clauses)', () => {
    const raw = buildSchema(SDL);
    expect(validate(raw, parse(OPERATIONS.CREATE_POST)).map((e) => e.message).join('\n')).toMatch(/MutationError/);
    expect(schema.getPossibleTypes(schema.getType('MutationError') as never).map((t) => t.name)).toEqual(
      expect.arrayContaining(['InvalidInputError', 'LimitReachedError', 'VoidMutationError', 'RestProxyError']),
    );
  });

  it.each(Object.entries(OPERATIONS))('%s validates', (_name, document) => {
    expect(validate(schema, parse(document)).map((e) => e.message)).toEqual([]);
  });

  const inputType = schema.getType('CreatePostInput') as GraphQLInputType;
  const cases: CreateImagePostInput[] = [
    { channelId: 'c', service: 'instagram', kind: 'post', text: 't', imageUrl: 'https://m/x.jpg', altText: 'a' },
    { channelId: 'c', service: 'instagram', kind: 'story', imageUrl: 'https://m/x.jpg' },
    { channelId: 'c', service: 'twitter', kind: 'post', text: 't', imageUrl: 'https://m/x.jpg', altText: 'a', draft: true },
    { channelId: 'c', service: 'facebook', kind: 'story', imageUrl: 'https://m/x.jpg' },
  ];

  it.each(cases)('CreatePostInput for $service $kind is valid', (post) => {
    const errors: string[] = [];
    validateInputValue(buildCreatePostInput(post), inputType, (error, path) => errors.push(`${path.join('.')}: ${error.message}`));
    expect(errors).toEqual([]);
  });
});
