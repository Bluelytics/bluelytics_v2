const MAX_LENGTH = 300;

/** One line, at most 300 characters: what is stored in `push_status`, `social_posts.error` and reports. */
export function errorText(value: unknown): string {
  const text = (value instanceof Error ? `${value.name === 'Error' ? '' : `${value.name}: `}${value.message}` : String(value))
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= MAX_LENGTH ? text : `${text.slice(0, MAX_LENGTH - 3)}...`;
}
