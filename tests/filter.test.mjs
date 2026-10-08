import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilterSession } from '../src/filter.mjs';
function fixture() {
  const listeners = new Map();
  const states = { Pad:false, Via:false, Track:false, 'Copper Region':false, Component:true, Locked:false };
  const controls = Object.fromEntries(Object.keys(states).map(title => [title, { type:'checkbox', disabled:false,
    get checked() { return states[title]; }, click() { states[title] = !states[title]; } }]));
  const labels = Object.keys(states).map(title => ({ htmlFor:title, getAttribute:() => title }));
  const panel = { querySelectorAll:() => labels, contains:input => Object.values(controls).includes(input) };
  const host = { getElementById:id => id === 'pcb-filter' ? panel : controls[id],
    addEventListener:(name,fn) => listeners.set(name,fn), removeEventListener:name => listeners.delete(name) };
  return { host, states, controls, listeners };
}
test('component-only filter enables net-bearing objects and restores original settings', () => {
  const f=fixture(); const before={...f.states}; const session=createFilterSession(f.host);
  session.enable();
  assert.deepEqual(f.states,{ Pad:true,Via:true,Track:true,'Copper Region':true,Component:false,Locked:false });
  session.enable(); // Repeated pick must not overwrite the original snapshot.
  assert.equal(session.restore(),true); assert.deepEqual(f.states,before);
  assert.equal(session.restore(),true); assert.equal(f.listeners.size,0);
});
test('host interaction restores before tab/filter/close actions and retains unrelated edits', () => {
  const f=fixture(); const session=createFilterSession(f.host);session.enable();f.states.Locked=true;
  f.listeners.get('pointerdown')();
  assert.equal(f.states.Component,true);assert.equal(f.states.Pad,false);assert.equal(f.states.Locked,true);
});
test('missing controls cause zero writes; partial failures roll back', () => {
  const f=fixture(); const before={...f.states}; f.controls.Via.disabled=true;
  assert.throws(()=>createFilterSession(f.host).enable(),/Via/); assert.deepEqual(f.states,before);
  f.controls.Via.disabled=false;f.controls.Track.click=()=>{};
  assert.throws(()=>createFilterSession(f.host).enable(),/未生效/);assert.deepEqual(f.states,before);
});
