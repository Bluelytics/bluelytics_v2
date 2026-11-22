// GraphQL documents sent to https://api.buffer.com. They are validated against
// docs/research/buffer-schema.graphql by test/buffer-schema.test.ts.

const POST_FIELDS = `fragment PostFields on Post {
  id
  status
  text
  channelId
  channelService
  dueAt
  sentAt
  externalLink
  error { message supportUrl }
}`;

export const LIST_ORGANIZATIONS = `query ListOrganizations {
  account { organizations { id name } }
}`;

export const LIST_CHANNELS = `query ListChannels($organizationId: OrganizationId!) {
  channels(input: { organizationId: $organizationId }) {
    id
    name
    displayName
    service
    serviceId
    descriptor
    isDisconnected
    isLocked
    isQueuePaused
  }
}`;

// Error members are selected through the MutationError interface, as Buffer asks: concrete error
// types are being removed from the payload unions.
export const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { ...PostFields } }
    ... on MutationError { message }
  }
}
${POST_FIELDS}`;

export const GET_POST = `query GetPost($id: PostId!) {
  post(input: { id: $id }) { ...PostFields }
}
${POST_FIELDS}`;

export const DELETE_POST = `mutation DeletePost($id: PostId!) {
  deletePost(input: { id: $id }) {
    __typename
    ... on DeletePostSuccess { id }
    ... on MutationError { message }
  }
}`;

export const OPERATIONS = { LIST_ORGANIZATIONS, LIST_CHANNELS, CREATE_POST, GET_POST, DELETE_POST } as const;
