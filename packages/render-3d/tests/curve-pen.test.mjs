import assert from "node:assert/strict";
import test from "node:test";
import { createCurvePen } from "../dist/interaction/curve-pen.js";

function fixture(accept = () => true) {
  const previews = [], commits = [];
  const pen = createCurvePen({
    equal: (a,b) => a === b, closes: (a,b) => a === b,
    anchor: (point,drag = point) => ({point,incoming: point - (drag-point),outgoing:drag}),
    onPreview: d => previews.push(d),
    onFinish: d => { commits.push(d); return accept(d); },
  });
  const click = p => { pen.begin(p); pen.end(p); };
  return {pen,click,previews,commits};
}
test("draft, hover and drag stay uncommitted; release uses its final sample", () => {
  const f=fixture();
  f.pen.begin(0); f.pen.move(2); f.pen.end(3);
  f.click(10); f.pen.hover(20);
  assert.equal(f.commits.length,0);
  assert.equal(f.pen.snapshot().anchors.length,2);
  assert.deepEqual(f.pen.snapshot().anchors[0],{point:0,incoming:-3,outgoing:3});
  assert.equal(f.pen.finish(),true);
  assert.equal(f.commits.length,1);
  assert.equal(f.commits[0].anchors.length,2);
  assert.equal(f.pen.finish(),false);
});
test("returning to press position resets the handles; snapshots are immutable", () => {
  const f=fixture(); f.pen.begin(1); f.pen.move(4); f.pen.end(1);
  const before=f.pen.snapshot();
  assert.deepEqual(before.anchors[0],{point:1,incoming:1,outgoing:1});
  assert.throws(()=>before.anchors.push({}),TypeError);
  f.click(6); assert.equal(before.anchors.length,1);
});
test("closing requires three anchors and commits only on release near the first", () => {
  const f=fixture(); f.click(0);f.click(10);f.click(20);
  f.pen.begin(0); assert.equal(f.commits.length,0);
  assert.equal(f.pen.finish(),false);
  f.pen.end(5); assert.equal(f.commits.length,0);
  f.pen.begin(0);f.pen.end(0);
  assert.equal(f.commits.length,1);
  assert.equal(f.commits[0].closed,true);
  assert.equal(f.commits[0].anchors.length,3);
});
test("cancel and undo of pending placement cannot commit a partial gesture", () => {
  const f=fixture();f.click(0);f.click(10);f.pen.begin(20);
  f.pen.removeLast();assert.equal(f.pen.snapshot().anchors.length,2);
  f.pen.end(20);assert.equal(f.pen.snapshot().anchors.length,2);
  f.pen.removeLast();assert.equal(f.pen.finish(),false);
  f.pen.cancel();assert.equal(f.pen.snapshot().anchors.length,0);
  assert.equal(f.commits.length,0);
});
test("rejected and throwing consumers preserve drafts for a later retry", () => {
  let mode=0;
  const f=fixture(()=>{if(mode===1)throw Error("rejected"); return mode===2;});
  f.click(0);f.click(10);
  assert.equal(f.pen.finish(),false);
  mode=1;assert.throws(()=>f.pen.finish(),/rejected/);
  assert.equal(f.pen.snapshot().anchors.length,2);
  mode=2;assert.equal(f.pen.finish(),true);
  assert.equal(f.pen.snapshot().anchors.length,0);
});
test("reentrant finish is ignored and separate controllers do not share drafts", () => {
  let f;f=fixture(()=>{assert.equal(f.pen.finish(),false);return true;});
  f.click(0);f.click(10);
  const other=fixture();other.click(7);
  f.pen.finish();assert.equal(f.commits.length,1);
  assert.equal(other.pen.snapshot().anchors.length,1);
});
