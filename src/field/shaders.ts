import { BONES, HAND_CAM } from './hand';
import { REFORM, ROUTE_N } from './reform';

const f = (n: number) => n.toFixed(3);

/**
 * Which formation a particle belongs to, and how far into it it is. Shared by the compute passes
 * and the point shader. The rightmost 40 % of the swarm (by home x) forms the hand when the hero
 * has room for it. Leaving the hero, each particle lets go at its own moment: the hand first, then
 * the trace from right to left. Re-forming after a scroll back up runs on its own clock (uReform)
 * along drawn routes; see reformChunk.
 */
const formChunk = /* glsl */ `
uniform float uHandOn;
uniform float uReform;      // seconds into a re-form along the drawn routes; < 0 when not re-forming
uniform float uAbort;       // 1 after scrolling away mid re-form: dots not yet on the shape rejoin the flock
const float HAND_SPLIT=0.6;
bool isHand(vec4 h){ return uHandOn>0.5 && h.w>HAND_SPLIT; }
float traceU(vec4 h){ return uHandOn>0.5 ? h.w/HAND_SPLIT : h.w; }
float formWeight(vec4 h, float seed, float form){
  // Re-forming: everyone joins the procession within half a second.
  if(uReform>=0.0) return smoothstep(0.0,0.4,uReform-0.3*fract(seed*5.13));
  float st=isHand(h) ? 0.78+0.2*fract(seed*7.31) : traceU(h)*0.72+0.06*fract(seed*3.7);
  float f=clamp((form-st*0.7)/0.3,0.0,1.0);
  return f*f*(3.0-2.0*f);
}
// The same, given the particle's velocity texel (V.w > 0.5: it has landed on its point).
float formWeightV(vec4 h, float seed, float form, vec4 V){
  return (uAbort>0.5 && V.w<0.5) ? 0.0 : formWeight(h,seed,form);
}
`;

/**
 * GLSL for the Field. Units are CSS pixels in viewport space; y grows downward like the DOM.
 * texPos: xy position, w seed.  texVel: xy velocity, z activation (0 rest .. 1 signal).
 */

