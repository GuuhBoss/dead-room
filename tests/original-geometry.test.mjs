import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../backend/simulation.mjs';
import {fixtureSources} from './helpers.mjs';

// Trusted local source probes report results without exposing mutation hooks to
// network clients. Expected cases are derived from the original AS2 routines.
function probe(t, setup) {
  const sim=createSimulation({sourceDir:fixtureSources(t, `
room.solid.fill(0); cellObject.fill(null);
const findings = (() => { ${setup} })();
texts.push(make('text',{kind:'audit',text:JSON.stringify(findings),t:0}));
`)});
  return JSON.parse(sim.snapshot().texts.find(t=>t.kind==='audit').text);
}

test('original bullet area does not inflate a target radius', t=>{
  const data=probe(t, `
const z={id:10,x:5,y:5.47,r:.45};
return {hit:!!lineHit(2,5,8,5,.04,[z]).thing};
`);
  assert.equal(data.hit,false);
});

test('original hit position retracts from target centre, not analytic ray intersection', t=>{
  const data=probe(t, `
const z={id:10,x:5,y:5.3,r:.45};
const hit=lineHit(2,5,8,5,.04,[z]);
return {x:hit.x,y:hit.y,hit:hit.thing===z};
`);
  const fraction=(Math.hypot(3,.3)-.45)/Math.hypot(3,.3);
  assert.equal(data.hit,true);
  assert.ok(Math.abs(data.x-(2+3*fraction))<1e-10);
  assert.ok(Math.abs(data.y-(5+.3*fraction))<1e-10);
});

test('original per-cell enumeration picks newest target and endpoint scan keeps original overshoot', t=>{
  const data=probe(t, `
const older={id:10,x:5.1,y:5.5,r:.45},newer={id:11,x:5.8,y:5.5,r:.45};
const beyond={id:12,x:6.8,y:5.5,r:.45},far={id:13,x:9.2,y:5.5,r:.45};
return {sameCell:lineHit(2,5.5,8,5.5,.04,[older,newer]).thing.id,
 beyond:lineHit(2,5.5,6,5.5,.04,[beyond]).thing===beyond,
 far:!!lineHit(2,5.5,6,5.5,.04,[far]).thing};
`);
  assert.deepEqual(data,{sameCell:11,beyond:true,far:false});
});

test('original navigation advances five rings, retains previous distances and continues next tick', t=>{
  const data=probe(t, `
players=[{x:1.5,y:1.5}]; room.navigation=null;
room.nav.fill(undefined); room.navSeen.fill(-1); room.navStamp.fill(-1);
refreshNav();
const first={seed:navAt(1,1),one:navAt(2,1),five:navAt(6,1),six:navAt(7,1)??null};
refreshNav();
return {first,ten:navAt(11,1),eleven:navAt(12,1)??null};
`);
  assert.deepEqual(data,{first:{seed:0,one:0,five:4,six:null},ten:9,eleven:null});
});

test('original grenade arc applies gravity before moving and halves all velocity on floor bounce', t=>{
  const data=probe(t, `
players=[]; zombies=[];barrels=[];blocks=[];
const s={x:2.5,y:5,z:1.25,vx:.75,vy:0,vz:.375,r:.1};
const heights=[];for(let i=0;i<15;i++){bounce(s);if(i<5||i===14)heights.push(s.z);}
return {heights,x:s.x,vx:s.vx,vz:s.vz};
`);
  const expected=[1.565,1.82,2.015,2.15,2.225,.2625];
  data.heights.forEach((z,i)=>assert.ok(Math.abs(z-expected[i])<1e-10));
  assert.ok(Math.abs(data.x-13.375)<1e-10);
  assert.ok(Math.abs(data.vx-.375)<1e-10);
  assert.ok(Math.abs(data.vz-.2625)<1e-10);
});

