import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {startServer} from 'file:///C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/continue-recoil-range-https-github-com/work/R6-shooter-battle-royale/tools/serve.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await startServer(8178);
const seeds=[103,271,557,839,1297,1619,2017,2531];
const runs=[];
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM});
  async function cohort(scenario) {
    const page=await browser.newPage({viewport:{width:800,height:500}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8178/index.html?test');
    await page.waitForFunction(()=>window.__range?.ready);
    await page.locator('[data-first-profile=mouse]').click();
    await page.click('[data-mode=royale]');
    await page.evaluate(()=>{
      __range.manual(true);
      __range.setGraphics('low');
      const voices=document.querySelector('#b-voices');
      voices.value='off';
      voices.dispatchEvent(new Event('change'));
    });
    await page.click('#setup-next');
    await page.waitForFunction(()=>__range.battle()?.royale);
    for (const seed of seeds) {
      const row=await page.evaluate(async ({seed,scenario})=>{
        const {mulberry32}=await import('/js/core/prng.js?v=9dd0f7b-mwbioun8');
        const R=__range,b=R.battle();
        const savedRandom=Math.random;
        Math.random=mulberry32(seed);
        const t0=performance.now();
        b.start({...b.opts,level:'medium',night:false,weather:'clear',fog:false});
        const r=b.royale,h=b.humans[0],f=h.f,a=b.arena;
        const start=b.t, dt=1/30, checkpoints=[30,60,90,120,150,180,210];
        const counts={}, eliminated=[], chests=[], armed=new Set();
        let killsGun=0,killsGrenade=0,killsZone=0,killsOther=0,shots=0,grenades=0,walls=0,wallsDestroyed=0,wallTargetShots=0;
        let path=[],nextPath=0,firstPlayerChest=null,first15Bots=null,firstBotChest=null;
        let playerCause=null,playerExit=null;
        function wrap(obj,name,after,before=null){
          const original=obj[name];
          obj[name]=function(...args){const old=before?.(args);const result=original.apply(this,args);after(args,result,old);return result;};
          return ()=>{obj[name]=original;};
        }
        const unhook=[
          wrap(b,'fire',([shooter],_ret,valid)=>{
            if(!valid)return;
            shots++;
            if(shooter.wallTarget&&!shooter.target)wallTargetShots++;
          },([s])=>!b.over&&s.f.alive&&!!s.gun),
          wrap(b.nadesB,'throw',(_args,projectile)=>{if(projectile)grenades++;}),
          wrap(r,'build',(_args,piece)=>{if(piece?.kind==='wall')walls++;}),
          wrap(r,'damageWall',([wall],_ret,hp)=>{if(hp>0&&wall.hp<=0)wallsDestroyed++;},([wall])=>wall.hp),
          wrap(r,'takeChest',([_chest,actor])=>{
            chests.push(r.elapsed);
            if(actor===f)firstPlayerChest??=r.elapsed;
            else{
              armed.add(actor.id);
              firstBotChest??=r.elapsed;
              if(armed.size>=15)first15Bots??=r.elapsed;
            }
          }),
          wrap(b,'_damage',([actor,_amount,_by,_zone,_time,nade],_ret,alive)=>{
            if(!alive||actor.alive)return;
            if(nade)killsGrenade++;else killsGun++;
            eliminated.push(r.elapsed);
            if(actor===f){playerCause=nade?'grenade':'gunfire';playerExit=r.elapsed;}
          },([actor])=>actor.alive),
          wrap(b,'_acid',([actor,_amount,_time,cause],_ret,alive)=>{
            if(!alive||actor.alive)return;
            if(cause==='Zone')killsZone++;else killsOther++;
            eliminated.push(r.elapsed);
            if(actor===f){playerCause=cause==='Zone'?'zone':'hazard';playerExit=r.elapsed;}
          },([actor])=>actor.alive),
        ];
        try{
          let checkIndex=0;
          for(let tick=1;tick<=30*260&&!b.over;tick++){
            const time=tick*dt;
            if(scenario==='loot-and-rotate'&&f.alive){
              if(!h.gun&&r.nearby(f)){r.open(f);path=[];nextPath=0;}
              if(time>=nextPath){
                nextPath=time+1;
                const chest=!h.gun&&time<45?r.nearestChest(f):null;
                const p=chest?.position;
                const rotate=r.outside(f,14);
                path=p?a.findPath(f.x,f.z,p.x,p.z,f.y,p.y-.31):rotate?a.findPath(f.x,f.z,r.x,r.z,f.y,r.y):[];
              }
              while(path.length&&Math.hypot(path[0][0]-f.x,path[0][1]-f.z)<.38)path.shift();
              const point=path[0];
              h.in.fwd=h.in.sprint=Boolean(point);
              if(point)h.look.setAngles(Math.atan2(point[0]-f.x,f.z-point[1])*180/Math.PI,0);
            }
            b.update(start+time);
            if(checkIndex<checkpoints.length&&time>=checkpoints[checkIndex]){
              counts[checkpoints[checkIndex++]]=b.fighters.filter(v=>v.alive).length;
            }
          }
          const alive=b.fighters.filter(v=>v.alive), winner=b.over&&alive.length===1?alive[0]:null;
          const placement=f.alive?(winner===f?1:null):b.fighters.length-r.eliminated.indexOf(f);
          return {scenario,seed,finished:b.over,duration_s:r.elapsed,winner:winner?.name??null,player_place:placement,
            player_survival_s:playerExit??r.elapsed,player_exit:playerCause??(winner===f?'winner':'unresolved'),
            first_elimination_s:eliminated[0]??null,first_bot_chest_s:firstBotChest,first_player_chest_s:firstPlayerChest,
            fifteen_bots_armed_s:first15Bots,bots_armed:armed.size,chests_opened:chests.length,
            gun_eliminations:killsGun,grenade_eliminations:killsGrenade,zone_eliminations:killsZone,other_eliminations:killsOther,
            final_elimination:playerExit===eliminated.at(-1)?playerCause:(b.feed.find(e=>e.vid===r.eliminated.at(-1)?.id)?.k==='Zone'?'zone':'combat'),
            shots,grenades,bot_walls:walls,walls_destroyed:wallsDestroyed,wall_target_shots:wallTargetShots,
            ...Object.fromEntries(checkpoints.map(s=>['alive_'+s,counts[s]??null])),compute_s:(performance.now()-t0)/1000};
        } finally {
          unhook.reverse().forEach(fn=>fn());Math.random=savedRandom;
        }
      },{seed,scenario});
      assert.equal(row.finished,true,JSON.stringify(row));
      assert.equal(row.gun_eliminations+row.grenade_eliminations+row.zone_eliminations+row.other_eliminations,20,JSON.stringify(row));
      runs.push(row);
      console.log(JSON.stringify(row));
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
  await Promise.all([cohort('stationary'),cohort('loot-and-rotate')]);
  runs.sort((a,b)=>a.scenario.localeCompare(b.scenario)||a.seed-b.seed);
  const keys=Object.keys(runs[0]), cell=v=>v==null?'':typeof v==='number'?String(Math.round(v*100)/100):'"'+String(v).replaceAll('"','""')+'"';
  await writeFile('C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/can/work/blacktide-benchmark-runs.json',JSON.stringify(runs,null,2));
  await writeFile('C:/Users/migue_2u2ek1d/Documents/Codex/2026-11-10/can/outputs/blacktide-match-benchmark.csv',keys.join(',')+'\n'+runs.map(row=>keys.map(key=>cell(row[key])).join(',')).join('\n')+'\n');
} finally {await browser?.close();server.close();}