// 3D simplex noise, Ashima Arts / Stefan Gustavson, MIT licence (github.com/ashima/webgl-noise).
const simplex3 = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
// Divergence-free 2D flow: curl of a scalar noise potential, by central differences.
vec2 curl2(vec3 p){
  const float e=0.08;
  float n1=snoise(p+vec3(0.0,e,0.0)); float n2=snoise(p-vec3(0.0,e,0.0));
  float n3=snoise(p+vec3(e,0.0,0.0)); float n4=snoise(p-vec3(e,0.0,0.0));
  return vec2(n1-n2,-(n3-n4))/(2.0*e);
}
`;

/** The hand's skinned, projected points; shared by the compute passes. */
const handChunk = /* glsl */ `
${formChunk}
uniform vec4 uHandRect;     // x, y, w, h in CSS px
uniform mat4 uBones[${BONES}]; // skinning matrices: pose and turn
uniform sampler2D uHandLocal; // xyz point on the hand, w packed skin (bone * 256 + parent weight * 255)
const float HAND_CAM=${HAND_CAM.toFixed(1)};
vec2 handTarget(vec2 uv, out float depth){
  vec4 L=texture2D(uHandLocal,uv);
  int b=int(floor(L.w/256.0+0.001));
  float bl=mod(L.w,256.0)/255.0;
  int pb=(b==0 || (b-1)-3*((b-1)/3)==0) ? 0 : b-1;
  vec4 p=vec4(L.xyz,1.0);
  vec3 w=mix((uBones[b]*p).xyz,(uBones[pb]*p).xyz,bl);
  float scale=min(uHandRect.w/2.2,uHandRect.z/1.9);
  float persp=HAND_CAM/(HAND_CAM-w.z);
  depth=w.z;
  return vec2(uHandRect.x+uHandRect.z*0.5+w.x*scale*persp, uHandRect.y+uHandRect.w*0.5-w.y*scale*persp);
}
`;

/**
 * The flock: away from the hero every dot flies in one murmuration that fills the screen. Each dot
 * has a fixed place in it (its home, spread a little past every edge). Slow noise folds the whole
 * sheet so dense bands form, travel and dissolve like the dark ripples in a flock of starlings, a
 * density wave rolls through it, and the sheet sways as one, the far side a moment behind the near
 * side. The dots steer toward their places rather than sitting on them, so the whole thing flows.
 * It lives in viewport space and never wraps, so no dot ever appears out of nowhere.
 */
const flockChunk = /* glsl */ `
uniform float uFlockT;      // the flock's clock, seconds
uniform vec3 uAnchor;       // xy: where the flock is held (the hero it just left), z: 0 held .. 1 free
uniform float uKick;        // px: a scroll drags the flock a little, then it catches up
vec2 flockSway(float t){
  return vec2(sin(t*0.17)+0.3*sin(t*0.41+1.3), sin(t*0.23+0.6)+0.3*sin(t*0.53+2.1))/1.3;
}
vec2 flockSlot(vec4 h, float ft){
  vec2 d=h.xy*2.0-1.0;                        // -1..1 across the screen
  float tt=ft*0.09;
  d+=0.3*vec2(snoise(vec3(d*1.2,tt)),snoise(vec3(d*1.2+11.0,tt)));
  d.x+=0.05*sin(d.x*4.0-ft*1.3+d.y*1.5);     // a density wave rolling across
  vec2 sway=flockSway(ft-1.2*(d.x+1.0)*0.5)*vec2(0.06,0.05);
  vec2 c=uViewport*0.5;
  vec2 body=(d*0.56+sway)*uViewport;          // a little past every edge
  float k=smoothstep(0.0,1.0,uAnchor.z);
  // Held, it is gathered small around the hero it left, then opens out to fill the screen.
  return mix(uAnchor.xy+body*0.25,c+body,k)+vec2(0.0,uKick);
}
`;

/**
 * Re-forming (timing and the route live in reform.ts). Each particle follows a waypoint; reformDone()
 * is 0 until it has landed on its own point, and until then nothing locks it to the shape.
 *
 * Every dot leaves the flock from wherever it is flying and merges into the drawn route, so the
 * flock pours out of itself as one stream. Trace dots arrive at the line's left end in order, the
 * one bound for the right end first, then run along the line to their spots, so it draws from left
 * to right like a pen. Hand dots ride the same stream, peel off, swoop in at the wrist and rise to
 * their points, the lowest landing first, so the hand fills in from the wrist to the fingertips.
 */
const reformChunk = /* glsl */ `
uniform vec2 uRoute[${ROUTE_N}];
const float LEAVE=${f(REFORM.leaveS)};
const float T_ROUTE=${f(REFORM.traceRouteS)}, T_SPREAD=${f(REFORM.traceSpreadS)}, T_RUN=${f(REFORM.traceRunS)};
const float H_BRANCH=${f(REFORM.handBranch)}, H_TURN=${f(REFORM.handTurnS)}, H_CLIMB=${f(REFORM.handClimbS)};
vec2 routeAt(float t){
  float x=clamp(t,0.0,1.0)*${ROUTE_N - 1}.0; int i=int(min(floor(x),${ROUTE_N - 2}.0));
  vec2 r=mix(uRoute[i],uRoute[i+1],x-float(i));
  return vec2(uTraceRect.x+r.x*uTraceRect.z, uTraceRect.y+uTraceRect.w*0.5+r.y*uTraceRect.z);
}
// Two unrelated hashes: plain fract(seed*a), fract(seed*b) puts neighbours on parallel lines (dashes).
vec2 jitter(float seed){ return vec2(fract(sin(seed*91.17)*43758.545),fract(sin(seed*57.31+1.7)*24634.634))-0.5; }
float handHeight(vec2 uv){ return clamp((texture2D(uHandLocal,uv).y+1.0)*0.5,0.0,1.0); }
// When it leaves the flock, and how long it then takes along the route (to the line's left end).
float leaveAt(float seed){ return LEAVE*fract(seed*4.71); }
float arriveAt(vec4 h, float seed){
  return LEAVE+T_ROUTE+(isHand(h) ? fract(seed*2.31) : 1.0-traceU(h))*T_SPREAD;
}
// Eased a little: no lurch leaving the flock, and slow enough at the end to make the turn onto the line.
float ease(float x){ x=clamp(x,0.0,1.0); return mix(x,x*x*(3.0-2.0*x),0.6); }
float branchAt(vec4 h, float seed){
  float l=leaveAt(seed); return l+H_BRANCH*(arriveAt(h,seed)-l);
}
float reformDone(vec4 h, float seed, vec2 uv){
  if(uReform<0.0) return 1.0;
  // Trace: lands when it reaches its spot, but never before it has fully joined the line (0.15 s).
  float end=isHand(h) ? branchAt(h,seed)+H_TURN+H_CLIMB*(0.35+0.65*handHeight(uv))
                      : arriveAt(h,seed)+max(traceU(h)*T_RUN,0.15);
  return step(end,uReform);
}
// Trace particles in the last stretch, running along the line: 0 before, ramps to 1 as they join it.
float reformOnLine(vec4 h, float seed, float T){
  if(uReform<0.0 || isHand(h)) return 0.0;
  return smoothstep(0.0,0.12,T-arriveAt(h,seed));
}
// Along the route from where it left the flock: the first third bends it into the drawn path.
vec2 onRoute(vec4 h, float seed, float T){
  float l=leaveAt(seed), x=(T-l)/(arriveAt(h,seed)-l);
  float e=ease(x);
  vec2 from=flockSlot(h,uFlockT-(uReform-l));
  vec2 p=mix(from,routeAt(e),smoothstep(0.0,0.35,x));
  return p+jitter(seed)*70.0*(1.0-smoothstep(0.75,1.0,e))*smoothstep(0.0,0.2,x);
}
vec2 reformWaypoint(vec4 h, float seed, vec2 uv, float T){
  vec2 m=vec2(14.0);
  if(T<leaveAt(seed)) return flockSlot(h,uFlockT+(T-uReform));
  if(!isHand(h)){
    float u=traceU(h), ar=arriveAt(h,seed);
    if(T<ar) return onRoute(h,seed,T);
    float s; return traceLine(min(u,(T-ar)/T_RUN),seed,s);
  }
  float tb=branchAt(h,seed);
  if(T<tb) return onRoute(h,seed,T);
  vec4 R4=uHandRect;
  float o=handHeight(uv);
  float depth; vec2 tg=handTarget(uv,depth);
  // Wide enough to stay a cloud, not a line of dots on one path; it closes in as each lands.
  vec2 jt=jitter(seed)*vec2(60.0,40.0);
  // Where it enters: the wrist, under its own point, so the dots rise in columns, not through one spot.
  vec2 wr=vec2(mix(R4.x+R4.z*0.5,tg.x,0.7),R4.y+R4.w*0.98);
  float tt=T-tb;
  if(tt<H_TURN){
    // Peel off the stream and swoop round under the hand to the wrist.
    float a=tt/H_TURN; a=a*a*(3.0-2.0*a);
    vec2 p0=onRoute(h,seed,tb), c=vec2(max(p0.x,R4.x+R4.z*1.05),R4.y+R4.w*1.12);
    return clamp((1.0-a)*(1.0-a)*p0+2.0*(1.0-a)*a*c+a*a*wr+jt,m,uViewport-m);
  }
  // Rise to its own point: the lowest arrive first, the fingertips last, with a slight sway that
  // settles as it lands.
  float a=clamp((tt-H_TURN)/(H_CLIMB*(0.35+0.65*o)),0.0,1.0);
  float e=1.0-(1.0-a)*(1.0-a);
  float side=(fract(seed*3.97)-0.5)*R4.z*0.25*sin(a*3.1416);
  return mix(wr,tg,e)+vec2(side,0.0)+jt*(1.0-e);
}
`;

/** Shared uniforms and the trace lookup, prepended to both compute passes. */
const common = /* glsl */ `
uniform float uTime;
uniform float uDt;
uniform float uForm;        // 0 swarm .. 1 trace, already spring-eased on the CPU
uniform vec2 uViewport;     // CSS px
uniform vec4 uTraceRect;    // x, y, w, h of the hero SVG in CSS px
uniform float uPhase;       // playback position along the looped clips, in clips
uniform vec3 uPointer;      // x, y, strength
uniform float uSnap;        // 1 for a single step: place every particle at its place in the flock, at rest
uniform sampler2D uHome;    // xy place in the flock (0..1), z size rank, w trace u
uniform sampler2D uTrace;   // N x 1, r = sample in [-1, 1]: every clip end to end
uniform float uTraceN;
uniform float uClipN;       // samples per clip
${simplex3}
${handChunk}
${flockChunk}

