/** Read-only developer telemetry. Never adds content, tools or instructions to gameplay. */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function runtimeAudit(pi: ExtensionAPI) {
  const root = join(process.env.ARC_RUN_ROOT!, 'runtime-audit'); mkdirSync(root, { recursive: true });
  const secrets = Object.entries(process.env).filter(([name, value]) => /KEY|TOKEN|SECRET/.test(name) && value && value.length >= 8);
  pi.on('before_provider_request', (event: any) => {
    let body = JSON.stringify({ t: new Date().toISOString(), provider: event.provider, model: event.model, payload: event.payload });
    const found: string[] = [];
    for (const [name, value] of secrets) if (body.includes(value!)) { found.push(name); body = body.split(value!).join('[REDACTED SECRET]'); }
    appendFileSync(join(root, 'provider-inputs.jsonl'), body + '\n');
    if (found.length) appendFileSync(join(root, 'secret-exposure.jsonl'), JSON.stringify({ t: new Date().toISOString(), names: found }) + '\n');
  });
}