test('shots added during a player update wait one tick and then process before older creatures', t=>{
  const data=probe(t, `
const p=players[0];players=[p];p.x=2;p.y=5;p.angle=0;
barrels=[];blocks=[];mines=[];pickups=[];zombies=[];spawnZ=[];spawnD=[];
const z=makeZombie(5,5.18,false);z.state='sleep';z.count=1000;z.shootable=true;z.solid=true;z.speed=0;zombies.push(z);
takeInput(p,{dx:0,dy:0,fire:true,prev:false,next:false,select:-1});
simTick();const first=z.hp;
simTick();return {first,second:z.hp};
`);
  assert.deepEqual(data,{first:100,second:74});
});

test('barrel affects queue behind the blast and disposal waits until the next tick', t=>{
  const data=probe(t, `
players=[];zombies=[];barrels=[];blocks=[];mines=[];pickups=[];spawnZ=[];spawnD=[];
const b=addBarrel(5.5,5.5,100,false,false);
explosion(5.5,5.5,100,0,0,0);
simTick();const first={present:barrels.includes(b),cell:cellObject[cellIndex(5,5)]===b,blasts:blasts.length};
simTick();return {first,present:barrels.includes(b),cell:!!cellObject[cellIndex(5,5)],blasts:blasts.length};
`);
  assert.deepEqual(data,{first:{present:true,cell:true,blasts:1},present:false,cell:false,blasts:2});
});

test('stacked affectors are applied in AVM1 reverse insertion order', t=>{
  const data=probe(t, `
const p=players[0];p.inv=0;
affect(p,{type:'bullet',damage:10,x:p.x-1,y:p.y});
affect(p,{type:'bullet',damage:10,x:p.x+1,y:p.y});
processAffects(p);return {hp:p.hp,kx:p.kx};
`);
  assert.equal(data.hp,180);
  assert.ok(data.kx>0);
});

test('original pistol muzzle uses exported XSI coordinates and 256-angle lookup', t=>{
  const data=probe(t, `
const p=players[0];p.x=2;p.y=3;p.anim={weapon:'pistol',moving:false,frame:0};
p.angle=0;const east=gunPoint(p);
p.angle=Math.PI/2;const south=gunPoint(p);
p.angle=(8.1/256)*TAU;const quantized=gunPoint(p);
p.anim={weapon:'barrel',moving:false,frame:0};const empty=gunPoint(p);
return {east,south,quantized,empty};
`);
  // Raw GunPosition_Right (78.9873,-30.5832,-90.2071), scale .35,
  // FillXSIInfo applies (x,-sin(45)*y,-z)/32. Direction4 is south.
  const east={x:2.863924,y:3.23653,z:.98664};
  assert.deepEqual(data.east,east);
  assert.deepEqual(data.south,{x:1.665496,y:3.610886,z:.98664});
  // floor(angle*256/2pi)=8, then round(8/16)=1, not continuous rotation.
  assert.deepEqual(data.quantized,{x:2.670153,y:3.452301,z:.98664});
  assert.deepEqual(data.empty,{x:2,y:3,z:0});
});

test('original weapon switch fires from previous pose before animation changes', t=>{
  const data=probe(t, `
const p=players[0];p.x=3;p.y=5;p.angle=0;
p.have[2]=true;giveWeapon(p,2);p.cool=0;
takeInput(p,{dx:0,dy:0,fire:false,prev:false,next:false,select:2});
playerControl(p);
const switched={weapon:p.weapon,pose:p.anim.weapon};
takeInput(p,{dx:0,dy:0,fire:true,prev:false,next:false,select:-1});
playerControl(p);
return {switched,shot:{x:hitscans[0].x,y:hitscans[0].y},pose:p.anim.weapon};
`);
  assert.deepEqual(data.switched,{weapon:2,pose:'pistol'});
  assert.deepEqual(data.shot,{x:3.863924,y:5.23653});
  assert.equal(data.pose,'shotgun');
});

test('original devil empty hand models use radius-based fallback on frame three', t=>{
  const data=probe(t, `
const z=makeZombie(4,5,true);z.af=2.99;z.attackAngle=Math.PI/2;
devilAttack(z);const s=shots.find(s=>s.kind==='fireball');
return {x:s.x,y:s.y,z:s.z,owner:s.ownerUid===z._uid};
`);
  assert.deepEqual(data,{x:4,y:5.63,z:.84,owner:true});
});
