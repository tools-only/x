import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveredImageRefs } from '../demo/pi_context_adapter.ts';

// User decision 2026-11-17: the request record names the image parts the applied plan actually delivered, by stable
// ref - a pure fact the evolution pass window can count and read_self can expand. Only action "include" delivers an
// image: apply() stubs images under stub, drop and truncate alike.

test('deliveredImageRefs: include-delivered image parts only, named by stable ref, pure facts', () => {
  const list: any[] = [
    { ref: 'item:1.0', section: 'history', kind: 'tool_result_image', source: 'office.look', chars: 0, image_bytes: 12345, images: 1, turn_age: 0 },
    { ref: 'item:2.0', section: 'history', kind: 'tool_result_image', source: 'office.look', chars: 0, image_bytes: 999, images: 1, turn_age: 3 },
    { ref: 'item:3.0', section: 'history', kind: 'tool_result_text', source: 'read', chars: 10, images: 0, turn_age: 0 },
    { ref: 'sys:task_brief', section: 'task_brief', chars: 50, images: 0, turn_age: 0 },
  ];
  assert.deepEqual(deliveredImageRefs(list, {}), [
    { ref: 'item:1.0', source: 'office.look', section: 'history', image_bytes: 12345 },
    { ref: 'item:2.0', source: 'office.look', section: 'history', image_bytes: 999 },
  ], 'no recorded action means include');
  assert.deepEqual(deliveredImageRefs(list, { 'item:2.0': 'stub' }).map((x: any) => x.ref), ['item:1.0'], 'a stubbed image was not delivered');
  assert.deepEqual(deliveredImageRefs(list, { 'item:2.0': { truncate: 100 } }).map((x: any) => x.ref), ['item:1.0'], 'truncate stubs an image part too (pi_context_adapter.apply)');
  assert.deepEqual(deliveredImageRefs(list, { 'item:1.0': 'drop', 'item:2.0': 'drop' }), [], 'dropped images never appear');
  assert.deepEqual(deliveredImageRefs([], {}), []);
  assert.deepEqual(deliveredImageRefs(list, { 'item:3.0': 'stub' }).length, 2, 'text items never appear whatever their action');
});
