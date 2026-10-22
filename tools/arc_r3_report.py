#!/usr/bin/env python3
"""Lightweight summary of R3 JSONL artifacts. Use the pinned Windows Python."""
from __future__ import annotations
import argparse, json
from collections import Counter
from pathlib import Path

def rows(path: Path):
    if not path.exists(): return []
    result=[]
    for line in path.read_text(encoding='utf-8').splitlines():
        try: result.append(json.loads(line))
        except json.JSONDecodeError: continue
    return result

def summarize(run: Path) -> str:
    harness=run/'harness'; trajectory=rows(harness/'trajectory.jsonl'); effects=rows(harness/'effects.jsonl'); gates=rows(harness/'r3_gates.jsonl')
    level2=[r for r in trajectory if int(r.get('levels_completed',0)) in (1,2) and int(r.get('levels_before', max(0,int(r.get('levels_completed',0))-(1 if r.get('level_changed') else 0))))==1]
    trivial=sum(bool(r.get('trivial')) for r in level2); trivial_share=trivial/len(level2) if level2 else 0
    new_configs=sum(bool(r.get('newConfig',r.get('new_config'))) for r in effects if int(r.get('level',-1))==1)
    replays=sum(r.get('replayOf',r.get('replay_of')) is not None for r in effects if int(r.get('level',-1))==1)
    gate_counts=Counter((str(r.get('gate','?')),str(r.get('verdict','?'))) for r in gates)
    kinds=Counter(str(r.get('kind','?')) for r in effects)
    lines=[f'# R3 run summary — {run}', '',f'- Trajectory rows: {len(trajectory)}; effects receipts: {len(effects)}; gate rows: {len(gates)}',f'- L2 actions observed: {len(level2)}; trivial: {trivial}/{len(level2)} ({trivial_share:.1%})',f'- L2 new configurations: {new_configs}; known replays: {replays}',f'- Effect kinds: {dict(sorted(kinds.items()))}','','## Gate verdicts','']
    lines.extend(f'- {gate} / {verdict}: {count}' for (gate,verdict),count in sorted(gate_counts.items()))
    if not gate_counts: lines.append('- none')
    lines += ['', '## Evidence limits', '', '- This helper summarizes recorded artifacts only. It does not establish semantic correctness, autonomous adoption, full-chain reachability, or net benefit.', '- Review refused actions and their later outcomes manually before making any false-refusal claim.']
    return '\n'.join(lines)+'\n'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('arc_run',type=Path);parser.add_argument('--out',type=Path);args=parser.parse_args();report=summarize(args.arc_run)
    if args.out: args.out.write_text(report,encoding='utf-8')
    else: print(report,end='')
if __name__=='__main__': main()
