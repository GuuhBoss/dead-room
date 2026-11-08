import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation} from '../backend/simulation.mjs';
import {neutralInput} from '../backend/protocol.mjs';
import {app,client,room,input,fixtureSources,defeatSetup} from './helpers.mjs';

async function party(t,service,{mode='coop',maxPlayers=6,count=6}={}) {
  const clients=await Promise.all(Array.from({length:count},()=>client(t,service.base)));
  clients[0].send({type:'create',mode,roomIndex:0,name:'Player0',maxPlayers});
  const welcome=await clients[0].next('welcome');await clients[0].next('lobby');
  for(let i=1;i<count;i++){
    clients[i].send({type:'join',code:welcome.code,name:'Player'+i});
    assert.equal((await clients[i].next('welcome')).playerId,i);
  }
  return {clients,welcome};
}

const openFloor=`
spawnZ=[];spawnD=[];room.solid.fill(0);cellObject.fill(null);
barrels=[];blocks=[];pickups=[];mines=[];
players.forEach((p,i)=>{p.x=3+i*2;p.y=5;p.inv=2000;trackMapwho(p);});
markPlayers();
`;

test('six-player simulations spawn distinct players on free floor in all18 original rooms',()=>{
  for(const mode of ['coop','deathmatch'])for(let roomIndex=0;roomIndex<18;roomIndex++){
    const sim=createSimulation({mode,roomIndex,playerCount:6,seed:17});
    const snapshot=sim.snapshot(),def=sim.rules().rooms[roomIndex];
    assert.equal(snapshot.players.length,6);
    assert.equal(snapshot.game.playerCount,6);
    assert.equal(new Set(snapshot.players.map(p=>`${p.x},${p.y}`)).size,6);
    for(const p of snapshot.players)assert.notEqual(def.map[Math.floor(p.y)][Math.floor(p.x)],'#');
    for(let i=0;i<12;i++)sim.step(Array.from({length:6},neutralInput));
    assert.equal(sim.snapshot().players.length,6);
  }
  for(const n of [0,1,7,2.5,NaN])assert.throws(()=>createSimulation({mode:'coop',playerCount:n}),/player count/);
  assert.throws(()=>createSimulation({mode:'solo',playerCount:2}),/player count/);
});

test('six-client lobby assigns immutable slots, enforces capacity and isolates the sixth input',async t=>{
  const service=await app(t,{sourceDir:fixtureSources(t,openFloor)});
  const {clients,welcome}=await party(t,service);
  assert.equal(welcome.maxPlayers,6);
  const lobby=await clients[0].next('lobby',m=>m.players.length===6);
  assert.deepEqual(lobby.players.map(p=>p.id),[0,1,2,3,4,5]);
  const seventh=await client(t,service.base);
  seventh.send({type:'join',code:welcome.code,name:'Seventh'});
  assert.match((await seventh.next('error')).message,/unavailable/);
  clients[5].send({type:'character',character:2,playerId:0});
  assert.match((await clients[5].next('error')).message,/Invalid character/);
  clients[5].send({type:'character',character:2});
  await clients[0].next('lobby',m=>m.players[5]?.character===2);
  clients[5].send({type:'start'});
  assert.match((await clients[5].next('error')).message,/host/);
  clients[0].send({type:'start'});
  const first=(await clients[5].next('state',m=>m.tick===0)).snapshot;
  assert.equal(first.players.length,6);
  assert.deepEqual(first.game.characters,[3,0,1,2,3,2]);
  clients[5].send({type:'input',seq:0,input:input({dx:1})});
  const moved=(await clients[0].next('state',m=>m.tick>=5)).snapshot;
  assert.ok(moved.players[5].x>first.players[5].x+.2);
  assert.deepEqual(moved.players.slice(0,5).map(p=>p.x),first.players.slice(0,5).map(p=>p.x));
  clients[5].send({type:'input',seq:0,input:input({dx:-1})});
  assert.match((await clients[5].next('error')).message,/Stale/);
  clients[5].send({type:'input',seq:1,input:{...input(),playerId:0}});
  assert.match((await clients[5].next('error')).message,/Invalid input/);
});

