/** Fixed public facts about the site. Deploy-time settings live in wrangler.jsonc `vars` and `PUBLIC_*`. */

export const SITE_NAME = 'Bluelytics';
export const API_ORIGIN = 'https://api.bluelytics.com.ar';

/** The MCP server (apps/mcp): stateless Streamable HTTP, no authentication. */
export const MCP_URL = 'https://mcp.bluelytics.com.ar/mcp';
export const MCP_NAME = 'Bluelytics';

/** Claude's "add custom connector" dialog, filled in. */
export const CLAUDE_CONNECTOR_URL = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent(MCP_NAME)}&connectorUrl=${encodeURIComponent(MCP_URL)}`;

/** Gemini CLI command that adds the server. */
export const GEMINI_COMMAND = `gemini mcp add --transport http bluelytics ${MCP_URL}`;

export const SOCIAL = {
  x: 'https://x.com/bluelytics',
  instagram: 'https://www.instagram.com/bluelytics_dolar',
  linkedin: 'https://www.linkedin.com/company/74483029',
  github: 'https://github.com/Bluelytics',
} as const;

export const AUTHOR = { name: 'Pablo Seibelt', url: 'https://www.sicarul.com' } as const;

/** R2 key of the 1200×630 link-preview card the jobs Worker refreshes when the blue rate changes (ARCHITECTURE §7.6). */
export const OG_IMAGE_KEY = 'og/latest.jpg';
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
