import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildLedger} from '../demo/arc_thin_ledger.ts';
import {buildDossier, NATIVE_CRITIC_SYSTEM} from '../demo/arc_thin_critic.ts';

test('native critic sees actual failed preconditions and exact public evidence without a semantic verdict gate', () => {
  const state=buildLedger([{n:21,action:'ACTION1',changed_cells:0,level_changed:false,state:'NOT_FINISHED',levels_completed:0}], []);
  const dossier=buildDossier({state,triggers:['prediction miss'],memoryText:'hyp.goal: entering a room triggers success',skills:[],notes:[],
    recentLines:['#21 ACTION1 expected entry; 0 of 4 predicted cells correct'],currentState:'unchanged',
    evidenceLines:['#21: actual changed_cells=0; exact frames data/frames/20.json and data/frames/21.json']});
  assert.match(dossier,/actual changed_cells=0/);
  assert.match(dossier,/data\/frames\/21.json/);
  assert.match(NATIVE_CRITIC_SYSTEM,/precondition/);
  assert.match(NATIVE_CRITIC_SYSTEM,/different object/);
});
