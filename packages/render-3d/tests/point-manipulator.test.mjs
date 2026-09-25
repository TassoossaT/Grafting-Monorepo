import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Scene, Vector3 } from "three";
import { createPointManipulator } from "../dist/backend/three/point-manipulator.js";

class Surface extends EventTarget {
  style = { touchAction: "pan-y" };
  ownerDocument = new EventTarget();
  captures = new Set();
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  pointer(type, x, y) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0 });
    this.dispatchEvent(event);
    return event;
  }
}
function fixture() {
  const scene = new Scene(), element = new Surface(), events = [];
  const camera = new PerspectiveCamera(45, 800/600, 0.1, 1000);
  camera.position.set(8, 10, 12);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  let frames = 0;
  const target = { id: "point", position: {x:0,y:0,z:0}, axes: ["x","z"], size: 1,
    onChange: (phase,position)=>events.push({phase,position}) };
  const manipulator = createPointManipulator(camera,element,scene,target,()=>frames++);
  manipulator.draw(camera,true);scene.updateMatrixWorld(true);
  // Locate a pickable part using the actual helper geometry/raycaster.
  function start() {
    for(let y=260;y<=340;y+=4) for(let x=360;x<=460;x+=4) {
      const event=element.pointer("pointerdown",x,y);
      if(events.some(e=>e.phase==="start")) return {x,y,event};
    }
    assert.fail("official helper did not accept any pointer hit");
  }
  return {scene,element,events,camera,manipulator,target,start,get frames(){return frames;}};
}
test("official helper consumes its drag, includes release position and releases capture",()=>{
  const f=fixture();
  try {
    const hit=f.start();assert.equal(hit.event.defaultPrevented,true);
    assert.equal(f.element.captures.size,1);
    f.element.pointer("pointerup",hit.x+40,hit.y+16);
    assert.deepEqual(f.events.map(e=>e.phase),["start","move","end"]);
    assert.notDeepEqual(f.events.at(-1).position,{x:0,y:0,z:0});
    assert.equal(f.events.at(-1).position.y,0);
    assert.equal(f.element.captures.size,0);
    assert.equal(f.element.style.touchAction,"pan-y");
    assert.ok(f.frames>1);
    assert.equal(f.element.pointer("click",hit.x+40,hit.y+16).defaultPrevented,true);
  } finally {f.manipulator.dispose();}
  assert.equal(f.scene.children.length,0);
});
test("Escape restores the proxy and cleanup cancels a captured gesture without committing",()=>{
  const f=fixture();
  const hit=f.start();f.element.pointer("pointermove",hit.x+40,hit.y+16);
  const escape=new Event("keydown",{cancelable:true});Object.assign(escape,{key:"Escape"});
  f.element.ownerDocument.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented,true);
  assert.equal(f.events.at(-1).phase,"cancel");
  assert.deepEqual(f.events.at(-1).position,{x:0,y:0,z:0});
  assert.equal(f.events.some(e=>e.phase==="end"),false);
  assert.equal(f.element.captures.size,0);
  f.events.length=0;f.start();f.manipulator.dispose();
  assert.equal(f.events.at(-1).phase,"cancel");
  assert.equal(f.element.captures.size,0);
  assert.equal(f.scene.children.length,0);
});
test("surface draw hides its helper for other views and updates the active camera",()=>{
  const f=fixture();
  try {
    f.manipulator.draw(f.camera,false);
    assert.equal(f.scene.children.find(c=>c.children.length>0)?.visible,false);
    f.manipulator.update({...f.target,position:{x:3,y:1,z:2}});
    f.manipulator.draw(f.camera,true);
    const proxy=f.scene.children.find(c=>c.type==="Object3D");
    assert.ok(proxy.position.equals(new Vector3(3,1,2)));
  } finally {f.manipulator.dispose();}
});