// Position p in samples along the looped tape of clips; wraps from the last sample to the first.
float traceAt(float p){
  float x=mod(p,uTraceN); float i=floor(x);
  float a=texelFetch(uTrace,ivec2(int(i),0),0).r;
  float b=texelFetch(uTrace,ivec2(int(mod(i+1.0,uTraceN)),0),0).r;
  return mix(a,b,x-i);
}
vec2 traceLine(float u, float seed, out float s){
  // The window is one clip wide; uPhase is the playback position in clips.
  s=traceAt((u+uPhase)*uClipN);
  float y=uTraceRect.y+uTraceRect.w*0.5-s*uTraceRect.w*0.44;
  // A line a few px thick, not a single row of points.
  y+=(fract(seed*7.13)-0.5)*2.4;
  return vec2(uTraceRect.x+u*uTraceRect.z,y);
}
vec2 traceTarget(vec4 h, float seed, out float s){ return traceLine(traceU(h),seed,s); }
// Where a particle goes in the hero: its point on the hand, or on the trace.
vec2 heroTarget(vec4 h, float seed, vec2 uv, out float s, out float depth){
  depth=0.0;
  if(isHand(h)){ s=0.45; return handTarget(uv,depth); }
  return traceTarget(h,seed,s);
}
${reformChunk}
`;

export const velocityShader = /* glsl */ `
${common}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 P=texture2D(texPos,uv); vec4 V=texture2D(texVel,uv); vec4 H=texture2D(uHome,uv);
  vec2 pos=P.xy; vec2 vel=V.xy; float seed=P.w;

  // Flock: steer toward its place in the flock, matching the place's own speed, with a little
  // small-scale flow so neighbours shimmer instead of moving as a rigid sheet.
  vec2 slot=flockSlot(H,uFlockT);
  vec2 slotV=(flockSlot(H,uFlockT+0.05)-slot)*20.0;
  vec2 flow=curl2(vec3(pos/170.0,uTime*0.12+seed*0.1));
  vec2 desired=slotV+(slot-pos)*2.0+flow*14.0;
  float sp=length(desired); if(sp>1400.0) desired*=1400.0/sp;
  vec2 aSwarm=(desired-vel)*4.0;

  // Hero: swim to a point on the hand or the recorded EMG line at a capped speed, the same
  // unhurried pace as the break-up, then settle on it with a stiff spring once close.
  float s, depth; vec2 target=heroTarget(H,seed,uv,s,depth);
  vec2 to=target-pos; float dist=length(to);
  vec2 seek=to*2.2;
  float ss=length(seek); if(ss>560.0) seek*=560.0/ss;
  const float k=60.0;
  vec2 aSpring=k*to-2.0*sqrt(k)*vel;
  vec2 aTrace=mix(aSpring,(seek-vel)*3.0,smoothstep(8.0,40.0,dist));
  // Re-forming: chase a waypoint along the drawn route, matching its speed, until landed.
  float done=reformDone(H,seed,uv);
  if(done<0.5){
    vec2 w0=reformWaypoint(H,seed,uv,uReform);
    vec2 wv=(reformWaypoint(H,seed,uv,uReform+1.0/30.0)-w0)*30.0;
    vec2 des=wv+(w0-pos)*6.0; float dl=length(des); if(dl>2600.0) des*=2600.0/dl;
    aTrace=(des-vel)*12.0;
  }

  float fw=formWeightV(H,seed,uForm,V);
  vec2 acc=mix(aSwarm,aTrace,fw);

  // The visitor's pointer pushes particles aside, within 140 px.
  vec2 d=pos-uPointer.xy; float r=length(d);
  float push=uPointer.z*pow(max(0.0,1.0-r/140.0),2.0);
  if(r>0.001) acc+=d/r*push*1800.0;

  vel+=acc*uDt;
  // Running along the line, the position shader places it exactly; carry no speed of its own, so
  // it stops dead on its spot when the line is complete.
  if(done<0.5) vel*=1.0-reformOnLine(H,seed,uReform);
  // Activation: ink where the recording spikes or the pointer touched, tissue at rest.
  float act=max(fw*smoothstep(0.15,0.8,abs(s)), push);
  float z=mix(V.z,act,1.0-exp(-uDt*6.0));
  // Arrived: latches once a particle reaches its point, so it then rides the playing trace
  // exactly (ramps to 1); it clears as soon as the particle is released.
  float arrived=0.0;
  if(fw>0.85) arrived=(dist<10.0 || V.w>0.0) ? min(1.0,max(V.w,0.0)+uDt*4.0) : 0.0;
  if(done<0.5) arrived=0.0;
  if(uSnap>0.5){ vel=vec2(0.0); z=0.0; arrived=0.0; }
  gl_FragColor=vec4(vel,z,arrived);
}
`;

export const positionShader = /* glsl */ `
${common}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  vec4 P=texture2D(texPos,uv); vec4 V=texture2D(texVel,uv); vec4 H=texture2D(uHome,uv);
  vec2 pos=P.xy+V.xy*uDt;
  float fw=formWeightV(H,P.w,uForm,V);
  // Once the trace formation has settled, lock particles to the line: no spring lag while it plays.
  float s, depth; vec2 target=heroTarget(H,P.w,uv,s,depth);
  // Lock onto the line only once arrived, so re-forming is a swim, never a jump.
  float lock=smoothstep(0.85,1.0,fw)*max(V.w,1.0-smoothstep(3.0,24.0,length(target-pos)))*reformDone(H,P.w,uv);
  if(lock>0.0) pos=mix(pos,target,lock);
  // Re-forming, running along the line to its spot: ride the playing line exactly, so it draws clean.
  float ol=reformOnLine(H,P.w,uReform)*(1.0-reformDone(H,P.w,uv));
  if(ol>0.0) pos=mix(pos,reformWaypoint(H,P.w,uv,uReform),ol);
  if(uSnap>0.5) pos=flockSlot(H,uFlockT);
  // z carries the hand's depth to the point shader (near dots larger and darker).
  gl_FragColor=vec4(pos,depth*fw,P.w);
}
`;

export const pointsVertex = /* glsl */ `
uniform sampler2D texPos;
uniform sampler2D texVel;
uniform sampler2D uHome;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float uForm;
${formChunk}
attribute vec2 ref;
varying float vAct;
varying vec2 vScreen;
varying float vRank;
varying float vSeed;
varying float vRecruit;
varying float vDepth;
void main(){
  vec4 P=texture2D(texPos,ref); vec4 V=texture2D(texVel,ref); vec4 H=texture2D(uHome,ref);
  vec2 ndc=vec2(P.x/uViewport.x*2.0-1.0, 1.0-P.y/uViewport.y*2.0);
  gl_Position=vec4(ndc,0.0,1.0);
  vAct=V.z; vRank=H.z; vScreen=P.xy/uViewport; vSeed=P.w; vDepth=P.z;
  vRecruit=formWeightV(H,P.w,uForm,V);
  // Swarm dots 2-3 px, big enough to read as ink; recruited dots swell a little; on the hand,
  // nearer dots are larger.
  gl_PointSize=(mix(2.0,3.0,H.z*H.z)+vRecruit*0.6)*(1.0+0.25*P.z)*uPixelRatio;
}
`;

export const pointsFragment = /* glsl */ `
uniform vec3 uTissue;
uniform vec3 uInk;
uniform vec3 uInkDim;
uniform vec3 uDrift;
uniform float uBleed;      // 0 clean ink .. 1 bled into drift blue
uniform float uForm;       // 0 swarm .. 1 trace
uniform sampler2D uMask;   // 1 where text sits, blurred
uniform float uFade;       // global fade-in, 0..1
uniform float uMaskStrength;
varying float vAct;
varying vec2 vScreen;
varying float vRank;
varying float vSeed;
varying float vRecruit;
varying float vDepth;
float hash(float n){ return fract(sin(n)*43758.5453); }
void main(){
  vec2 c=gl_PointCoord-0.5; float r2=dot(c,c);
  // Ink dot: the edge wobbles with angle, seeded per particle, like a nib touching damp paper.
  float ang=atan(c.y,c.x);
  float wob=0.9+0.1*sin(ang*3.0+vSeed*40.0)*hash(vSeed*7.1)+0.06*sin(ang*5.0+vSeed*91.0);
  float rr=0.25*wob*wob;
  if(r2>rr) discard;
  float edge=smoothstep(rr,rr*0.45,r2);

  // Recruitment by darkness: resting dots are tissue, joining the trace stains them ink,
  // and spikes in the recording (or the visitor's pointer) push them darker still.
  float recruit=clamp(max(vRecruit,vAct),0.0,1.0);
  vec3 rest=mix(uInkDim,uInk,0.35*vRank*vRank);
  vec3 col=mix(rest,uInk,recruit);
  col=mix(col,uDrift,uBleed*recruit);
  float a=mix(mix(0.9,1.0,vRank), mix(0.8,0.95,vAct), recruit);
  // Far side of the hand is paler, so it reads as a solid turning in space.
  a*=clamp(0.78+0.45*vDepth,0.4,1.0);

  float mask=texture2D(uMask,vec2(vScreen.x,1.0-vScreen.y)).r;
  a*=edge*(1.0-uMaskStrength*mask)*uFade;
  gl_FragColor=vec4(col*a,a);
}
`;