test('six-capacity rooms can start with two and never add ghost players or accept late joins',async t=>{
  const service=await app(t);const {clients,welcome}=await party(t,service,{count:2});
  clients[0].send({type:'start'});
  assert.equal((await clients[0].next('state')).snapshot.players.length,2);
  const late=await client(t,service.base);late.send({type:'join',code:welcome.code,name:'Late'});
  assert.match((await late.next('error')).message,/unavailable/);
});

test('invalid capacities are rejected before room creation',async t=>{
  const service=await app(t,{limits:{controlBurst:30}}),c=await client(t,service.base);
  for(const maxPlayers of [0,1,7,2.5,'6',null,{},[]]){
    c.send({type:'create',mode:'coop',roomIndex:0,name:'Host',maxPlayers});
    assert.match((await c.next('error')).message,/capacity/);
  }
  c.send({type:'create',mode:'solo',roomIndex:0,name:'Host',maxPlayers:6});
  assert.match((await c.next('error')).message,/capacity/);
  c.send({type:'create',mode:'coop',roomIndex:0,name:'Host',maxPlayers:6});
  assert.equal((await c.next('welcome')).maxPlayers,6);
});

test('party-size leaderboard filters are bounded and reject conflicting categories',async t=>{
  const service=await app(t);
  for(const query of ['players=0','players=7','players=-1','players=six','players=2.5','players=06','players=1&mode=coop','players=6&mode=solo','players=2&players=6']){
    assert.equal((await fetch(service.base+'/api/leaderboard?'+query)).status,400,query);
  }
  assert.equal((await fetch(service.base+'/api/leaderboard?mode=coop&players=6')).status,200);
  assert.equal((await fetch(service.base+'/api/leaderboard?mode=solo&players=1')).status,200);
});

test('the sixth player leaving aborts all six and never records a partial team',async t=>{
  const service=await app(t),{clients}=await party(t,service);
  clients[0].send({type:'start'});await clients[0].next('state');
  clients[5].send({type:'leave'});
  for(const c of clients)assert.match((await c.next('ended')).reason,/left/);
  assert.deepEqual(await service.entries(),[]);
});

test('all six must accept rematch and both survival runs persist under their actual party size',async t=>{
  const service=await app(t,{sourceDir:fixtureSources(t,defeatSetup)});
  const {clients,welcome}=await party(t,service);
  clients[0].send({type:'start'});
  for(const c of clients)assert.equal((await c.next('result')).recorded,true);
  for(let i=0;i<5;i++)clients[i].send({type:'rematch'});
  const votes=await clients[5].next('rematch',m=>m.ready.length===5);
  assert.deepEqual(votes.ready,[0,1,2,3,4]);
  for(const c of clients)assert.equal(c.queue.some(m=>m.type==='restart'),false);
  clients[5].send({type:'rematch'});
  const restart=await clients[0].next('restart');assert.notEqual(restart.runId,welcome.runId);
  for(const c of clients.slice(1))assert.equal((await c.next('restart')).runId,restart.runId);
  for(const c of clients)assert.equal((await c.next('result',m=>m.runId===restart.runId)).recorded,true);
  const entries=await service.entries('?mode=coop&players=6');
  assert.equal(entries.length,2);
  assert.ok(entries.every(e=>e.names.length===6));
  assert.deepEqual(await service.entries('?mode=coop&players=2'),[]);
});

