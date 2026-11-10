/** Development measurement only, never an in-run Agent render or delivery. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectAcceptance } from '../../../demo/self_root_ppt.ts';

const [root, manifestPath] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(manifestPath,'utf8'));
const receipt = JSON.parse(readFileSync(join(root,'exports/v001/receipt.json'),'utf8'));
const workspace = { path: (path: string) => join(root,'workspace',path), read: (path: string) => readFileSync(join(root,'workspace',path),'utf8') };
const result = collectAcceptance(manifest,root,workspace,receipt.source_path,receipt,0);
writeFileSync(join(root,'acceptance.json'),JSON.stringify({ measurement:'development posthoc; not Agent render, feedback or delivery', ...result },null,2),'utf8');
