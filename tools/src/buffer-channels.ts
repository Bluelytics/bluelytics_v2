import { parseArgs } from 'node:util';
import { BufferClient, BufferError, parseBufferChannels, POSTING_SERVICES, type BufferChannel, type FetchLike, type PostingService } from '@bluelytics/social';
import { CliError, formatTable, isMain, runCli, usageError } from './cli.ts';

export const BUFFER_CHANNELS_USAGE = `Usage: pnpm buffer:channels

Lists the Buffer organizations and channels the key in $BUFFER_API_KEY can see (read-only
GraphQL queries) and prints the BUFFER_CHANNELS value for apps/jobs/wrangler.jsonc: one usable
channel id (the \`id\` column, not the network's own id) per supported network (${POSTING_SERVICES.join(', ')}).
The key is never printed.

  -h, --help   this text`;

export interface ListedChannel extends BufferChannel {
  organization: string;
}

const usable = (channel: BufferChannel): boolean => !channel.isDisconnected && !channel.isLocked;

function status(channel: BufferChannel): string {
  const flags = [channel.isDisconnected && 'disconnected', channel.isLocked && 'locked', channel.isQueuePaused && 'queue paused'].filter(Boolean);
  return flags.length === 0 ? 'ok' : flags.join(', ');
}

/** The `BUFFER_CHANNELS` value: the first usable channel of each supported network, plus warnings for the operator. */
export function suggestChannels(channels: readonly BufferChannel[]): { json: string; warnings: string[] } {
  const value: Partial<Record<PostingService, string>> = {};
  const warnings: string[] = [];
  for (const service of POSTING_SERVICES) {
    const candidates = channels.filter((channel) => channel.service === service);
    const ok = candidates.filter(usable);
    const [chosen, ...others] = ok;
    if (chosen === undefined) {
      if (candidates.length > 0) warnings.push(`${service}: every channel is disconnected or locked; reconnect it in Buffer`);
      continue;
    }
    value[service] = chosen.id;
    if (others.length > 0) warnings.push(`${service}: ${ok.length} usable channels, chose ${chosen.id} (${chosen.name}); others: ${others.map((channel) => channel.id).join(', ')}`);
    if (chosen.isQueuePaused) warnings.push(`${service}: the queue of ${chosen.id} is paused in Buffer`);
  }
  const json = JSON.stringify(value);
  parseBufferChannels(json);
  return { json, warnings };
}

/** Every organization's channels, in Buffer's order. */
export async function listAllChannels(client: BufferClient): Promise<ListedChannel[]> {
  const listed: ListedChannel[] = [];
  for (const organization of await client.listOrganizations()) {
    for (const channel of await client.listChannels(organization.id)) listed.push({ ...channel, organization: organization.name });
  }
  return listed;
}

export interface BufferChannelsDeps {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  out?: (line: string) => void;
}

export async function main(argv: string[], deps: BufferChannelsDeps = {}): Promise<number> {
  const out = deps.out ?? ((line: string) => console.log(line));
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { help: { type: 'boolean', short: 'h', default: false } } }));
  } catch (error) {
    usageError(error, BUFFER_CHANNELS_USAGE);
  }
  if (values.help) {
    out(BUFFER_CHANNELS_USAGE);
    return 0;
  }
  const apiKey = (deps.env ?? process.env)['BUFFER_API_KEY']?.trim() ?? '';
  if (apiKey === '') throw new CliError('BUFFER_API_KEY is not set: `read -rs BUFFER_API_KEY && export BUFFER_API_KEY`, then run again');
  // Buffer's messages never echo the key, but make sure an error message cannot either.
  const redact = (text: string) => text.replaceAll(apiKey, '[BUFFER_API_KEY]');

  let channels: ListedChannel[];
  try {
    channels = await listAllChannels(new BufferClient({ apiKey, ...(deps.fetch && { fetch: deps.fetch }) }));
  } catch (error) {
    if (error instanceof BufferError) {
      const hint = error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN' ? ' (is BUFFER_API_KEY a current key from Buffer → Settings → API?)' : '';
      throw new CliError(redact(`${error.code}: ${error.message}${hint}`));
    }
    throw new CliError(redact(error instanceof Error ? error.message : String(error)));
  }

  out(
    formatTable(
      ['organization', 'channel id', 'service', 'name', 'status'],
      channels.map((channel) => [channel.organization, channel.id, channel.service, channel.displayName ?? channel.name, status(channel)]),
    ),
  );
  const { json, warnings } = suggestChannels(channels);
  for (const warning of warnings) out(`warning: ${warning}`);
  out('');
  out(json === '{}' ? 'No usable channel for a supported network: BUFFER_CHANNELS would be empty.' : `BUFFER_CHANNELS=${json}`);
  return json === '{}' ? 1 : 0;
}

if (isMain(import.meta.url)) runCli('buffer:channels', (argv) => main(argv));