test('a sixth-slot deathmatch winner and six-person rematch never enter survival rankings',async t=>{
  const setup=`
spawnZ=[];spawnD=[];
if(players.length===6){
const victim=players[4],killer=players[5];killer.frags=game.fragLimit-1;victim.inv=0;
affect(victim,{type:'bullet',damage:victim.max+1,x:victim.x-1,y:victim.y,owner:killer.id});
processAffects(victim);victim.count=0;hitState(victim);victim.state='dead';victim.count=0;
}
`;
  const service=await app(t,{sourceDir:fixtureSources(t,setup)});
  const {clients,welcome}=await party(t,service,{mode:'deathmatch'});
  clients[0].send({type:'start'});
  for(const c of clients)assert.equal((await c.next('result')).recorded,false);
  const end=(await clients[0].next('state',m=>m.snapshot.game.state==='over')).snapshot;
  assert.equal(end.game.winner,5);assert.equal(end.players[5].frags,10);assert.equal(end.players[4].deaths,1);
  for(const c of clients)c.send({type:'rematch'});
  const restart=await clients[0].next('restart');assert.notEqual(restart.runId,welcome.runId);
  assert.equal((await clients[0].next('result',m=>m.runId===restart.runId)).recorded,false);
  assert.deepEqual(await service.entries(),[]);
});

test('six-player cooperative respawn uses a living partner instead of ending the surviving team',t=>{
  const setup=openFloor+`
for(const p of players.slice(0,5)){p.hp=0;p.down=true;p.state='respawn';p.count=-1;}
alive=1;markPlayers();
`;
  const sim=createSimulation({mode:'coop',playerCount:6,sourceDir:fixtureSources(t,setup),seed:9});
  for(let i=0;i<6;i++)sim.step(Array.from({length:6},neutralInput));
  const s=sim.snapshot();assert.equal(s.game.state,'playing');
  assert.ok(s.players.every(p=>!p.down&&p.hp===200));
  assert.equal(new Set(s.players.map(p=>`${p.x},${p.y}`)).size,6);
});

test('free-for-all suicide and environmental damage grant no opponent a frag',t=>{
  const setup=`
const p=players[5];p.inv=0;p.frags=3;
affect(p,{type:'explosion',damage:10000,range:2,x:p.x,y:p.y,ownerUid:p._uid});
processAffects(p);p.count=0;hitState(p);
`;
  const sim=createSimulation({mode:'deathmatch',playerCount:6,sourceDir:fixtureSources(t,setup)}),s=sim.snapshot();
  assert.equal(s.players[5].deaths,1);assert.equal(s.players[5].frags,3);
  assert.ok(s.players.slice(0,5).every(p=>p.frags===0));assert.equal(s.game.winner,null);
});

test('free-for-all explosions and chained barrels credit the authoritative owner',t=>{
  for(const kind of ['projectile','map-barrel','placed-barrel','chain']){
    const setup=openFloor+`
const victim=players[4],trigger=players[5],placer=players[2];victim.inv=0;
const kind=${JSON.stringify(kind)};
if(kind==='projectile'){
  detonate({x:victim.x,y:victim.y,damage:400,ownerUid:trigger._uid});
}else{
  const first=addBarrel(victim.x-1,victim.y,400,kind==='placed-barrel',false,kind==='placed-barrel'?placer._uid:undefined);
  const second=kind==='chain'?addBarrel(victim.x,victim.y,400,false,false):null;
  affect(first,{type:'bullet',damage:20,x:first.x-1,y:first.y,owner:trigger.id});
  updateBarrel(first);
  updateExplosion(pending.find(e=>e._kind==='explosion'));
  if(second){updateBarrel(second);updateExplosion(pending.filter(e=>e._kind==='explosion'&&!e.gone).at(-1));}
}
processAffects(victim);victim.count=0;hitState(victim);
`;
    const sim=createSimulation({mode:'deathmatch',playerCount:6,sourceDir:fixtureSources(t,setup)});
    const s=sim.snapshot(),expected=kind==='placed-barrel'?2:5;
    assert.equal(s.players[4].deaths,1,kind);
    assert.equal(s.players[expected].frags,1,kind);
    assert.ok(s.players.filter(p=>p.id!==expected).every(p=>p.frags===0),kind);
  }
});
